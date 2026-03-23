/**
 * DevicesPanel — Live device management under Team tab.
 * Shows connected devices, health, capabilities, task history, quick actions.
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';

interface Device {
  id: string;
  device_name: string;
  device_type: string;
  hostname: string;
  os: string;
  status: 'online' | 'offline' | 'busy';
  capabilities: Record<string, boolean>;
  last_heartbeat: string | null;
  connected_at: string | null;
  task_count: number;
  current_task: string | null;
}

const TYPE_ICONS: Record<string, string> = {
  cli: '\u{1F4BB}', docker: '\u{1F433}', ssh: '\u{1F510}', k8s: '\u{2699}\uFE0F',
  browser: '\u{1F310}', desktop: '\u{1F5A5}\uFE0F', vscode: '\u{1F4DD}',
  android: '\u{1F4F1}', ios: '\u{1F34E}',
  rpi: '\u{1F353}', arduino: '\u{1F4A1}', homeassistant: '\u{1F3E0}',
};

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',
  busy: '#f59e0b',
  offline: '#6b7280',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function DevicesPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [envDevices, setEnvDevices] = useState<Record<string, string[]>>({});
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [dispatchInput, setDispatchInput] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const fetchDevices = useCallback(async () => {
    try {
      const [devRes, envRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/forge/devices`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/forge/devices/env-status`, { credentials: 'include' }),
      ]);
      if (devRes.ok) {
        const data = await devRes.json() as { devices: Device[] };
        setDevices(data.devices || []);
      }
      if (envRes.ok) {
        const data = await envRes.json() as { devices: Array<{ type: string; envKeys: string[]; configured: boolean }> };
        const envMap: Record<string, string[]> = {};
        for (const d of data.devices) {
          if (d.envKeys.length > 0) envMap[d.type] = d.envKeys;
        }
        setEnvDevices(envMap);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDevices();
    const timer = setInterval(fetchDevices, 15000); // Refresh every 15s
    return () => clearInterval(timer);
  }, [fetchDevices]);

  const handlePing = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${id}/ping`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Ping sent' });
      } else {
        setMessage({ type: 'error', text: 'Ping failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Ping failed' });
    }
    setActionLoading(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDispatch = async (deviceId: string) => {
    if (!dispatchInput.trim()) return;
    setDispatching(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/executions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: dispatchInput.trim(), deviceId }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Task dispatched to device' });
        setDispatchId(null);
        setDispatchInput('');
      } else {
        setMessage({ type: 'error', text: 'Dispatch failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Dispatch failed' });
    }
    setDispatching(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRemove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Device removed' });
        fetchDevices();
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove' });
    }
    setActionLoading(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDisconnect = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${id}/disconnect`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Device disconnected' });
        fetchDevices();
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect' });
    }
    setActionLoading(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const filteredDevices = devices.filter(d => {
    if (filter === 'online') return d.status === 'online' || d.status === 'busy';
    if (filter === 'offline') return d.status === 'offline';
    return true;
  });

  const onlineCount = devices.filter(d => d.status === 'online' || d.status === 'busy').length;
  const busyCount = devices.filter(d => d.status === 'busy').length;

  if (loading) {
    return <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading devices...</div>;
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header with Add Device */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Devices</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Connected machines that workers can dispatch tasks to</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowAdd(!showAdd)}
            style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)', color: '#a78bfa' }}>
            {showAdd ? 'Cancel' : '+ Add Device'}
          </button>
          <button onClick={() => fetchDevices()}
            style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)' }}>
            Refresh
          </button>
        </div>
      </div>

      {/* Add Device instructions */}
      {showAdd && (
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Connect a Device</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px' }}><strong>CLI Agent</strong> (any machine with Node.js):</p>
            <code style={{ display: 'block', padding: '8px 12px', background: 'var(--elevated)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#a78bfa', marginBottom: 8 }}>
              npm install -g @askalf/agent && askalf-agent connect YOUR_API_KEY
            </code>
            <p style={{ margin: '0 0 4px' }}><strong>Docker, SSH, K8s, Home Assistant</strong> — configure in Settings &gt; Devices</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>{devices.length}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
        </div>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#22c55e' }}>{onlineCount}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Online</div>
        </div>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b' }}>{busyCount}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Busy</div>
        </div>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#6b7280' }}>{devices.length - onlineCount}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Offline</div>
        </div>
      </div>

      {/* Filter + message */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'online', 'offline'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: '5px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                border: filter === f ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)',
                background: filter === f ? 'rgba(124,58,237,0.12)' : 'var(--surface)',
                color: filter === f ? '#a78bfa' : 'var(--text-muted)',
              }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {message && (
          <span style={{ fontSize: '0.8rem', color: message.type === 'success' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{message.text}</span>
        )}
      </div>

      {/* Device list */}
      {filteredDevices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.3 }}>{'\u{1F4BB}'}</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            {devices.length === 0 ? 'No devices connected yet' : 'No devices match this filter'}
          </p>
          {devices.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '6px 0 0', opacity: 0.7 }}>
              Install the agent: <code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: 4 }}>npm install -g @askalf/agent</code>
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredDevices.map(device => {
            const isSelected = selectedDevice === device.id;
            const icon = TYPE_ICONS[device.device_type] || '\u{1F4BB}';
            const statusColor = STATUS_COLORS[device.status] || '#6b7280';
            const caps = Object.entries(device.capabilities || {}).filter(([, v]) => v).map(([k]) => k);

            return (
              <div key={device.id}
                style={{
                  padding: '12px 16px', background: 'var(--surface)', border: `1px solid ${isSelected ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
                  borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onClick={() => setSelectedDevice(isSelected ? null : device.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '1.3rem' }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>{device.device_name}</span>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                      <span style={{ fontSize: '0.7rem', color: statusColor, fontWeight: 600 }}>{device.status}</span>
                      {envDevices[device.device_type] && (
                        <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>.env</span>
                      )}
                      <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>Encrypted</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {device.hostname} &middot; {device.os} &middot; Last seen {timeAgo(device.last_heartbeat)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{device.task_count} tasks</div>
                    {device.current_task && (
                      <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>Running: {device.current_task.slice(0, 30)}...</div>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isSelected && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    {/* Capabilities */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Capabilities</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {caps.length > 0 ? caps.map(c => (
                          <span key={c} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: 10, background: 'rgba(124,58,237,0.08)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>{c}</span>
                        )) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>None detected</span>
                        )}
                      </div>
                    </div>

                    {/* Connection info */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.75rem', marginBottom: 10 }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Connected:</span> <span style={{ color: 'var(--text)' }}>{device.connected_at ? new Date(device.connected_at).toLocaleString() : 'N/A'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Type:</span> <span style={{ color: 'var(--text)' }}>{device.device_type}</span></div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePing(device.id); }}
                        disabled={actionLoading === device.id || device.status === 'offline'}
                        style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                      >
                        {actionLoading === device.id ? '...' : 'Ping'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDispatchId(dispatchId === device.id ? null : device.id); }}
                        disabled={device.status === 'offline'}
                        style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)', color: '#a78bfa' }}
                      >
                        Dispatch Task
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDisconnect(device.id); }}
                        disabled={actionLoading === device.id || device.status === 'offline'}
                        style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemove(device.id); }}
                        disabled={actionLoading === device.id}
                        style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', opacity: 0.6 }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Dispatch input */}
                    {dispatchId === device.id && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                        <input
                          value={dispatchInput}
                          onChange={e => setDispatchInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleDispatch(device.id); }}
                          placeholder="Describe the task to run on this device..."
                          autoFocus
                          onClick={e => e.stopPropagation()}
                          style={{ flex: 1, padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.8rem' }}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDispatch(device.id); }}
                          disabled={dispatching || !dispatchInput.trim()}
                          style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: !dispatchInput.trim() ? 0.4 : 1 }}
                        >
                          {dispatching ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
