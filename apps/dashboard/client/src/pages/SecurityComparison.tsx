import { useEffect } from 'react';

const features = [
  { category: 'Architecture', feature: 'Multi-agent fleet orchestration', askalf: true, openclaw: false, detail: 'Specialized agents (Security, Backend Dev, Infra, QA) working autonomously' },
  { category: 'Architecture', feature: 'Autonomous brain with memory', askalf: true, openclaw: false, detail: 'Semantic, episodic, and procedural memory with knowledge graph' },
  { category: 'Architecture', feature: 'Self-healing ticket system', askalf: true, openclaw: false, detail: 'Core engine creates, routes, and tracks investigation tickets' },
  { category: 'Security', feature: 'Internal API authentication', askalf: true, openclaw: false, detail: 'HMAC-signed inter-service communication' },
  { category: 'Security', feature: 'Encrypted credential storage', askalf: true, openclaw: false, detail: 'AES-256-GCM encryption for all channel tokens and secrets' },
  { category: 'Security', feature: 'Sandboxed execution', askalf: true, openclaw: false, detail: 'Docker containers with cap_drop ALL, no-new-privileges' },
  { category: 'Security', feature: 'Approval workflows', askalf: true, openclaw: false, detail: 'Intervention requests require human approval for high-risk actions' },
  { category: 'Security', feature: 'VPN tunneling', askalf: true, openclaw: false, detail: 'Optional WireGuard VPN for all outbound API traffic' },
  { category: 'Security', feature: 'Webhook signature verification', askalf: true, openclaw: true, detail: 'HMAC-SHA256 verification on all inbound webhooks' },
  { category: 'Security', feature: 'Security audit passed', askalf: true, openclaw: false, detail: 'OpenClaw had 512 vulnerabilities found in January 2026 audit' },
  { category: 'Operations', feature: 'Visual dashboard', askalf: true, openclaw: false, detail: 'Full web UI for agent management, executions, and monitoring' },
  { category: 'Operations', feature: 'Fleet health monitoring', askalf: true, openclaw: false, detail: 'Watchdog agent with scheduled health checks' },
  { category: 'Operations', feature: 'Cost tracking & budgets', askalf: true, openclaw: false, detail: 'Per-agent cost tracking with configurable budget limits' },
  { category: 'Operations', feature: 'Execution audit trail', askalf: true, openclaw: false, detail: 'Full audit log of all agent actions and tool calls' },
  { category: 'Integration', feature: 'Chat platform channels', askalf: true, openclaw: true, detail: 'Slack, Discord, Telegram, WhatsApp, Teams, and more' },
  { category: 'Integration', feature: 'OpenClaw bridge', askalf: true, openclaw: false, detail: 'Connect OpenClaw as a channel frontend to AskAlf fleet' },
  { category: 'Integration', feature: 'MCP tool ecosystem', askalf: true, openclaw: false, detail: '26 built-in MCP tools with community marketplace' },
  { category: 'Integration', feature: 'Automation platforms', askalf: true, openclaw: true, detail: 'Zapier, n8n, Make webhooks' },
];

export default function SecurityComparison() {
  useEffect(() => { document.title = 'AskAlf vs OpenClaw — Security & Features'; }, []);

  const categories = [...new Set(features.map(f => f.category))];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px', fontFamily: 'var(--font-sans, system-ui)' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 12, color: 'var(--text-primary, #e2e8f0)' }}>
          AskAlf vs OpenClaw
        </h1>
        <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary, #94a3b8)', maxWidth: 600, margin: '0 auto' }}>
          OpenClaw is a personal assistant. AskAlf is your autonomous engineering team.
        </p>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48,
      }}>
        <div style={{
          padding: 24, borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(139,92,246,0.05))',
          border: '1px solid rgba(139,92,246,0.3)',
        }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>AskAlf</h3>
          <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Multi-agent fleet with autonomous brain, persistent memory, fleet orchestration,
            and enterprise security. Agents investigate, coordinate, and resolve issues on their own.
          </p>
        </div>
        <div style={{
          padding: 24, borderRadius: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-secondary, #94a3b8)', marginBottom: 8 }}>OpenClaw</h3>
          <p style={{ color: 'var(--text-tertiary, #64748b)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Single-agent personal assistant with chat integrations.
            512 vulnerabilities found in security audit. Creator departed for OpenAI.
          </p>
        </div>
      </div>

      {categories.map(category => (
        <div key={category} style={{ marginBottom: 32 }}>
          <h2 style={{
            fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--text-tertiary, #64748b)',
            marginBottom: 12, paddingBottom: 8,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            {category}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {features.filter(f => f.category === category).map((f, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 80px',
                alignItems: 'center', padding: '10px 16px', borderRadius: 8,
                background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
              }}>
                <div>
                  <span style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: '0.9rem', fontWeight: 500 }}>
                    {f.feature}
                  </span>
                  <span style={{ color: 'var(--text-tertiary, #64748b)', fontSize: '0.8rem', marginLeft: 8 }}>
                    {f.detail}
                  </span>
                </div>
                <div style={{ textAlign: 'center', fontSize: '1.1rem' }}>
                  {f.askalf ? <span style={{ color: '#22c55e' }}>Yes</span> : <span style={{ color: '#ef4444' }}>No</span>}
                </div>
                <div style={{ textAlign: 'center', fontSize: '1.1rem' }}>
                  {f.openclaw ? <span style={{ color: '#22c55e' }}>Yes</span> : <span style={{ color: '#ef4444' }}>No</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ textAlign: 'center', marginTop: 48, paddingTop: 32, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ color: 'var(--text-secondary, #94a3b8)', marginBottom: 16 }}>
          Ready to deploy your autonomous agent fleet?
        </p>
        <code style={{
          display: 'inline-block', padding: '12px 24px', borderRadius: 8,
          background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
          color: '#a78bfa', fontSize: '0.95rem', fontFamily: 'var(--font-mono)',
        }}>
          curl -fsSL https://get.askalf.org | bash
        </code>
      </div>
    </div>
  );
}
