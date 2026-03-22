import { useState, useEffect, useCallback, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { ForgeTool } from '../../hooks/useHubApi';
import './BuilderTab.css';

// ── Types ──

type BuilderStep = 'template' | 'configure' | 'tools' | 'model' | 'schedule' | 'review';

interface ProviderStatus {
  name: string;
  status: string;
  models?: string[];
}

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  provider: string;
  tools: string[];
  autonomyLevel: number;
  maxIterations: number;
  maxCostPerExecution: number;
  scheduleType: 'none' | 'interval' | 'cron';
  scheduleInterval: string;
  cronExpression: string;
  timezone: string;
}

const STEPS: { key: BuilderStep; label: string }[] = [
  { key: 'template', label: '1. Template' },
  { key: 'configure', label: '2. Configure' },
  { key: 'tools', label: '3. Tools' },
  { key: 'model', label: '4. Model' },
  { key: 'schedule', label: '5. Schedule' },
  { key: 'review', label: '6. Review' },
];

/* Tools fetched dynamically from forge_tools DB via API.
   RISK_ORDER used for visual sorting: critical/high tools at bottom. */
const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function toToolItem(t: ForgeTool) {
  return { id: t.name, name: t.display_name, desc: t.description, risk: t.risk_level };
}

const DEFAULT_CONFIG: AgentConfig = {
  name: '',
  description: '',
  systemPrompt: '',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  tools: [],
  autonomyLevel: 2,
  maxIterations: 15,
  maxCostPerExecution: 1.0,
  scheduleType: 'none',
  scheduleInterval: '6h',
  cronExpression: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

// ── Sub-components ──

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  agent_config?: Record<string, unknown>;
  required_tools?: string[];
  schedule_config?: Record<string, unknown>;
}

const CATEGORY_ICONS: Record<string, string> = {
  personal: '\u{1F3E0}', content: '\u{270F}', marketing: '\u{1F4E3}', support: '\u{1F3E7}',
  ecommerce: '\u{1F6D2}', finance: '\u{1F4B0}', operations: '\u{1F3ED}', hr: '\u{1F465}',
  legal: '\u{2696}', research: '\u{1F50D}', analyze: '\u{1F4CA}', automate: '\u{2699}',
  monitor: '\u{1F4E1}', build: '\u{1F528}', dev: '\u{1F4BB}', security: '\u{1F6E1}',
};

function TemplatePickerStep({ onSelect, onSkip }: { onSelect: (tmpl: Record<string, unknown>) => void; onSkip: () => void }) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    hubApi.templates.list().then(data => {
      if (data.templates) setTemplates(data.templates as unknown as TemplateItem[]);
    }).catch(() => {}).finally(() => setLoadingTemplates(false));
  }, []);

  const filtered = filter
    ? templates.filter(t => t.category === filter)
    : templates;

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="builder-template-step">
      <h3>Start from a template or build from scratch</h3>
      <button className="builder-scratch-btn" onClick={onSkip}>
        Start from Scratch
      </button>

      <div style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button
            className={`builder-scratch-btn ${!filter ? 'active' : ''}`}
            style={{ padding: '4px 12px', fontSize: '12px' }}
            onClick={() => setFilter('')}
          >
            All ({templates.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              className={`builder-scratch-btn ${filter === cat ? 'active' : ''}`}
              style={{ padding: '4px 12px', fontSize: '12px' }}
              onClick={() => setFilter(f => f === cat ? '' : cat)}
            >
              {CATEGORY_ICONS[cat] || ''} {cat}
            </button>
          ))}
        </div>

        {loadingTemplates ? (
          <p className="builder-template-hint">Loading templates...</p>
        ) : filtered.length === 0 ? (
          <p className="builder-template-hint">No templates found</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
            {filtered.map(t => (
              <button
                key={t.id}
                className="builder-template-card"
                onClick={() => onSelect(t as unknown as Record<string, unknown>)}
                style={{
                  textAlign: 'left', padding: '16px', borderRadius: 'var(--radius-sm, 10px)',
                  background: 'var(--glass, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(240,240,242,0.06))',
                  cursor: 'pointer', transition: 'all 0.2s', color: 'var(--text, #f0f0f2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span>{CATEGORY_ICONS[t.category] || '\u{1F916}'}</span>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{t.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim, rgba(240,240,242,0.55))', lineHeight: 1.5 }}>
                  {t.description?.slice(0, 100)}{(t.description?.length ?? 0) > 100 ? '...' : ''}
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted, rgba(240,240,242,0.35))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t.category} · {t.required_tools?.length ?? 0} tools
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StepNav({
  current,
  onNav,
}: {
  current: BuilderStep;
  onNav: (step: BuilderStep) => void;
}) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="builder-steps">
      {STEPS.map((step, i) => (
        <button
          key={step.key}
          className={`builder-step ${step.key === current ? 'active' : ''} ${i < currentIdx ? 'done' : ''}`}
          onClick={() => onNav(step.key)}
        >
          {step.label}
        </button>
      ))}
    </div>
  );
}

function ConfigureStep({
  config,
  onChange,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
}) {
  const [optimizing, setOptimizing] = useState(false);

  const handleOptimize = useCallback(async () => {
    if (!config.systemPrompt.trim()) return;
    setOptimizing(true);
    try {
      const result = await hubApi.agents.optimizePrompt({ prompt: config.systemPrompt });
      if (result.optimized) {
        onChange({ systemPrompt: result.optimized });
      }
    } catch (err) {
      console.error('Optimize failed:', err);
    } finally {
      setOptimizing(false);
    }
  }, [config.systemPrompt, onChange]);

  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Worker Name</span>
        <input
          type="text"
          value={config.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Security Scanner"
        />
      </label>
      <label className="builder-field">
        <span>Description</span>
        <input
          type="text"
          value={config.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="What does this worker do?"
        />
      </label>
      <label className="builder-field">
        <span>
          System Prompt
          <button
            className="builder-optimize-btn"
            onClick={handleOptimize}
            disabled={optimizing || !config.systemPrompt.trim()}
          >
            {optimizing ? 'Optimizing...' : 'AI Improve'}
          </button>
        </span>
        <textarea
          value={config.systemPrompt}
          onChange={e => onChange({ systemPrompt: e.target.value })}
          placeholder="Instructions for the worker..."
          rows={8}
        />
      </label>
      <label className="builder-field">
        <span>Autonomy Level</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={1}
            max={5}
            value={config.autonomyLevel}
            onChange={e => onChange({ autonomyLevel: parseInt(e.target.value, 10) })}
          />
          <span className="builder-slider-val">{config.autonomyLevel}</span>
        </div>
        <div className="builder-autonomy-desc">
          {config.autonomyLevel === 1 && <span><strong>Manual</strong> — Proposes actions, waits for your approval before doing anything</span>}
          {config.autonomyLevel === 2 && <span><strong>Guided</strong> — Handles routine tasks, asks before anything risky</span>}
          {config.autonomyLevel === 3 && <span><strong>Balanced</strong> — Works independently on most tasks, checks in on major decisions</span>}
          {config.autonomyLevel === 4 && <span><strong>Autonomous</strong> — Operates freely, only alerts you on errors or cost thresholds</span>}
          {config.autonomyLevel === 5 && <span><strong>Full Auto</strong> — Runs end-to-end without interruption, handles all actions autonomously</span>}
        </div>
      </label>
    </div>
  );
}

function ToolsStep({
  config,
  onChange,
  tools,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
  tools: { id: string; name: string; desc: string; risk: string }[];
}) {
  const [filter, setFilter] = useState('');

  const toggleTool = useCallback((toolId: string) => {
    const current = config.tools;
    const next = current.includes(toolId)
      ? current.filter(t => t !== toolId)
      : [...current, toolId];
    onChange({ tools: next });
  }, [config.tools, onChange]);

  const filtered = filter
    ? tools.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()) || t.desc.toLowerCase().includes(filter.toLowerCase()))
    : tools;

  return (
    <div>
      <div className="builder-tools-header">
        <input
          type="text"
          placeholder="Filter tools..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="builder-tools-filter"
        />
        <span className="builder-tools-count">{config.tools.length} selected / {tools.length} available</span>
      </div>
      <div className="builder-tools-grid">
        {filtered.map(tool => (
          <label key={tool.id} className={`builder-tool-card ${config.tools.includes(tool.id) ? 'selected' : ''}`}>
            <input
              type="checkbox"
              checked={config.tools.includes(tool.id)}
              onChange={() => toggleTool(tool.id)}
            />
            <div className="builder-tool-info">
              <div className="builder-tool-name">
                {tool.name}
                {tool.risk !== 'low' && (
                  <span className={`builder-tool-risk builder-tool-risk--${tool.risk}`}>{tool.risk}</span>
                )}
              </div>
              <div className="builder-tool-desc">{tool.desc}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ModelStep({
  config,
  onChange,
  providers,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
  providers: ProviderStatus[];
}) {
  const MODELS = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', tier: 'top' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'mid' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast' },
    { id: 'gpt-5.4', label: 'GPT-5.4 Thinking', provider: 'openai', tier: 'top' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', tier: 'mid' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', tier: 'fast' },
    { id: 'gpt-5.3-instant', label: 'GPT-5.3 Instant', provider: 'openai', tier: 'fast' },
  ];

  // Detect configured providers from the providers list or fall back to checking if any provider has models
  const configuredProviders = new Set(
    providers.filter(p => p.status === 'healthy').map(p => p.name)
  );
  // If no providers reported healthy (common in selfhosted), assume anthropic+openai are configured
  if (configuredProviders.size === 0 && providers.length === 0) {
    configuredProviders.add('anthropic');
    configuredProviders.add('openai');
  }

  const selectedModel = MODELS.find(m => m.id === config.model);

  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Model</span>
        <select value={config.model} onChange={e => {
          const m = MODELS.find(x => x.id === e.target.value);
          onChange({ model: e.target.value, provider: m?.provider || config.provider });
        }} style={{ color: 'var(--text, #f0f0f2)' }}>
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      {selectedModel && (
        <div style={{ fontSize: '12px', color: 'var(--text-dim, rgba(240,240,242,0.55))', marginTop: '8px' }}>
          Provider: {selectedModel.provider} · Tier: {selectedModel.tier === 'top' ? 'Most capable' : selectedModel.tier === 'mid' ? 'Balanced' : 'Fast & cheap'}
        </div>
      )}
    </div>
  );
}

// ── Cron helpers (no external deps) ──

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'Europe/Moscow', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney', 'Pacific/Auckland',
];

interface CronPreset {
  label: string;
  cron: string;
  desc: string;
}
const CRON_PRESETS: CronPreset[] = [
  { label: 'Every 15 min',             cron: '*/15 * * * *',    desc: 'Runs at :00, :15, :30, :45' },
  { label: 'Every 30 min',             cron: '*/30 * * * *',    desc: 'Runs at :00 and :30' },
  { label: 'Hourly',                   cron: '0 * * * *',       desc: 'Top of every hour' },
  { label: 'Every 6 hours',            cron: '0 */6 * * *',     desc: 'At 00:00, 06:00, 12:00, 18:00' },
  { label: 'Daily at midnight',        cron: '0 0 * * *',       desc: 'Once a day at 00:00' },
  { label: 'Daily at 9 AM',            cron: '0 9 * * *',       desc: 'Once a day at 09:00' },
  { label: 'Weekly Monday 9 AM',       cron: '0 9 * * 1',       desc: 'Every Monday at 09:00' },
  { label: 'Weekdays at 9 AM',         cron: '0 9 * * 1-5',     desc: 'Mon-Fri at 09:00' },
];

type FreqMode = 'minutes' | 'hours' | 'days';

/** Build a cron expression from the visual frequency picker state */
function buildCronFromFrequency(mode: FreqMode, every: number, atMinute: number, atHour: number): string {
  switch (mode) {
    case 'minutes': return `*/${Math.max(1, every)} * * * *`;
    case 'hours':   return `${atMinute} */${Math.max(1, every)} * * *`;
    case 'days':    return `${atMinute} ${atHour} */${Math.max(1, every)} * *`;
    default:        return '0 * * * *';
  }
}

/** Parse a cron expression into 5 fields, returns null on bad format */
function parseCronFields(expr: string): string[] | null {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 ? parts : null;
}

/** Compute next N run dates from a cron expression (simple client-side impl, no library).
 *  Handles: * /step, exact values, ranges (1-5), and lists (1,3,5).
 *  Good enough for a preview; the server is the source of truth. */
function getNextRuns(cronExpr: string, count: number, tz: string): Date[] {
  const fields = parseCronFields(cronExpr);
  if (!fields) return [];

  const matchField = (field: string, value: number, _max: number): boolean => {
    if (field === '*') return true;
    // */N step
    const stepMatch = field.match(/^\*\/(\d+)$/);
    if (stepMatch) return value % parseInt(stepMatch[1], 10) === 0;
    // comma-separated list or ranges
    return field.split(',').some(part => {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = parseInt(rangeMatch[1], 10);
        const hi = parseInt(rangeMatch[2], 10);
        return value >= lo && value <= hi;
      }
      return parseInt(part, 10) === value;
    });
  };

  const results: Date[] = [];
  // Walk forward minute-by-minute from now, up to 30 days
  const now = new Date();
  const limit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const cursor = new Date(now.getTime() + 60000); // start 1 min from now
  cursor.setSeconds(0, 0);

  while (cursor < limit && results.length < count) {
    // Convert cursor to tz-local components
    let m: number, h: number, dom: number, mon: number, dow: number;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: 'numeric', day: 'numeric',
        month: 'numeric', weekday: 'short', hour12: false,
      }).formatToParts(cursor);
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
      h = parseInt(get('hour'), 10);
      m = parseInt(get('minute'), 10);
      dom = parseInt(get('day'), 10);
      mon = parseInt(get('month'), 10);
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      dow = dayMap[get('weekday')] ?? cursor.getDay();
    } catch {
      // Fallback to UTC
      h = cursor.getUTCHours(); m = cursor.getUTCMinutes();
      dom = cursor.getUTCDate(); mon = cursor.getUTCMonth() + 1; dow = cursor.getUTCDay();
    }

    if (
      matchField(fields[0], m, 59) &&
      matchField(fields[1], h, 23) &&
      matchField(fields[2], dom, 31) &&
      matchField(fields[3], mon, 12) &&
      matchField(fields[4], dow, 6)
    ) {
      results.push(new Date(cursor));
    }
    cursor.setTime(cursor.getTime() + 60000);
  }
  return results;
}

function formatRunDate(d: Date, tz: string): string {
  try {
    return d.toLocaleString('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return d.toLocaleString();
  }
}

function ScheduleStep({
  config,
  onChange,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
}) {
  // Visual frequency picker state
  const [freqMode, setFreqMode] = useState<FreqMode>('hours');
  const [freqEvery, setFreqEvery] = useState(1);
  const [freqAtMinute, setFreqAtMinute] = useState(0);
  const [freqAtHour, setFreqAtHour] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rawCron, setRawCron] = useState(config.cronExpression || '');

  // When visual picker changes, update cron
  const visualCron = useMemo(
    () => buildCronFromFrequency(freqMode, freqEvery, freqAtMinute, freqAtHour),
    [freqMode, freqEvery, freqAtMinute, freqAtHour],
  );

  // The "active" cron is either from visual picker or raw input
  const activeCron = useMemo(
    () => (config.scheduleType === 'cron' ? (showAdvanced ? rawCron : visualCron) : ''),
    [config.scheduleType, showAdvanced, rawCron, visualCron],
  );

  // Sync cron expression to config
  useEffect(() => {
    if (config.scheduleType === 'cron' && activeCron && activeCron !== config.cronExpression) {
      onChange({ cronExpression: activeCron });
    }
  }, [activeCron, config.scheduleType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next runs preview
  const nextRuns = useMemo(() => {
    if (config.scheduleType !== 'cron' || !activeCron) return [];
    return getNextRuns(activeCron, 5, config.timezone);
  }, [activeCron, config.scheduleType, config.timezone]);

  const cronValid = useMemo(() => !!parseCronFields(activeCron), [activeCron]);

  const applyPreset = (preset: CronPreset) => {
    setRawCron(preset.cron);
    // Reverse-parse simple presets into visual picker
    const f = parseCronFields(preset.cron);
    if (f) {
      const minField = f[0], hourField = f[1], domField = f[2];
      const minStep = minField.match(/^\*\/(\d+)$/);
      const hourStep = hourField.match(/^\*\/(\d+)$/);
      const domStep = domField.match(/^\*\/(\d+)$/);
      if (minStep && hourField === '*') {
        setFreqMode('minutes'); setFreqEvery(parseInt(minStep[1], 10));
      } else if (hourStep || hourField === '*') {
        setFreqMode('hours');
        setFreqEvery(hourStep ? parseInt(hourStep[1], 10) : 1);
        setFreqAtMinute(minField === '0' || minField === '*' ? 0 : parseInt(minField, 10) || 0);
      } else if (domStep || !isNaN(parseInt(hourField, 10))) {
        setFreqMode('days');
        setFreqEvery(domStep ? parseInt(domStep[1], 10) : 1);
        setFreqAtMinute(parseInt(minField, 10) || 0);
        setFreqAtHour(parseInt(hourField, 10) || 0);
      }
    }
    setShowAdvanced(false);
    onChange({ scheduleType: 'cron', cronExpression: preset.cron });
  };

  return (
    <div className="builder-form" style={{ maxWidth: 640 }}>
      {/* Schedule Type */}
      <label className="builder-field">
        <span>Schedule Type</span>
        <select
          value={config.scheduleType}
          onChange={e => onChange({ scheduleType: e.target.value as AgentConfig['scheduleType'] })}
        >
          <option value="none">One-shot (manual trigger)</option>
          <option value="interval">Simple interval</option>
          <option value="cron">Cron schedule (advanced)</option>
        </select>
      </label>

      {/* Simple interval (legacy) */}
      {config.scheduleType === 'interval' && (
        <label className="builder-field">
          <span>Interval</span>
          <select value={config.scheduleInterval} onChange={e => onChange({ scheduleInterval: e.target.value })}>
            <option value="30m">Every 30 minutes</option>
            <option value="1h">Every hour</option>
            <option value="3h">Every 3 hours</option>
            <option value="6h">Every 6 hours</option>
            <option value="12h">Every 12 hours</option>
            <option value="24h">Every 24 hours</option>
          </select>
        </label>
      )}

      {/* Cron editor */}
      {config.scheduleType === 'cron' && (
        <>
          {/* Presets */}
          <div className="builder-field">
            <span>Quick Presets</span>
            <div className="builder-cron-presets">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  type="button"
                  className={`builder-cron-preset-btn${activeCron === p.cron ? ' active' : ''}`}
                  onClick={() => applyPreset(p)}
                  title={p.desc}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Visual frequency picker */}
          {!showAdvanced && (
            <div className="builder-field">
              <span>Frequency</span>
              <div className="builder-cron-freq">
                <span className="builder-cron-freq-label">Every</span>
                <input
                  type="number"
                  min={1}
                  max={freqMode === 'minutes' ? 59 : freqMode === 'hours' ? 23 : 30}
                  value={freqEvery}
                  onChange={e => setFreqEvery(Math.max(1, parseInt(e.target.value) || 1))}
                  className="builder-cron-freq-input"
                />
                <select
                  value={freqMode}
                  onChange={e => { setFreqMode(e.target.value as FreqMode); setFreqEvery(1); }}
                  className="builder-cron-freq-select"
                >
                  <option value="minutes">minute(s)</option>
                  <option value="hours">hour(s)</option>
                  <option value="days">day(s)</option>
                </select>
                {freqMode === 'hours' && (
                  <>
                    <span className="builder-cron-freq-label">at minute</span>
                    <select
                      value={freqAtMinute}
                      onChange={e => setFreqAtMinute(parseInt(e.target.value, 10))}
                      className="builder-cron-freq-select"
                    >
                      {[0, 5, 10, 15, 20, 30, 45].map(m => (
                        <option key={m} value={m}>:{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </>
                )}
                {freqMode === 'days' && (
                  <>
                    <span className="builder-cron-freq-label">at</span>
                    <select
                      value={freqAtHour}
                      onChange={e => setFreqAtHour(parseInt(e.target.value, 10))}
                      className="builder-cron-freq-select"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="builder-cron-freq-label">:</span>
                    <select
                      value={freqAtMinute}
                      onChange={e => setFreqAtMinute(parseInt(e.target.value, 10))}
                      className="builder-cron-freq-select"
                    >
                      {[0, 15, 30, 45].map(m => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Cron expression preview / raw editor */}
          <div className="builder-field">
            <span>
              Cron Expression
              <button
                type="button"
                className="builder-optimize-btn"
                onClick={() => {
                  if (!showAdvanced) setRawCron(visualCron);
                  setShowAdvanced(v => !v);
                }}
              >
                {showAdvanced ? 'Use Visual' : 'Edit Raw'}
              </button>
            </span>
            {showAdvanced ? (
              <input
                type="text"
                value={rawCron}
                onChange={e => { setRawCron(e.target.value); onChange({ cronExpression: e.target.value }); }}
                placeholder="* * * * *  (min hour dom mon dow)"
                className={`builder-cron-raw${!cronValid && rawCron ? ' invalid' : ''}`}
                spellCheck={false}
              />
            ) : (
              <code className="builder-cron-display">{visualCron}</code>
            )}
            {showAdvanced && !cronValid && rawCron && (
              <div className="builder-cron-error">Invalid cron expression. Expected 5 fields: minute hour day month weekday</div>
            )}
            <div className="builder-cron-hint">
              Format: minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sun)
            </div>
          </div>

          {/* Time zone selector */}
          <label className="builder-field">
            <span>Time Zone</span>
            <select
              value={config.timezone}
              onChange={e => onChange({ timezone: e.target.value })}
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>

          {/* Next 5 runs preview */}
          {activeCron && cronValid && (
            <div className="builder-field">
              <span>Next 5 Runs</span>
              <div className="builder-cron-next-runs">
                {nextRuns.length > 0 ? nextRuns.map((d, i) => (
                  <div key={i} className="builder-cron-run-item">
                    <span className="builder-cron-run-idx">{i + 1}.</span>
                    <span>{formatRunDate(d, config.timezone)}</span>
                  </div>
                )) : (
                  <div className="builder-cron-run-item" style={{ color: 'var(--text-muted)' }}>
                    No runs found in the next 30 days
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Cost & iteration limits (always shown) */}
      <label className="builder-field">
        <span>Max Cost per Execution ($)</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={config.maxCostPerExecution}
            onChange={e => onChange({ maxCostPerExecution: parseFloat(e.target.value) })}
          />
          <span className="builder-slider-val">${config.maxCostPerExecution.toFixed(2)}</span>
        </div>
      </label>
      <label className="builder-field">
        <span>Max Iterations</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={config.maxIterations}
            onChange={e => onChange({ maxIterations: parseInt(e.target.value, 10) })}
          />
          <span className="builder-slider-val">{config.maxIterations}</span>
        </div>
      </label>
    </div>
  );
}

function ReviewStep({
  config,
  onSubmit,
  submitting,
  toolNames,
}: {
  config: AgentConfig;
  onSubmit: () => void;
  submitting: boolean;
  toolNames: Record<string, string>;
}) {
  return (
    <div className="builder-review">
      <div className="builder-review-card">
        <h3>{config.name || 'Unnamed Agent'}</h3>
        <p>{config.description || 'No description'}</p>
        <div className="builder-review-grid">
          <div><strong>Model:</strong> {config.model}</div>
          <div><strong>Autonomy:</strong> {config.autonomyLevel === 1 ? 'Manual' : config.autonomyLevel === 2 ? 'Guided' : config.autonomyLevel === 3 ? 'Balanced' : config.autonomyLevel === 4 ? 'Autonomous' : 'Full Auto'} ({config.autonomyLevel}/5)</div>
          <div><strong>Tools:</strong> {config.tools.length > 0 ? config.tools.map(t => toolNames[t] || t).join(', ') : 'None'}</div>
          <div><strong>Max Cost:</strong> ${config.maxCostPerExecution.toFixed(2)}</div>
          <div><strong>Max Iterations:</strong> {config.maxIterations}</div>
          <div>
            <strong>Schedule:</strong>{' '}
            {config.scheduleType === 'none'
              ? 'Manual'
              : config.scheduleType === 'cron'
              ? `Cron: ${config.cronExpression} (${config.timezone})`
              : `Every ${config.scheduleInterval}`}
          </div>
        </div>
        {config.systemPrompt && (
          <div className="builder-review-prompt">
            <strong>System Prompt:</strong>
            <pre>{config.systemPrompt}</pre>
          </div>
        )}
      </div>
      <button
        className="builder-create-btn"
        onClick={onSubmit}
        disabled={submitting || !config.name.trim()}
      >
        {submitting ? 'Creating...' : 'Create Worker'}
      </button>
    </div>
  );
}

// ── Main Component ──

export default function BuilderTab({
  prefilledTemplate,
}: {
  prefilledTemplate?: Record<string, unknown> | null;
}) {
  const [step, setStep] = useState<BuilderStep>('template');
  const [config, setConfig] = useState<AgentConfig>({ ...DEFAULT_CONFIG });
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [availableTools, setAvailableTools] = useState<{ id: string; name: string; desc: string; risk: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ agentId: string; name: string } | null>(null);

  // Load provider status + available tools
  useEffect(() => {
    hubApi.providers.health().then(data => {
      if (data.providers) setProviders(data.providers.map((p: Record<string, unknown>) => ({
        name: p.name as string,
        status: (p.healthStatus as string) ?? 'unknown',
        models: p.models as string[] | undefined,
      })));
    }).catch(() => {});

    hubApi.tools.list().then(data => {
      if (data.tools) {
        const sorted = data.tools
          .map(toToolItem)
          .sort((a, b) => (RISK_ORDER[a.risk] ?? 0) - (RISK_ORDER[b.risk] ?? 0) || a.name.localeCompare(b.name));
        setAvailableTools(sorted);
      }
    }).catch(() => {});
  }, []);

  // Apply prefilled template
  useEffect(() => {
    if (prefilledTemplate) {
      const tmpl = prefilledTemplate;
      const agentConfig = (tmpl['agent_config'] ?? {}) as Record<string, unknown>;
      setConfig(prev => ({
        ...prev,
        name: (tmpl['name'] as string) ?? prev.name,
        description: (tmpl['description'] as string) ?? prev.description,
        systemPrompt: (agentConfig['systemPrompt'] as string) ?? prev.systemPrompt,
        model: (agentConfig['model'] as string) ?? prev.model,
        tools: (tmpl['required_tools'] as string[]) ?? prev.tools,
        autonomyLevel: (agentConfig['autonomyLevel'] as number) ?? prev.autonomyLevel,
        maxIterations: (agentConfig['maxIterations'] as number) ?? prev.maxIterations,
        maxCostPerExecution: (agentConfig['maxCostPerExecution'] as number) ?? prev.maxCostPerExecution,
      }));
      // Apply schedule config from template
      const schedCfg = (tmpl['schedule_config'] ?? {}) as Record<string, unknown>;
      if (schedCfg['interval_minutes']) {
        const mins = schedCfg['interval_minutes'] as number;
        const inverseMap: Record<number, string> = { 30: '30m', 60: '1h', 180: '3h', 360: '6h', 720: '12h', 1440: '24h' };
        setConfig(prev => ({
          ...prev,
          scheduleType: 'interval',
          scheduleInterval: inverseMap[mins] ?? '6h',
        }));
      }
      setStep('configure');
    }
  }, [prefilledTemplate]);

  const updateConfig = useCallback((updates: Partial<AgentConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!.key);
  }, [step]);

  const prevStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1]!.key);
  }, [step]);

  const handleSubmit = useCallback(async () => {
    if (!config.name.trim()) return;
    setSubmitting(true);
    try {
      const res = await hubApi.agents.create({
        name: config.name,
        type: 'custom',
        description: config.description,
        system_prompt: config.systemPrompt,
        modelId: config.model,
        autonomyLevel: config.autonomyLevel,
        enabledTools: config.tools,
        maxIterations: config.maxIterations,
        maxCostPerExecution: config.maxCostPerExecution,
        metadata: { source_layer: 'builder' },
      } as Parameters<typeof hubApi.agents.create>[0]);
      const agent = (res as { agent: { id: string; name: string } }).agent;

      // Wire schedule if not manual/one-shot
      if (config.scheduleType !== 'none' && agent.id) {
        try {
          if (config.scheduleType === 'cron') {
            // Send cron expression + timezone
            await hubApi.agents.setSchedule(agent.id, {
              schedule_type: 'scheduled',
              interval_minutes: undefined,
              execution_mode: 'cron',
            });
            // Also POST the full cron config via the schedule endpoint
            await fetch(`${window.location.origin}/api/v1/admin/agents/${agent.id}/schedule`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                schedule_type: 'scheduled',
                cron_expression: config.cronExpression,
                timezone: config.timezone,
                is_continuous: true,
              }),
            });
          } else {
            const intervalMap: Record<string, number> = {
              '30m': 30, '1h': 60, '3h': 180, '6h': 360, '12h': 720, '24h': 1440,
            };
            const intervalMinutes = intervalMap[config.scheduleInterval] ?? 360;
            await hubApi.agents.setSchedule(agent.id, {
              schedule_type: 'scheduled',
              interval_minutes: intervalMinutes,
            });
          }
        } catch (schedErr) {
          console.error('Failed to set schedule:', schedErr);
        }
      }

      setResult({ agentId: agent.id, name: agent.name ?? config.name });
    } catch (err) {
      console.error('Failed to create agent:', err);
    } finally {
      setSubmitting(false);
    }
  }, [config]);

  const [advanced, setAdvanced] = useState(false);
  const [simpleSchedule, setSimpleSchedule] = useState<'once' | 'daily' | 'weekly' | 'always'>('once');

  // Apply simple schedule to config
  useEffect(() => {
    if (advanced) return;
    const schedMap: Record<string, Partial<AgentConfig>> = {
      once: { scheduleType: 'none' },
      daily: { scheduleType: 'interval', scheduleInterval: '24h' },
      weekly: { scheduleType: 'cron', cronExpression: '0 9 * * 1' },
      always: { scheduleType: 'interval', scheduleInterval: '1h' },
    };
    updateConfig(schedMap[simpleSchedule] ?? {});
  }, [simpleSchedule, advanced, updateConfig]);

  if (result) {
    return (
      <div className="builder-success">
        <h2>Worker Created!</h2>
        <p>&ldquo;{result.name}&rdquo; is ready. You can find it in the Workers tab.</p>
        <button className="builder-create-btn" onClick={() => { setResult(null); setConfig({ ...DEFAULT_CONFIG }); setStep('template'); setAdvanced(false); }}>
          Create Another
        </button>
      </div>
    );
  }

  // ── Simple Mode (3 steps) ──
  if (!advanced) {
    return (
      <div className="builder-container">
        <div className="builder-simple-header">
          <h3>Create a Worker</h3>
          <button className="builder-advanced-toggle" onClick={() => { setAdvanced(true); setStep('template'); }}>
            Advanced Mode
          </button>
        </div>

        <div className="builder-content">
          <div className="builder-form">
            <label className="builder-field">
              <span>What should this worker do?</span>
              <input
                type="text"
                value={config.name}
                onChange={e => updateConfig({ name: e.target.value })}
                placeholder="e.g. Competitor Researcher, Invoice Monitor, Blog Writer"
              />
            </label>
            <label className="builder-field">
              <span>Describe the task in detail</span>
              <textarea
                value={config.description}
                onChange={e => updateConfig({ description: e.target.value, systemPrompt: e.target.value })}
                placeholder="What should this worker do? What should it look for? How should it report results?"
                rows={4}
              />
            </label>
            <div className="builder-field">
              <span>How often?</span>
              <div className="builder-simple-schedule">
                {(['once', 'daily', 'weekly', 'always'] as const).map(opt => (
                  <button
                    key={opt}
                    className={`builder-schedule-pill ${simpleSchedule === opt ? 'active' : ''}`}
                    onClick={() => setSimpleSchedule(opt)}
                    type="button"
                  >
                    {opt === 'once' ? 'One time' : opt === 'daily' ? 'Every day' : opt === 'weekly' ? 'Every week' : 'Always running'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="builder-nav">
          <button
            className="builder-create-btn"
            onClick={handleSubmit}
            disabled={submitting || !config.name.trim()}
          >
            {submitting ? 'Creating...' : 'Create Worker'}
          </button>
        </div>
      </div>
    );
  }

  // ── Advanced Mode (6 steps) ──
  const currentIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="builder-container">
      <div className="builder-simple-header">
        <StepNav current={step} onNav={setStep} />
        <button className="builder-advanced-toggle" onClick={() => setAdvanced(false)}>
          Simple Mode
        </button>
      </div>

      <div className="builder-content">
        {step === 'template' && (
          <TemplatePickerStep onSelect={(tmpl) => {
            const agentConfig = (tmpl['agent_config'] ?? {}) as Record<string, unknown>;
            setConfig(prev => ({
              ...prev,
              name: (tmpl['name'] as string) ?? prev.name,
              description: (tmpl['description'] as string) ?? prev.description,
              systemPrompt: (agentConfig['systemPrompt'] as string) ?? prev.systemPrompt,
              model: (agentConfig['model'] as string) ?? prev.model,
              tools: (tmpl['required_tools'] as string[]) ?? prev.tools,
              autonomyLevel: (agentConfig['autonomyLevel'] as number) ?? prev.autonomyLevel,
              maxIterations: (agentConfig['maxIterations'] as number) ?? prev.maxIterations,
              maxCostPerExecution: (agentConfig['maxCostPerExecution'] as number) ?? prev.maxCostPerExecution,
            }));
            const schedCfg = (tmpl['schedule_config'] ?? {}) as Record<string, unknown>;
            if (schedCfg['interval_minutes']) {
              const mins = schedCfg['interval_minutes'] as number;
              const inverseMap: Record<number, string> = { 30: '30m', 60: '1h', 180: '3h', 360: '6h', 720: '12h', 1440: '24h' };
              setConfig(prev => ({ ...prev, scheduleType: 'interval', scheduleInterval: inverseMap[mins] ?? '6h' }));
            }
            setStep('configure');
          }} onSkip={() => setStep('configure')} />
        )}
        {step === 'configure' && <ConfigureStep config={config} onChange={updateConfig} />}
        {step === 'tools' && <ToolsStep config={config} onChange={updateConfig} tools={availableTools} />}
        {step === 'model' && <ModelStep config={config} onChange={updateConfig} providers={providers} />}
        {step === 'schedule' && <ScheduleStep config={config} onChange={updateConfig} />}
        {step === 'review' && <ReviewStep config={config} onSubmit={handleSubmit} submitting={submitting} toolNames={Object.fromEntries(availableTools.map(t => [t.id, t.name]))} />}
      </div>

      <div className="builder-nav">
        {currentIdx > 0 && (
          <button className="builder-nav-btn" onClick={prevStep}>Back</button>
        )}
        {currentIdx < STEPS.length - 1 && step !== 'template' && (
          <button className="builder-nav-btn builder-nav-next" onClick={nextStep}>Next</button>
        )}
      </div>
    </div>
  );
}
