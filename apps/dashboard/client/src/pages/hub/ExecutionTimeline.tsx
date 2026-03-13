import React, { useState, useMemo } from 'react';

interface ToolCall {
  name: string;
  input?: unknown;
  result?: unknown;
}

interface IterationLog {
  iterIndex: number;
  timestamp: string | null;
  tool_calls: ToolCall[];
}

interface FlatToolCall {
  id: string;
  name: string;
  toolType: ToolType;
  iterIndex: number;
  callIndexInIter: number;
  totalCallIndex: number;
  input?: unknown;
  result?: unknown;
}

type ToolType = 'code' | 'db' | 'file' | 'memory' | 'web' | 'security' | 'ticket' | 'agent' | 'other';

const TOOL_COLORS: Record<ToolType, { bg: string; text: string; label: string }> = {
  code:     { bg: '#3b82f6', text: '#fff', label: 'Code/Shell' },
  db:       { bg: '#10b981', text: '#fff', label: 'Database' },
  file:     { bg: '#06b6d4', text: '#fff', label: 'File I/O' },
  memory:   { bg: '#8b5cf6', text: '#fff', label: 'Memory' },
  web:      { bg: '#f59e0b', text: '#000', label: 'Web' },
  security: { bg: '#ef4444', text: '#fff', label: 'Security' },
  ticket:   { bg: '#6366f1', text: '#fff', label: 'Tickets' },
  agent:    { bg: '#ec4899', text: '#fff', label: 'Agent' },
  other:    { bg: '#6b7280', text: '#fff', label: 'Other' },
};

function classifyTool(name: string): ToolType {
  const n = name.toLowerCase();
  if (/bash|execute|shell|command|run_command|terminal/.test(n)) return 'code';
  if (/db_query|database|sql|substrate_db|query/.test(n)) return 'db';
  if (/read|write|edit|glob|grep|file|notebook/.test(n)) return 'file';
  if (/memory|memory_search|memory_store|forge_memory|brain/.test(n)) return 'memory';
  if (/web|fetch|search|browse|url|http/.test(n)) return 'web';
  if (/security|finding|scan|audit/.test(n)) return 'security';
  if (/ticket|task/.test(n)) return 'ticket';
  if (/agent|delegate|call|dispatch/.test(n)) return 'agent';
  return 'other';
}

function formatInput(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 2000);
  return JSON.stringify(input, null, 2).slice(0, 2000);
}

function formatResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result.slice(0, 2000);
  return JSON.stringify(result, null, 2).slice(0, 2000);
}

interface AgentLog {
  id: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Props {
  logs: AgentLog[];
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds?: number | null;
  tokensUsed?: number;
  cost?: number;
}

export function ExecutionTimeline({ logs, startedAt, completedAt, durationSeconds, tokensUsed, cost }: Props) {
  const [selectedCall, setSelectedCall] = useState<FlatToolCall | null>(null);
  const [activeType, setActiveType] = useState<ToolType | null>(null);

  // Parse iterations from logs
  const { iterations, flatCalls, typeCounts } = useMemo(() => {
    const iters: IterationLog[] = [];
    for (const log of logs) {
      const toolCalls = log.metadata?.tool_calls;
      if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) continue;
      iters.push({
        iterIndex: iters.length,
        timestamp: log.created_at,
        tool_calls: toolCalls as ToolCall[],
      });
    }

    let totalIdx = 0;
    const flat: FlatToolCall[] = [];
    const counts: Partial<Record<ToolType, number>> = {};

    for (const iter of iters) {
      iter.tool_calls.forEach((tc, callIdx) => {
        const toolType = classifyTool(tc.name || '');
        flat.push({
          id: `${iter.iterIndex}-${callIdx}`,
          name: tc.name || 'unknown',
          toolType,
          iterIndex: iter.iterIndex,
          callIndexInIter: callIdx,
          totalCallIndex: totalIdx++,
          input: tc.input,
          result: tc.result,
        });
        counts[toolType] = (counts[toolType] || 0) + 1;
      });
    }

    return { iterations: iters, flatCalls: flat, typeCounts: counts };
  }, [logs]);

  const totalCalls = flatCalls.length;

  if (totalCalls === 0) {
    return (
      <div className="etl-empty">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
          <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <span>No tool call data available for this execution</span>
      </div>
    );
  }

  const filteredCalls = activeType ? flatCalls.filter(c => c.toolType === activeType) : flatCalls;
  const presentTypes = Object.keys(typeCounts) as ToolType[];

  // Duration display
  const durationLabel = durationSeconds
    ? `${durationSeconds.toFixed(1)}s`
    : (startedAt && completedAt)
      ? `${((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="etl-root">
      {/* Header stats */}
      <div className="etl-stats">
        <span className="etl-stat"><strong>{totalCalls}</strong> tool calls</span>
        <span className="etl-stat"><strong>{iterations.length}</strong> iterations</span>
        {durationLabel && <span className="etl-stat"><strong>{durationLabel}</strong> duration</span>}
        {tokensUsed != null && tokensUsed > 0 && (
          <span className="etl-stat"><strong>{tokensUsed.toLocaleString()}</strong> tokens</span>
        )}
        {cost != null && cost > 0 && (
          <span className="etl-stat"><strong>${cost.toFixed(4)}</strong> cost</span>
        )}
      </div>

      {/* Legend / filters */}
      <div className="etl-legend">
        {presentTypes.map(type => {
          const col = TOOL_COLORS[type];
          const isActive = activeType === type;
          return (
            <button
              key={type}
              className={`etl-legend-btn${isActive ? ' etl-legend-btn--active' : ''}`}
              style={{ '--btn-color': col.bg } as React.CSSProperties}
              onClick={() => setActiveType(isActive ? null : type)}
            >
              <span className="etl-legend-dot" style={{ background: col.bg }} />
              {col.label}
              <span className="etl-legend-count">{typeCounts[type]}</span>
            </button>
          );
        })}
      </div>

      {/* Timeline track */}
      <div className="etl-track-wrap">
        <div className="etl-track">
          {flatCalls.map((call) => {
            const col = TOOL_COLORS[call.toolType];
            const isFiltered = activeType && call.toolType !== activeType;
            const isSelected = selectedCall?.id === call.id;
            return (
              <button
                key={call.id}
                className={`etl-bar${isSelected ? ' etl-bar--selected' : ''}${isFiltered ? ' etl-bar--dimmed' : ''}`}
                style={{ background: isFiltered ? '#2a2a2a' : col.bg }}
                title={call.name}
                onClick={() => setSelectedCall(isSelected ? null : call)}
              />
            );
          })}
        </div>
        <div className="etl-track-labels">
          <span>0</span>
          <span>{Math.floor(totalCalls / 2)}</span>
          <span>{totalCalls}</span>
        </div>
      </div>

      {/* Detail panel for selected call */}
      {selectedCall && (
        <div className="etl-detail">
          <div className="etl-detail-header">
            <span
              className="etl-detail-badge"
              style={{ background: TOOL_COLORS[selectedCall.toolType].bg, color: TOOL_COLORS[selectedCall.toolType].text }}
            >
              {selectedCall.name}
            </span>
            <span className="etl-detail-meta">
              call #{selectedCall.totalCallIndex + 1} · iter {selectedCall.iterIndex + 1}
            </span>
            <button className="etl-detail-close" onClick={() => setSelectedCall(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          {selectedCall.input != null && (
            <div className="etl-detail-block">
              <div className="etl-detail-label">Input</div>
              <pre className="etl-detail-pre">{formatInput(selectedCall.input)}</pre>
            </div>
          )}
          {selectedCall.result != null && (
            <div className="etl-detail-block">
              <div className="etl-detail-label">Output</div>
              <pre className="etl-detail-pre">{formatResult(selectedCall.result)}</pre>
            </div>
          )}
          {selectedCall.input == null && selectedCall.result == null && (
            <div className="etl-detail-empty">No input/output data stored for this tool call</div>
          )}
        </div>
      )}

      {/* Per-iteration breakdown */}
      {iterations.length > 1 && (
        <div className="etl-iter-grid">
          {iterations.map((iter) => {
            const calls = filteredCalls.filter(c => c.iterIndex === iter.iterIndex);
            if (calls.length === 0 && activeType) return null;
            const allCalls = flatCalls.filter(c => c.iterIndex === iter.iterIndex);
            return (
              <div key={iter.iterIndex} className="etl-iter">
                <div className="etl-iter-label">iter {iter.iterIndex + 1}</div>
                <div className="etl-iter-bars">
                  {allCalls.map((call) => {
                    const col = TOOL_COLORS[call.toolType];
                    const isFiltered = activeType && call.toolType !== activeType;
                    const isSelected = selectedCall?.id === call.id;
                    return (
                      <button
                        key={call.id}
                        className={`etl-iter-bar${isSelected ? ' etl-iter-bar--selected' : ''}${isFiltered ? ' etl-iter-bar--dimmed' : ''}`}
                        style={{ background: isFiltered ? '#333' : col.bg }}
                        title={call.name}
                        onClick={() => setSelectedCall(isSelected ? null : call)}
                      />
                    );
                  })}
                </div>
                <span className="etl-iter-count">{allCalls.length}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
