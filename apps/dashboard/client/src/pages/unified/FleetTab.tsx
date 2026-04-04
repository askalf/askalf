import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { hubApi } from '../../hooks/useHubApi';
import { useToast } from '../../components/Toast';
import TabBar from '../../components/TabBar';
import type {
  Agent,
  AgentDetail,
} from '../../hooks/useHubApi';
import type { ForgeEvent } from '../../constants/status';
import { relativeTime } from '../../utils/format';
import { API_BASE } from '../../utils/api';
import AgentConfigEditor from './AgentConfigEditor';
import './FleetTab.css';

// ── Types ──

type DetailTab = 'overview' | 'logs' | 'exec' | 'config';
type SortColumn = 'name' | 'status' | 'tasks' | 'age';
type SortDir = 'asc' | 'desc';

function getTools(agent: Agent): string[] {
  if (agent.enabled_tools?.length) return agent.enabled_tools;
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.tools as string[]) || (cfg?.enabled_tools as string[]) || [];
}

// ── Stats Cards ──

function FleetStats({ agents }: { agents: Agent[] }) {
  const active = agents.filter(a => a.status === 'running').length;
  const idle = agents.filter(a => a.status !== 'running' && a.status !== 'error').length;
  const errors = agents.filter(a => a.status === 'error').length;
  const tasksDone = agents.reduce((sum, a) => sum + a.tasks_completed, 0);
  const tasksFailed = agents.reduce((sum, a) => sum + a.tasks_failed, 0);
  const totalTasks = tasksDone + tasksFailed;
  const successRate = totalTasks > 0 ? Math.round((tasksDone / totalTasks) * 100) : 0;

  return (
    <div className="fleet-stats-grid">
      <div className="fleet-stat-card">
        <div className="fleet-stat-value green">{active}</div>
        <div className="fleet-stat-label">Running</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value muted">{idle}</div>
        <div className="fleet-stat-label">Standing By</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value red">{errors}</div>
        <div className="fleet-stat-label">Errors</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value violet">{tasksDone}</div>
        <div className="fleet-stat-label">Tasks Done</div>
      </div>
      <div className="fleet-stat-card">
        <div className={`fleet-stat-value ${successRate >= 90 ? 'green' : successRate >= 70 ? 'amber' : 'red'}`}>{successRate}%</div>
        <div className="fleet-stat-label">Success Rate</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value muted">{agents.length}</div>
        <div className="fleet-stat-label">Total Workers</div>
      </div>
    </div>
  );
}

// ── Agent List ──

function AgentList({
  agents,
  selectedId,
  sortColumn,
  sortDir,
  onSort,
  onSelect,
  onQuickRun,
}: {
  agents: Agent[];
  selectedId: string | null;
  sortColumn: SortColumn;
  sortDir: SortDir;
  onSort: (col: SortColumn) => void;
  onSelect: (id: string) => void;
  onQuickRun?: (id: string) => void;
}) {
  const sorted = [...agents].sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'status': cmp = a.status.localeCompare(b.status); break;
      case 'tasks': cmp = (a.tasks_completed + a.tasks_failed) - (b.tasks_completed + b.tasks_failed); break;
      case 'age': cmp = new Date(a.last_run_at || 0).getTime() - new Date(b.last_run_at || 0).getTime(); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const cols: { key: SortColumn; label: string }[] = [
    { key: 'name', label: 'WORKER' },
    { key: 'status', label: 'STATUS' },
    { key: 'tasks', label: 'SUCCESS' },
    { key: 'age', label: 'LAST ACTIVE' },
    { key: 'reputation' as SortColumn, label: 'REP' },
  ];
  // placeholder for actions column header
  const hasQuickRun = !!onQuickRun;

  return (
    <div className="fleet-table-wrap">
      <table className="fleet-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={sortColumn === c.key ? 'sorted' : ''}
                onClick={() => onSort(c.key)}
                aria-sort={sortColumn === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={{ cursor: 'pointer' }}
              >
                {c.label}
                {sortColumn === c.key && (
                  <span className="fleet-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
                )}
              </th>
            ))}
            {hasQuickRun && <th style={{ width: '60px' }}></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent) => (
            <tr
              key={agent.id}
              className={selectedId === agent.id ? 'selected' : ''}
              onClick={() => onSelect(agent.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(agent.id); } }}
              tabIndex={0}
              aria-selected={selectedId === agent.id}
              role="row"
              style={{ cursor: 'pointer' }}
            >
              <td>
                {agent.name}
                <span className="fleet-agent-type">{agent.type}</span>
              </td>
              <td>
                <span className={`fleet-status ${agent.status}`}>
                  <span className="fleet-status-dot" aria-hidden="true" />
                  {agent.status}
                </span>
              </td>
              <td>
                {(() => {
                  const total = agent.tasks_completed + agent.tasks_failed;
                  if (total === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                  const rate = Math.round((agent.tasks_completed / total) * 100);
                  return <><span className={rate >= 90 ? 'fleet-rate-good' : rate >= 70 ? 'fleet-rate-ok' : 'fleet-rate-bad'}>{rate}%</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({total})</span></>;
                })()}
              </td>
              <td>{relativeTime(agent.last_run_at)}</td>
              <td>
                {(() => {
                  const rep = (agent.metadata?.['reputation'] as Record<string, unknown>) || null;
                  if (!rep) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>--</span>;
                  const score = Number(rep['score'] || 0);
                  const rank = rep['rank'] as number;
                  const color = score >= 0.8 ? '#34d399' : score >= 0.6 ? '#a5a8ff' : score >= 0.4 ? '#f59e0b' : '#ef4444';
                  return <><span style={{ color, fontWeight: 600 }}>{(score * 100).toFixed(0)}</span><span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}> #{rank}</span></>;
                })()}
              </td>
              {hasQuickRun && (
                <td>
                  <button
                    className="fleet-quick-run"
                    onClick={(e) => { e.stopPropagation(); onQuickRun!(agent.id); }}
                    title="Quick run"
                    disabled={agent.status === 'error'}
                  >
                    Run
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Agent Detail Panel ──

interface LiveLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
}

// ── Cron Helpers ──

/** Convert a cron expression to a human-readable string. */
function cronToHuman(cron: string): string {
  if (!cron || cron === 'manual') return 'Manual (no schedule)';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(minute.slice(2), 10);
    if (n === 1) return 'Every minute';
    return `Every ${n} minutes`;
  }

  // Every N hours: 0 */N * * *
  if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(hour.slice(2), 10);
    if (n === 1) return 'Every hour';
    return `Every ${n} hours`;
  }

  // Specific hours: 0 H,H,... * * *
  if (/^\d+$/.test(minute) && /^[\d,]+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const hours = hour.split(',').map(h => {
      const hh = parseInt(h, 10);
      if (hh === 0) return '12 AM';
      if (hh === 12) return '12 PM';
      return hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
    });
    return `Daily at ${hours.join(', ')}`;
  }

  // Daily at specific time: M H * * *
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const hh = parseInt(hour, 10);
    const mm = parseInt(minute, 10);
    const period = hh >= 12 ? 'PM' : 'AM';
    const displayH = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    const displayM = mm > 0 ? `:${String(mm).padStart(2, '0')}` : '';
    return `Daily at ${displayH}${displayM} ${period}`;
  }

  // Specific days of week: M H * * D,D,...
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && /^[\d,]+$/.test(dayOfWeek)) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = dayOfWeek.split(',').map(d => dayNames[parseInt(d, 10)] || d);
    const hh = parseInt(hour, 10);
    const period = hh >= 12 ? 'PM' : 'AM';
    const displayH = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return `${days.join(', ')} at ${displayH} ${period}`;
  }

  return cron;
}

/** Validate a cron expression. Returns null if valid, error string if not. */
function validateCron(cron: string): string | null {
  if (!cron.trim()) return 'Cron expression is required';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'Must have exactly 5 fields (min hour day month weekday)';
  const ranges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'weekday', min: 0, max: 7 },
  ];
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const { name, min, max } = ranges[i];
    // Allow *, */N, N, N-N, N,N,...
    if (!/^(\*|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$/.test(field)) {
      return `Invalid ${name} field: "${field}"`;
    }
    // Check numeric values are in range
    const nums = field.replace(/\*\/?/g, '').split(/[,\-]/).filter(Boolean);
    for (const n of nums) {
      const val = parseInt(n, 10);
      if (val < min || val > max) return `${name} value ${val} out of range (${min}-${max})`;
    }
  }
  return null;
}

/** Convert a cron expression to the interval in minutes (approximate). */
function cronToIntervalMinutes(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 60;
  const [minute, hour] = parts;
  if (minute.startsWith('*/')) return parseInt(minute.slice(2), 10) || 60;
  if (minute === '0' && hour.startsWith('*/')) return (parseInt(hour.slice(2), 10) || 1) * 60;
  if (minute === '0' && hour === '*') return 60;
  return 1440; // default to daily
}

/** Compute approximate next run time from a cron expression. */
function getNextRunTime(cron: string): string {
  if (!cron || cron === 'manual') return '--';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return '--';
  const [minuteF, hourF] = parts;

  const now = new Date();
  // Simple cases: */N minutes
  if (minuteF.startsWith('*/') && hourF === '*') {
    const n = parseInt(minuteF.slice(2), 10) || 60;
    const currentMin = now.getMinutes();
    const nextMin = Math.ceil((currentMin + 1) / n) * n;
    const next = new Date(now);
    next.setMinutes(nextMin, 0, 0);
    if (next <= now) next.setMinutes(next.getMinutes() + n);
    return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // */N hours
  if (minuteF === '0' && hourF.startsWith('*/')) {
    const n = parseInt(hourF.slice(2), 10) || 1;
    const currentH = now.getHours();
    const nextH = Math.ceil((currentH + 1) / n) * n;
    const next = new Date(now);
    next.setHours(nextH, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    if (next.getHours() >= 24) { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); }
    return next.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // Specific hour(s)
  if (/^\d+$/.test(minuteF) && /^[\d,]+$/.test(hourF)) {
    const mm = parseInt(minuteF, 10);
    const hours = hourF.split(',').map(h => parseInt(h, 10)).sort((a, b) => a - b);
    for (const hh of hours) {
      const next = new Date(now);
      next.setHours(hh, mm, 0, 0);
      if (next > now) return next.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    // Next day at first hour
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(hours[0], mm, 0, 0);
    return next.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return '--';
}

// ── Schedule Presets ──
const SCHEDULE_PRESETS: { label: string; cron: string; intervalMin: number }[] = [
  { label: '30 min', cron: '*/30 * * * *', intervalMin: 30 },
  { label: '1 hour', cron: '0 */1 * * *', intervalMin: 60 },
  { label: '2 hours', cron: '0 */2 * * *', intervalMin: 120 },
  { label: '4 hours', cron: '0 */4 * * *', intervalMin: 240 },
  { label: '6 hours', cron: '0 */6 * * *', intervalMin: 360 },
  { label: '12 hours', cron: '0 */12 * * *', intervalMin: 720 },
  { label: '24 hours', cron: '0 0 * * *', intervalMin: 1440 },
];

// ── Schedule Editor ──

function ScheduleEditor({
  agentId,
  currentSchedule,
  currentInterval: _currentInterval,
  onScheduleSaved,
}: {
  agentId: string;
  currentSchedule: string;
  currentInterval?: number;
  onScheduleSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedCron, setSelectedCron] = useState(currentSchedule && currentSchedule !== 'manual' ? currentSchedule : '');
  const [customCron, setCustomCron] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  // Determine the active cron for display
  const activeCron = currentSchedule && currentSchedule !== 'manual' ? currentSchedule : '';

  // Check if current schedule matches a preset
  const matchesPreset = (cron: string) => SCHEDULE_PRESETS.some(p => p.cron === cron);

  if (!editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="fleet-overview-value" style={{ fontSize: 13 }}>
            {activeCron ? cronToHuman(activeCron) : 'Manual (no schedule)'}
          </span>
          <button
            onClick={() => {
              setEditing(true);
              setSelectedCron(activeCron);
              setIsCustom(activeCron ? !matchesPreset(activeCron) : false);
              setCustomCron(activeCron && !matchesPreset(activeCron) ? activeCron : '');
              setCronError(null);
            }}
            className="fleet-schedule-edit-btn"
          >
            Edit
          </button>
        </div>
        {activeCron && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Next run
            </span>
            <span style={{ fontSize: 11, color: 'var(--crystal-lighter, #a78bfa)', fontFamily: 'var(--font-mono)' }}>
              {getNextRunTime(activeCron)}
            </span>
          </div>
        )}
        {activeCron && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', fontFamily: 'var(--font-mono)' }}>
            {activeCron}
          </span>
        )}
      </div>
    );
  }

  const effectiveCron = isCustom ? customCron : selectedCron;

  const handleSave = async () => {
    const cronToSave = effectiveCron.trim();
    const isManual = !cronToSave;

    if (!isManual) {
      const err = validateCron(cronToSave);
      if (err) {
        setCronError(err);
        return;
      }
    }

    setSaving(true);
    try {
      const intervalMin = isManual ? null : cronToIntervalMinutes(cronToSave);
      await hubApi.agents.setSchedule(agentId, {
        schedule_type: isManual ? 'manual' : 'scheduled',
        interval_minutes: intervalMin ?? undefined,
      });

      // Also PATCH metadata with cron expression
      if (!isManual) {
        await hubApi.agents.updateSettings(agentId, {
          metadata: {
            schedule: cronToSave,
            dispatch_interval_minutes: intervalMin,
          },
        });
      }

      addToast('Schedule updated', 'success');
      setEditing(false);
      onScheduleSaved?.();
    } catch {
      addToast('Failed to update schedule', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="fleet-schedule-editor">
      {/* Preset pills */}
      <div className="fleet-schedule-presets">
        <button
          className={`fleet-schedule-pill ${!effectiveCron && !isCustom ? 'active' : ''}`}
          onClick={() => { setSelectedCron(''); setIsCustom(false); setCronError(null); }}
        >
          Manual
        </button>
        {SCHEDULE_PRESETS.map((preset) => (
          <button
            key={preset.cron}
            className={`fleet-schedule-pill ${!isCustom && selectedCron === preset.cron ? 'active' : ''}`}
            onClick={() => { setSelectedCron(preset.cron); setIsCustom(false); setCronError(null); }}
          >
            {preset.label}
          </button>
        ))}
        <button
          className={`fleet-schedule-pill ${isCustom ? 'active' : ''}`}
          onClick={() => { setIsCustom(true); setCronError(null); }}
        >
          Custom
        </button>
      </div>

      {/* Custom cron input */}
      {isCustom && (
        <div className="fleet-schedule-custom">
          <input
            type="text"
            value={customCron}
            onChange={(e) => { setCustomCron(e.target.value); setCronError(null); }}
            placeholder="*/30 * * * *"
            spellCheck={false}
            className={`fleet-schedule-cron-input ${cronError ? 'has-error' : ''}`}
          />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
            min hour day month weekday
          </span>
          {cronError && (
            <span className="fleet-schedule-error">{cronError}</span>
          )}
        </div>
      )}

      {/* Preview */}
      {effectiveCron && !cronError && (
        <div className="fleet-schedule-preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Schedule
            </span>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
              {cronToHuman(effectiveCron)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Next run
            </span>
            <span style={{ fontSize: 11, color: 'var(--crystal-lighter, #a78bfa)', fontFamily: 'var(--font-mono)' }}>
              {getNextRunTime(effectiveCron)}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          disabled={saving}
          onClick={handleSave}
          className="fleet-btn primary"
          style={{ fontSize: 11, padding: '4px 14px' }}
        >
          {saving ? 'Saving...' : 'Save Schedule'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="fleet-btn"
          style={{ fontSize: 11, padding: '4px 14px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AgentDetailPanel({
  detail,
  agent,
  tab,
  onTabChange,
  onClose,
  onRun,
  onPause,
  onDecommission,
  onRecommission,
  actionLoading,
  liveLogEntries,
  onConfigSaved,
  onSaveAsTemplate,
}: {
  detail: AgentDetail | null;
  agent: Agent;
  tab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  onClose: () => void;
  onRun: (prompt?: string) => void;
  onPause: () => void;
  onDecommission: () => void;
  onRecommission: () => void;
  actionLoading: boolean;
  liveLogEntries: LiveLogEntry[];
  onConfigSaved: () => void;
  onSaveAsTemplate: () => void;
}) {
  const [execPrompt, setExecPrompt] = useState('');
  const tools = getTools(agent);

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'exec', label: 'Exec' },
    { key: 'config', label: 'Config' },
  ];

  return (
    <div className="fleet-detail">
      <div className="fleet-detail-header">
        <span className="fleet-detail-title">{agent.name}</span>
        <button className="fleet-detail-close" onClick={onClose} aria-label={`Close ${agent.name} details`}>&times;</button>
      </div>

      <TabBar tabs={tabs} active={tab} onChange={(k) => onTabChange(k as DetailTab)} className="fleet-detail-tabs" tabClassName="fleet-detail-tab" ariaLabel={`${agent.name} sections`} />

      <div className="fleet-detail-body">
        {tab === 'overview' && (
          <>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Status</span>
              <span className={`fleet-status ${agent.status}`}>
                <span className="fleet-status-dot" aria-hidden="true" />{agent.status}
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Type</span>
              <span className="fleet-overview-value">{agent.type}</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Autonomy</span>
              <span className="fleet-overview-value">{agent.autonomy_level}/5</span>
            </div>
            <div className="fleet-overview-row" style={{ flexDirection: 'column', gap: 8 }}>
              <span className="fleet-overview-label">Schedule</span>
              <ScheduleEditor agentId={agent.id} currentSchedule={agent.schedule || 'manual'} currentInterval={agent.schedule_interval_minutes ?? undefined} onScheduleSaved={onConfigSaved} />
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Tasks</span>
              <span className="fleet-overview-value">
                {agent.tasks_completed} done / {agent.tasks_failed} failed
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Last Run</span>
              <span className="fleet-overview-value">{relativeTime(agent.last_run_at)}</span>
            </div>
            {agent.description && (
              <div className="fleet-overview-row" style={{ flexDirection: 'column', gap: 4 }}>
                <span className="fleet-overview-label">Description</span>
                <span className="fleet-overview-value" style={{ fontWeight: 400, fontSize: 12, lineHeight: 1.5 }}>
                  {agent.description}
                </span>
              </div>
            )}
            {tools.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span className="fleet-overview-label">Tools</span>
                <div className="fleet-tools-list">
                  {tools.map((t) => (
                    <span key={t} className="fleet-tool-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'logs' && (
          <div className="fleet-logs">
            {liveLogEntries.length > 0 && liveLogEntries.map((entry) => (
              <div key={entry.id} className="fleet-log-line fleet-log-live">
                <span className="fleet-log-time">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className={`fleet-log-level ${entry.level}`}>{entry.level}</span>
                <span className="fleet-log-msg">{entry.message}</span>
              </div>
            ))}
            {detail?.logs && detail.logs.length > 0 ? (
              detail.logs.slice(0, 100).map((log) => (
                <div key={log.id} className="fleet-log-line">
                  <span className="fleet-log-time">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className={`fleet-log-level ${log.level}`}>{log.level}</span>
                  <span className="fleet-log-msg">{log.message}</span>
                </div>
              ))
            ) : liveLogEntries.length === 0 ? (
              <div className="fleet-empty">No logs available</div>
            ) : null}
          </div>
        )}

        {tab === 'exec' && (
          <div className="fleet-exec">
            <label htmlFor="fleet-exec-prompt" className="fleet-overview-label">Prompt</label>
            <textarea
              id="fleet-exec-prompt"
              value={execPrompt}
              onChange={(e) => setExecPrompt(e.target.value)}
              placeholder="Enter prompt to run agent with..."
            />
            <div className="fleet-exec-actions">
              <button
                className="fleet-btn primary"
                disabled={actionLoading}
                onClick={() => { onRun(execPrompt || undefined); setExecPrompt(''); }}
              >
                {actionLoading ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
        )}

        {tab === 'config' && (
          <AgentConfigEditor agent={agent} onSaved={onConfigSaved} />
        )}
      </div>

      <div className="fleet-detail-actions">
        {agent.is_decommissioned ? (
          <button className="fleet-btn primary" onClick={onRecommission} disabled={actionLoading}>
            Recommission
          </button>
        ) : (
          <>
            <button className="fleet-btn primary" onClick={() => onRun()} disabled={actionLoading || agent.status === 'running'}>
              Run
            </button>
            <button className="fleet-btn" onClick={onPause} disabled={actionLoading || agent.status === 'paused'}>
              Pause
            </button>
            <button className="fleet-btn" onClick={onSaveAsTemplate} disabled={actionLoading} title="Save this agent's config as a reusable template">
              Save as Template
            </button>
            <button className="fleet-btn danger" onClick={onDecommission} disabled={actionLoading}>
              Decommission
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

export default function FleetTab({ wsEvents = [] }: { wsEvents?: ForgeEvent[] }) {
  const { addToast } = useToast();

  // Core state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailData, setDetailData] = useState<AgentDetail | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [liveLogEntries, setLiveLogEntries] = useState<LiveLogEntry[]>([]);
  const [showDecommissioned, setShowDecommissioned] = useState(false);

  // Polling: agents every 15s
  const pollCallback = useCallback(async () => {
    try {
      const agentsRes = await hubApi.agents.list(showDecommissioned);
      setAgents(agentsRes.agents);
    } catch {
      addToast('Failed to refresh fleet data', 'error');
    }
  }, [addToast, showDecommissioned]);

  usePolling(pollCallback, 15000);

  // WS-accelerated refresh
  const latestEventTs = useRef(0);
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= latestEventTs.current) return;
    latestEventTs.current = latest.receivedAt;
    if (latest.category === 'agent' || latest.category === 'execution') {
      pollCallback();
    }
  }, [wsEvents, pollCallback]);

  // Optimistic agent status from WS
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    const VALID_STATUSES = new Set(['idle', 'running', 'error', 'disabled', 'paused', 'scheduled']);
    if (latest?.category === 'agent' && latest.agentId && typeof latest.status === 'string' && VALID_STATUSES.has(latest.status)) {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === latest.agentId
            ? { ...a, status: latest.status as Agent['status'] }
            : a
        )
      );
    }
  }, [wsEvents]);

  // Live logs for selected agent
  const liveLogEventTs = useRef(0);
  useEffect(() => {
    if (!selectedAgentId || wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= liveLogEventTs.current) return;
    if (latest.category !== 'execution' || latest.agentId !== selectedAgentId) return;
    liveLogEventTs.current = latest.receivedAt;

    hubApi.agents.detail(selectedAgentId).then(setDetailData).catch(() => {});

    const agentName = agents.find((a) => a.id === selectedAgentId)?.name || 'Agent';
    const eventType = (latest.type as string) || (latest.status as string) || 'event';
    setLiveLogEntries((prev) => [
      {
        id: `live-${latest.receivedAt}`,
        timestamp: new Date(latest.receivedAt).toISOString(),
        level: eventType === 'failed' ? 'error' : 'info',
        message: `[LIVE] ${agentName} — ${eventType}${latest.output ? `: ${String(latest.output).slice(0, 120)}` : ''}`,
      },
      ...prev.slice(0, 49),
    ]);
  }, [wsEvents, selectedAgentId, agents]);

  // Fetch detail when agent selected
  useEffect(() => {
    if (!selectedAgentId) {
      setDetailData(null);
      setLiveLogEntries([]);
      return;
    }
    setLiveLogEntries([]);
    hubApi.agents.detail(selectedAgentId).then(setDetailData).catch(() => {});
  }, [selectedAgentId]);

  // Filter agents
  const activeAgents = useMemo(() =>
    showDecommissioned ? agents : agents.filter((a) => !a.is_decommissioned),
    [agents, showDecommissioned]
  );
  const filtered = useMemo(() =>
    search
      ? activeAgents.filter((a) => (a.name || '').toLowerCase().includes(search.toLowerCase()))
      : activeAgents,
    [activeAgents, search]
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Actions
  const withLoading = async (key: string, fn: () => Promise<unknown>, label?: string) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
      const res = await hubApi.agents.list(showDecommissioned);
      setAgents(res.agents);
      if (label) addToast(`${label} succeeded`, 'success');
    } catch {
      addToast(label ? `${label} failed` : 'Action failed', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleRun = (id: string, prompt?: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.run(id, prompt), `Run ${name}`);
  };

  const handleStop = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.stop(id), `Stop ${name}`);
  };

  const handleDecommission = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    if (!window.confirm(`Decommission "${name}"? This will archive the agent.`)) return;
    withLoading(id, () => hubApi.agents.decommission(id), `Decommission ${name}`);
  };

  const handleRecommission = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.recommission(id), `Recommission ${name}`);
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  return (
    <div className="fleet-tab">
      {/* Header */}
      <div className="fleet-header">
        <div className="fleet-title-row">
          <span className="fleet-icon">&#x2B21;</span>
          <h2 className="fleet-title">Your Team</h2>
        </div>
        <p className="fleet-subtitle">Alf builds and manages your workers automatically</p>
      </div>

      {/* Scrollable content */}
      <div className="fleet-content-area">
        {/* Stats */}
        <FleetStats agents={activeAgents} />

        {/* Agent panel */}
        <div className="fleet-panel">
          <div className="fleet-panel-header">
            <span className="fleet-section-title">Workers</span>
            <div className="fleet-panel-meta">
              <label className="fleet-toggle-label">
                <input
                  type="checkbox"
                  checked={showDecommissioned}
                  onChange={(e) => setShowDecommissioned(e.target.checked)}
                />
                Archived
              </label>
              <input
                className="fleet-search"
                type="search"
                aria-label="Search workers"
                placeholder="Search workers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="fleet-agent-count">{filtered.length} total</span>
            </div>
          </div>

          <div className="fleet-main">
            <div className="fleet-content">
              {filtered.length === 0 ? (
                <div className="fleet-empty">
                  {search ? 'No workers match your search' : 'No workers yet — tell Alf what you need and workers will be created automatically'}
                </div>
              ) : (
                <AgentList
                  agents={filtered}
                  selectedId={selectedAgentId}
                  sortColumn={sortColumn}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onQuickRun={(id) => handleRun(id, 'Run your standard task based on your system prompt.')}
                  onSelect={(id) => {
                    setSelectedAgentId(selectedAgentId === id ? null : id);
                    setDetailTab('overview');
                  }}
                />
              )}
            </div>

            {selectedAgent && (
              <AgentDetailPanel
                detail={detailData}
                agent={selectedAgent}
                tab={detailTab}
                onTabChange={setDetailTab}
                onClose={() => setSelectedAgentId(null)}
                onRun={(prompt) => handleRun(selectedAgent.id, prompt)}
                onPause={() => handleStop(selectedAgent.id)}
                onDecommission={() => handleDecommission(selectedAgent.id)}
                onRecommission={() => handleRecommission(selectedAgent.id)}
                actionLoading={!!actionLoading[selectedAgent.id]}
                liveLogEntries={liveLogEntries}
                onConfigSaved={pollCallback}
                onSaveAsTemplate={async () => {
                  try {
                    setActionLoading(prev => ({ ...prev, [selectedAgent.id]: true }));
                    const res = await fetch(`${API_BASE}/api/v1/forge/agents/${selectedAgent.id}/save-as-template`, {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: `${selectedAgent.name} Template` }),
                    });
                    if (res.ok) {
                      const data = await res.json() as { templateId: string; name: string };
                      addToast(`Template "${data.name}" created`, 'success');
                    } else {
                      addToast('Failed to save template', 'error');
                    }
                  } catch {
                    addToast('Failed to save template', 'error');
                  } finally {
                    setActionLoading(prev => ({ ...prev, [selectedAgent.id]: false }));
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
