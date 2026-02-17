import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface EventEntry {
  id: number;
  event_type: string;
  event_name: string;
  agent_name: string | null;
  execution_id: string | null;
  session_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

interface EventStats {
  totalEvents: number;
  eventsLast24h: number;
  topEventTypes: Array<{ type: string; count: number }>;
}

export default function EventLog() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [eventsData, statsData] = await Promise.all([
        hubApi.events.recent(100) as Promise<EventEntry[]>,
        hubApi.events.stats() as Promise<EventStats>,
      ]);
      setEvents(eventsData);
      setStats(statsData);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 15000);

  const typeColors: Record<string, string> = {
    execution: '#6366f1', coordination: '#06b6d4', agent: '#4ade80', handoff: '#f97316',
  };

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={stats?.totalEvents ?? '-'} label="Total Events" />
        <StatCard value={stats?.eventsLast24h ?? '-'} label="Last 24h" />
        <StatCard value={events.length} label="Showing" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '16px' }}>
        {/* Event Timeline */}
        <div className="fo-section">
          <div className="fo-section-header">
            <h3>Event Timeline</h3>
            <button className="hub-btn hub-btn--sm" onClick={fetchData} disabled={loading}>Refresh</button>
          </div>

          {loading && <div className="fo-empty">Loading events...</div>}

          {events.map((event) => (
            <div key={event.id} className="fo-card" onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
              style={{ marginBottom: '4px', padding: '8px 12px', cursor: 'pointer', borderLeft: `3px solid ${typeColors[event.event_type] || '#6b7280'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: typeColors[event.event_type] || '#6b7280' }}>
                    {event.event_type}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>{event.event_name}</span>
                  {event.agent_name && <span style={{ fontSize: '11px', opacity: 0.6 }}>{event.agent_name}</span>}
                </div>
                <span style={{ fontSize: '11px', opacity: 0.4 }}>{new Date(event.created_at).toLocaleTimeString()}</span>
              </div>
              {expandedId === event.id && (
                <pre style={{ fontSize: '10px', marginTop: '6px', padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>

        {/* Event Type Stats */}
        <div className="fo-section">
          <div className="fo-section-header"><h3>By Type</h3></div>
          {stats?.topEventTypes.map((t) => (
            <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: typeColors[t.type] || '#6b7280' }}>{t.type}</span>
              <span style={{ fontWeight: 600 }}>{t.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
