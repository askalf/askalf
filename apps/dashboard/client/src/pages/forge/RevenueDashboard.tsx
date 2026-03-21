/**
 * Revenue Dashboard — Client management, billing, invoices.
 * "Revenue Mode" turns AskAlf from a tool into a business.
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001' : '';

interface Client {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  billing_rate_hourly: string | null;
  billing_markup: string | null;
  status: string;
  created_at: string;
}

interface RevenueSummary {
  totalRevenue: number;
  activeClients: number;
  pendingInvoices: number;
  pendingTotal: number;
}

export default function RevenueDashboard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newMarkup, setNewMarkup] = useState('1.5');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/forge/clients`, { credentials: 'include' }).then(r => r.ok ? r.json() : { clients: [] }),
        fetch(`${API_BASE}/api/v1/forge/revenue/summary`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ]);
      setClients(clientsRes.clients ?? []);
      setSummary(summaryRes);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddClient = async () => {
    if (!newName.trim()) return;
    await fetch(`${API_BASE}/api/v1/forge/clients`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        email: newEmail.trim() || undefined,
        company: newCompany.trim() || undefined,
        billing_rate_hourly: newRate ? parseFloat(newRate) : undefined,
        billing_markup: newMarkup ? parseFloat(newMarkup) : 1.0,
      }),
    }).catch(() => {});
    setNewName(''); setNewEmail(''); setNewCompany(''); setNewRate('');
    setShowAdd(false);
    await fetchData();
  };

  const handleArchive = async (id: string) => {
    await fetch(`${API_BASE}/api/v1/forge/clients/${id}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {});
    setClients(c => c.filter(x => x.id !== id));
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>Revenue Mode</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Manage clients, track billable work, generate invoices
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            padding: '6px 16px', fontSize: '0.8rem', fontWeight: 600, borderRadius: '6px',
            background: 'var(--crystal, #7c3aed)', color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          + Add Client
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
          <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#22c55e' }}>${summary.totalRevenue.toFixed(2)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Revenue (Paid)</div>
          </div>
          <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--crystal, #7c3aed)' }}>{summary.activeClients}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Active Clients</div>
          </div>
          <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>{summary.pendingInvoices}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Pending Invoices</div>
          </div>
          <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>${summary.pendingTotal.toFixed(2)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Outstanding</div>
          </div>
        </div>
      )}

      {/* Add Client Form */}
      {showAdd && (
        <div style={{
          padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '10px', marginBottom: '1rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Client name *"
              style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.85rem' }} />
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email"
              style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.85rem' }} />
            <input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Company"
              style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.85rem' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="$/hr rate" type="number"
                style={{ flex: 1, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.85rem' }} />
              <input value={newMarkup} onChange={e => setNewMarkup(e.target.value)} placeholder="Markup (1.5x)" type="number" step="0.1"
                style={{ width: '80px', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.85rem' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAddClient} disabled={!newName.trim()}
              style={{ padding: '6px 16px', fontSize: '0.8rem', fontWeight: 600, borderRadius: '6px', background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Save Client
            </button>
            <button onClick={() => setShowAdd(false)}
              style={{ padding: '6px 16px', fontSize: '0.8rem', borderRadius: '6px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Client List */}
      {loading ? (
        <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading clients...</div>
      ) : clients.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>No clients yet.</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Add clients to track billable work and generate invoices from agent executions.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {clients.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: '10px',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>{c.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {[c.company, c.email].filter(Boolean).join(' · ') || 'No details'}
                </div>
              </div>
              {c.billing_rate_hourly && (
                <span style={{ fontSize: '0.8rem', color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
                  ${parseFloat(c.billing_rate_hourly).toFixed(0)}/hr
                </span>
              )}
              {c.billing_markup && parseFloat(c.billing_markup) > 1 && (
                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#a78bfa' }}>
                  {parseFloat(c.billing_markup)}x markup
                </span>
              )}
              <button onClick={() => handleArchive(c.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
                title="Archive">
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
