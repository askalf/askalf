import { Link } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import './Landing.css';

const agents = [
  {
    name: 'Researcher',
    slug: 'researcher',
    type: 'research',
    desc: 'Web research, competitor analysis, SEO audits, market intelligence. Browses the web, compiles reports, extracts data from any site.',
  },
  {
    name: 'Sentinel',
    slug: 'sentinel',
    type: 'security',
    desc: 'Security scanning, dependency auditing, CVE detection. SSHs into servers, scans codebases, identifies vulnerabilities before they ship.',
  },
  {
    name: 'Developer',
    slug: 'developer',
    type: 'dev',
    desc: 'Code review, testing, full-stack development. Opens your IDE, writes and commits code, runs test suites, debugs issues.',
  },
  {
    name: 'Writer',
    slug: 'writer',
    type: 'content',
    desc: 'Content creation, documentation, release notes, blog posts. Drafts in your tools, formats for your audience, maintains your voice.',
  },
  {
    name: 'Watchdog',
    slug: 'watchdog',
    type: 'monitor',
    desc: 'System monitoring, incident response, performance tracking. Watches dashboards, traces latency, alerts you before users notice.',
  },
  {
    name: 'Analyst',
    slug: 'analyst',
    type: 'research',
    desc: 'Data analysis, performance profiling, trend detection. Queries databases, builds visualizations, surfaces insights from your data.',
  },
];

const installCommands = [
  { label: 'macOS / Linux', cmd: 'curl -fsSL https://askalf.org/install.sh | sh' },
  { label: 'Windows (PowerShell)', cmd: 'irm https://askalf.org/install.ps1 | iex' },
  { label: 'npm (manual)', cmd: 'npm install -g @askalf/cli' },
];

function CliInstallBlock() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(installCommands[activeTab].cmd).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeTab]);

  return (
    <div style={{
      background: '#0d0d0d',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {installCommands.map((item, i) => (
          <button
            key={item.label}
            onClick={() => { setActiveTab(i); setCopied(false); }}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontFamily: 'JetBrains Mono, monospace',
              background: i === activeTab ? 'rgba(138, 92, 246, 0.1)' : 'transparent',
              color: i === activeTab ? '#a78bfa' : 'var(--text-secondary)',
              border: 'none',
              borderBottom: i === activeTab ? '2px solid #a78bfa' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        gap: '1rem',
      }}>
        <code style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.8125rem',
          color: '#06d6a0',
          lineHeight: 1.5,
          wordBreak: 'break-all',
        }}>
          <span style={{ color: 'var(--text-secondary)', userSelect: 'none' }}>$ </span>
          {installCommands[activeTab].cmd}
        </code>
        <button
          onClick={copy}
          title="Copy to clipboard"
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: '0.6875rem',
            fontFamily: 'JetBrains Mono, monospace',
            background: copied ? 'rgba(6, 214, 160, 0.15)' : 'rgba(255,255,255,0.05)',
            color: copied ? '#06d6a0' : 'var(--text-secondary)',
            border: `1px solid ${copied ? 'rgba(6, 214, 160, 0.3)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function DocsPage() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Docs — AskAlf';
  }, []);

  return (
    <div className="landing-page legal-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">askalf</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      <section className="legal-content" style={{ maxWidth: 800 }}>
        <p className="landing-section-label">// docs</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Getting Started</h1>
        <p className="legal-updated">AskAlf Beta</p>

        <div className="legal-body">
          <h2>What is AskAlf?</h2>
          <p>
            AskAlf is an AI agent platform where agents don&apos;t just chat &mdash; they use computers
            like you do. They control mouse and keyboard, browse the web, SSH into servers, open
            applications, read and write files, and execute shell commands. Think of them as digital
            employees that sit at a virtual desk and do real work.
          </p>

          <h2>Quick Start</h2>
          <p>Three steps to get your first agent working:</p>

          <h3>1. Create Your Account</h3>
          <p>
            If you received a beta invite, click the link in your email to register. You&apos;ll set up
            a password and go through a quick onboarding wizard to name your workspace and pick a theme.
          </p>

          <h3>2. Start Using Agents</h3>
          <p>
            During the private beta, AI access is included &mdash; no API keys required. Your agents run
            on the platform&apos;s infrastructure out of the box.
          </p>
          <p>
            <strong>Optional: Bring Your Own Key (BYOK)</strong> &mdash; If you prefer to use your own
            API keys for direct billing or specific rate limits, go to <strong>Settings &rarr; AI Keys</strong> and
            add keys for any supported provider:
          </p>
          <ul>
            <li><strong>Anthropic</strong> &mdash; <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></li>
            <li><strong>OpenAI</strong> &mdash; <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer">platform.openai.com</a></li>
            <li><strong>xAI</strong> &mdash; <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer">console.x.ai</a></li>
            <li><strong>DeepSeek</strong> &mdash; <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer">platform.deepseek.com</a></li>
          </ul>
          <p>
            When a BYOK key is configured, it takes priority over the platform&apos;s default. Keys are
            encrypted at rest and only used when you run agents.
          </p>

          <h3>3. Run Your First Agent</h3>
          <p>
            From the Command Center, use the chat interface to describe what you need done. The platform
            will match your request to the right agent and execute it. Try something simple:
          </p>
          <ul>
            <li>&ldquo;Research the top 5 competitors in [your space]&rdquo;</li>
            <li>&ldquo;Review the code in [repo] for security issues&rdquo;</li>
            <li>&ldquo;Write release notes for our latest update&rdquo;</li>
            <li>&ldquo;Monitor our API response times and flag anything slow&rdquo;</li>
          </ul>

          <h2 id="cli">Install the CLI</h2>
          <p>
            Manage your agents from the terminal. One command to install on any OS:
          </p>

          <CliInstallBlock />

          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Requires Node.js 20+. The installer will attempt to install it automatically if missing.
          </p>

          <h2 id="agents">Your Agents</h2>
          <p>
            You have six agents available, each specialized for different types of work:
          </p>

          {agents.map((agent) => (
            <div key={agent.slug} style={{
              padding: '1rem 1.25rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                <strong style={{ color: 'var(--text)' }}>{agent.name}</strong>
                <span style={{
                  fontSize: '0.6875rem',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(138, 92, 246, 0.15)',
                  color: '#a78bfa',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>{agent.type}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {agent.desc}
              </p>
            </div>
          ))}

          <h2>The Dashboard</h2>
          <p>
            The Command Center is your home base. It has five tabs:
          </p>
          <ul>
            <li><strong>Coordinator</strong> &mdash; Orchestrate multi-agent workflows: fan-out tasks to multiple agents, create pipelines, or use consensus patterns.</li>
            <li><strong>Fleet</strong> &mdash; See all your agents at a glance. View their status, recent activity, and performance metrics.</li>
            <li><strong>Deploy</strong> &mdash; Create and configure new agents, or modify existing ones.</li>
            <li><strong>Exec</strong> &mdash; View execution history, logs, and traces for every agent action.</li>
            <li><strong>$$</strong> &mdash; Track costs across all agents and providers. See spending by agent, by provider, and over time.</li>
          </ul>

          <h2>Key Concepts</h2>

          <h3>Computer Use</h3>
          <p>
            Unlike chatbots, AskAlf agents have full computer access. They can move the mouse, type on the
            keyboard, open browsers, navigate websites, use terminal commands, and interact with any
            application &mdash; just like a human at a desk.
          </p>

          <h3>Guardrails &amp; Checkpoints</h3>
          <p>
            Agents that control computers need safety rails. You can configure human-in-the-loop approvals
            for sensitive actions, set execution boundaries, and enable content filtering. Checkpoints
            let you review what an agent is about to do before it executes.
          </p>

          <h3>Cost Control</h3>
          <p>
            Every agent has configurable cost limits. Set per-execution budgets, per-agent caps, and track
            spending in real time. The platform shows you exactly how much each task costs so there are
            no surprises.
          </p>

          <h3>Multi-Provider</h3>
          <p>
            Different agents can use different AI providers. Run your researcher on Claude, your developer
            on GPT, and your analyst on DeepSeek &mdash; each using the model best suited for the task.
            Switch providers per-agent without changing anything else.
          </p>

          <h3>24 Built-in Tools</h3>
          <p>
            Agents have access to tools for database queries, Docker management, web search, code analysis,
            team coordination, and more &mdash; all via the Model Context Protocol (MCP). You can see
            which tools each agent has access to in the Deploy tab.
          </p>

          <h2>FAQ</h2>

          <h3>How much does it cost?</h3>
          <p>
            During the private beta, everything is included &mdash; AI usage, compute, and all platform
            features. No credit card required. When we launch paid tiers, beta members get guaranteed
            early-adopter pricing.
          </p>

          <h3>Where does compute happen?</h3>
          <p>
            Everything runs on our infrastructure &mdash; orchestration, AI inference, and computer-use
            actions. If you configure your own API keys (BYOK), inference routes through your provider
            account instead. Computer-use actions (mouse, keyboard, browser) always execute in isolated,
            sandboxed containers.
          </p>

          <h3>Is my data safe?</h3>
          <p>
            API keys are encrypted at rest (AES-256). Agent sessions run in isolated containers with no
            shared state. All traffic is encrypted with TLS 1.3. We don&apos;t use your data to train
            models. See our <Link to="/privacy" style={{ color: '#a78bfa' }}>Privacy Policy</Link> for full details.
          </p>

          <h3>Can I use multiple providers?</h3>
          <p>
            Yes. The platform supports Anthropic, OpenAI, xAI, and DeepSeek. You can optionally add
            your own keys for any combination and assign different providers per-agent.
          </p>

          <h3>What if an agent does something wrong?</h3>
          <p>
            Use guardrails and checkpoints to require human approval before sensitive actions. Every agent
            action is logged with full audit trails, so you can see exactly what happened. You can stop
            any running execution at any time.
          </p>

          <h2>Need Help?</h2>
          <p>
            Email us at <a href="mailto:support@askalf.org" style={{ color: '#a78bfa' }}>support@askalf.org</a>.
            As a beta member, you have direct access to the team.
          </p>
        </div>
      </section>

      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} AskAlf. All rights reserved.
            </span>
          </div>
          <div className="landing-footer-links">
            <Link to="/" className="landing-footer-link">Home</Link>
            <Link to="/privacy" className="landing-footer-link">Privacy</Link>
            <Link to="/terms" className="landing-footer-link">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
