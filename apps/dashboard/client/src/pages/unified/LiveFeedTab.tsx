import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ForgeEvent } from '../../constants/status';
import { formatTimestamp } from '../../utils/format';
import './LiveFeedTab.css';

// ── Types ──

interface LiveFeedTabProps {
  wsEvents: ForgeEvent[];
}

type EventTypeFilter = 'all' | 'started' | 'completed' | 'failed' | 'progress';

// ── Helpers ──

function getEventTypeClass(type: string): string {
  switch (type) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'started': return 'started';
    case 'progress': return 'progress';
    default: return 'default';
  }
}

function summarizeEvent(event: ForgeEvent): string {
  const agent = event.agentName || event.agentId || 'System';
  const cat = event.category || 'event';
  const verb = event.type || 'unknown';

  // Try to extract a meaningful message from data
  if (event.data && typeof event.data === 'object') {
    const d = event.data as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.output === 'string') return d.output.slice(0, 120);
    if (typeof d.task === 'string') return `${cat} ${verb}: ${d.task}`;
  }

  if (typeof event.output === 'string') {
    return (event.output as string).slice(0, 120);
  }

  return `${agent} -- ${cat} ${verb}`;
}

function getUniqueAgentNames(events: ForgeEvent[]): string[] {
  const names = new Set<string>();
  for (const ev of events) {
    const name = ev.agentName || ev.agentId;
    if (name) names.add(name);
  }
  return Array.from(names).sort();
}

function formatPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── Stats Bar ──

function FeedStats({ events }: { events: ForgeEvent[] }) {
  const stats = useMemo(() => {
    const total = events.length;
    const completed = events.filter((e) => e.type === 'completed').length;
    const failed = events.filter((e) => e.type === 'failed').length;
    const active = events.filter((e) => e.type === 'started').length
      - events.filter((e) => e.type === 'completed' || e.type === 'failed').length;
    const rate = completed + failed > 0
      ? Math.round((completed / (completed + failed)) * 100)
      : 0;

    return {
      total,
      active: Math.max(0, active),
      successRate: rate,
    };
  }, [events]);

  return (
    <div className="livefeed-stats-grid">
      <div className="livefeed-stat-card">
        <div className="livefeed-stat-value livefeed-stat--total">{stats.total}</div>
        <div className="livefeed-stat-label">Total Events</div>
      </div>
      <div className="livefeed-stat-card">
        <div className="livefeed-stat-value livefeed-stat--active">
          {stats.active}
          {stats.active > 0 && <span className="livefeed-stat-pulse" />}
        </div>
        <div className="livefeed-stat-label">Active</div>
      </div>
      <div className="livefeed-stat-card">
        <div className="livefeed-stat-value livefeed-stat--rate">
          {stats.successRate}%
        </div>
        <div className="livefeed-stat-label">Success Rate</div>
      </div>
    </div>
  );
}

// ── Event Row ──

function EventRow({
  event,
  isExpanded,
  onToggle,
}: {
  event: ForgeEvent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const typeClass = getEventTypeClass(event.type);
  const agentLabel = event.agentName || event.agentId || 'System';

  return (
    <div
      className={`livefeed-event ${typeClass} ${isExpanded ? 'expanded' : ''}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      role="button"
      aria-expanded={isExpanded}
    >
      <div className="livefeed-event-row">
        <span className="livefeed-event-time">{formatTimestamp(event.receivedAt)}</span>
        <span className="livefeed-event-agent">{agentLabel}</span>
        <span className={`livefeed-event-type ${typeClass}`}>
          <span className="livefeed-event-dot" aria-hidden="true" />
          {event.type}
        </span>
        <span className="livefeed-event-summary">{summarizeEvent(event)}</span>
        <span className="livefeed-event-chevron" aria-hidden="true">
          {isExpanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>
      {isExpanded && (
        <div className="livefeed-event-detail">
          <div className="livefeed-event-meta">
            <span className="livefeed-meta-item">
              <span className="livefeed-meta-key">Category</span>
              <span className="livefeed-meta-val">{event.category}</span>
            </span>
            <span className="livefeed-meta-item">
              <span className="livefeed-meta-key">Type</span>
              <span className="livefeed-meta-val">{event.type}</span>
            </span>
            {event.agentId && (
              <span className="livefeed-meta-item">
                <span className="livefeed-meta-key">Agent ID</span>
                <span className="livefeed-meta-val">{event.agentId}</span>
              </span>
            )}
          </div>
          {event.data != null && (
            <pre className="livefeed-event-payload">{formatPayload(event.data)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export default function LiveFeedTab({ wsEvents }: LiveFeedTabProps) {
  const [agentFilter, setAgentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (!autoScroll) return;
    if (wsEvents.length <= prevLengthRef.current) {
      prevLengthRef.current = wsEvents.length;
      return;
    }
    prevLengthRef.current = wsEvents.length;

    const el = feedRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [wsEvents.length, autoScroll]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    let result = wsEvents;

    if (agentFilter) {
      const lower = agentFilter.toLowerCase();
      result = result.filter((ev) => {
        const name = (ev.agentName || ev.agentId || '').toLowerCase();
        return name.includes(lower);
      });
    }

    if (typeFilter !== 'all') {
      result = result.filter((ev) => ev.type === typeFilter);
    }

    return result;
  }, [wsEvents, agentFilter, typeFilter]);

  // Available agent names for filter suggestions
  const agentNames = useMemo(() => getUniqueAgentNames(wsEvents), [wsEvents]);

  const handleToggleExpand = useCallback((idx: number) => {
    setExpandedId((prev) => (prev === idx ? null : idx));
  }, []);

  const typeOptions: { key: EventTypeFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'started', label: 'Started' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' },
    { key: 'progress', label: 'Progress' },
  ];

  return (
    <div className="livefeed-tab">
      {/* Header */}
      <div className="livefeed-header">
        <div className="livefeed-title-row">
          <span className="livefeed-icon" aria-hidden="true">&#x25C9;</span>
          <h2 className="livefeed-title">Live Feed</h2>
          {wsEvents.length > 0 && (
            <span className="livefeed-live-badge">
              <span className="livefeed-live-dot" aria-hidden="true" />
              LIVE
            </span>
          )}
        </div>
        <p className="livefeed-subtitle">Real-time execution events</p>
      </div>

      {/* Stats */}
      <FeedStats events={wsEvents} />

      {/* Filter Bar */}
      <div className="livefeed-filter-bar">
        <div className="livefeed-filters">
          <input
            className="livefeed-search"
            type="search"
            placeholder="Filter by agent..."
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter events by agent name"
            list="livefeed-agent-list"
          />
          <datalist id="livefeed-agent-list">
            {agentNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <div className="livefeed-type-filters" role="radiogroup" aria-label="Filter by event type">
            {typeOptions.map((opt) => (
              <button
                key={opt.key}
                className={`livefeed-type-btn ${opt.key} ${typeFilter === opt.key ? 'active' : ''}`}
                onClick={() => setTypeFilter(opt.key)}
                role="radio"
                aria-checked={typeFilter === opt.key}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="livefeed-controls">
          <span className="livefeed-event-count">
            {filteredEvents.length}{filteredEvents.length !== wsEvents.length ? ` / ${wsEvents.length}` : ''} events
          </span>
          <label className="livefeed-autoscroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Event Feed */}
      <div className="livefeed-feed" ref={feedRef}>
        {filteredEvents.length === 0 ? (
          <div className="livefeed-empty">
            <div className="livefeed-empty-icon" aria-hidden="true">&#x2301;</div>
            <div className="livefeed-empty-title">
              {wsEvents.length === 0 ? 'No events yet' : 'No matching events'}
            </div>
            <div className="livefeed-empty-desc">
              {wsEvents.length === 0
                ? 'Execution events will appear here in real time as agents run.'
                : 'Try adjusting the filters above to see more events.'}
            </div>
          </div>
        ) : (
          filteredEvents.map((event, idx) => (
            <EventRow
              key={`${event.receivedAt}-${idx}`}
              event={event}
              isExpanded={expandedId === idx}
              onToggle={() => handleToggleExpand(idx)}
            />
          ))
        )}
      </div>
    </div>
  );
}
