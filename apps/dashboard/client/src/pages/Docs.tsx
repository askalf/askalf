import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import './Landing.css';

const agents = [
  {
    name: 'Researcher',
    slug: 'researcher',
    type: 'research',
    desc: 'Web research, competitor analysis, market intelligence. Browses the web, compiles reports, extracts data from any site.',
  },
  {
    name: 'Sentinel',
    slug: 'sentinel',
    type: 'security',
    desc: 'Security scanning, vulnerability detection, compliance checks. Scans systems, identifies risks, and reports findings before they become problems.',
  },
  {
    name: 'Builder',
    slug: 'builder',
    type: 'worker',
    desc: 'Executes tasks, builds deliverables, processes data. Uses tools and applications to get real work done — whatever the task requires.',
  },
  {
    name: 'Writer',
    slug: 'writer',
    type: 'content',
    desc: 'Content creation, documentation, reports, communications. Drafts in your tools, formats for your audience, maintains your voice.',
  },
  {
    name: 'Monitor',
    slug: 'monitor',
    type: 'monitor',
    desc: 'System monitoring, incident response, performance tracking. Watches your operations, detects anomalies, alerts you before problems escalate.',
  },
  {
    name: 'Analyst',
    slug: 'analyst',
    type: 'research',
    desc: 'Data analysis, trend detection, reporting. Queries data sources, builds visualizations, surfaces insights from your information.',
  },
];

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
          <Link to="/command-center" className="landing-nav-signin">Dashboard</Link>
        </div>
      </nav>

      <section className="legal-content" style={{ maxWidth: 800 }}>
        <p className="landing-section-label">// docs</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Getting Started</h1>
        <p className="legal-updated">AskAlf Private Beta</p>

        <div className="legal-body">
          <h2>What is AskAlf?</h2>
          <p>
            AskAlf is an AI workforce platform. Tell Alf what you need &mdash; Alf builds the team.
            Workers don&apos;t just chat. They use computers like you do: browse the web, read and write files,
            execute commands, and interact with applications. Think of them as digital employees
            that sit at a virtual desk and do real work, in any industry.
          </p>
          <p>
            Alf is the master intelligence. When you describe a task, Alf figures out what kind of
            specialist is needed, creates one if it doesn&apos;t exist, configures the right tools,
            and dispatches the work. Your team grows and adapts to whatever you throw at it.
          </p>

          <h2>Quick Start</h2>
          <p>Three steps to get your first agent working:</p>

          <h3>1. Create Your Account</h3>
          <p>
            If you received a beta invite, click the link in your email to register. You&apos;ll set up
            a password and go through a quick onboarding wizard:
          </p>
          <ul>
            <li><strong>Name your workspace</strong> &mdash; This is your team or project name.</li>
            <li><strong>Pick a theme</strong> &mdash; Choose the visual style for your dashboard.</li>
            <li><strong>Connect your AI</strong> &mdash; Link your Anthropic account to power your agents (see below).</li>
          </ul>

          <h3>2. Connect Your AI Provider</h3>
          <p>
            AskAlf agents need an AI provider to think. During onboarding, you&apos;ll connect at least one:
          </p>
          <ul>
            <li>
              <strong>Anthropic (required)</strong> &mdash; Powers all core AI functionality. Get an API key
              at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>console.anthropic.com</a>.
              Paste it during onboarding and we&apos;ll verify it works.
            </li>
            <li>
              <strong>OpenAI (optional)</strong> &mdash; Add an OpenAI key if you want to run certain agents on GPT models.
              Get one at <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>platform.openai.com</a>.
              You can skip this and add it later.
            </li>
          </ul>
          <p>
            Your keys are encrypted at rest (AES-256) and only used when your agents execute. You can
            update or rotate them anytime from <strong>Settings</strong>.
          </p>

          <h3>3. Give Alf Your First Task</h3>
          <p>
            From the <strong>Ask Alf</strong> tab, describe what you need done. Alf matches your request
            to the right worker &mdash; or creates a new specialist &mdash; and executes it. Try something simple:
          </p>
          <ul>
            <li>&ldquo;Research the top 5 competitors in [your space]&rdquo;</li>
            <li>&ldquo;Review the code in [repo] for security issues&rdquo;</li>
            <li>&ldquo;Write release notes for our latest update&rdquo;</li>
            <li>&ldquo;Monitor our API response times and flag anything slow&rdquo;</li>
          </ul>

          <h2 id="agents">Your Team</h2>
          <p>
            You start with six specialists, each designed for different types of work. You can create more at any time:
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
                  fontFamily: 'var(--font-mono)',
                }}>{agent.type}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {agent.desc}
              </p>
            </div>
          ))}

          <h2>The Dashboard</h2>
          <p>
            Your home base has these tabs:
          </p>
          <ul>
            <li><strong>Ask Alf</strong> &mdash; Chat with Alf + mission control in one view. Ask questions, dispatch tasks, or just say hello.</li>
            <li><strong>Team</strong> &mdash; See all your workers, browse 109 templates across 16 categories, or create a custom worker.</li>
            <li><strong>Ops</strong> &mdash; Tickets, costs, executions, timeline, audit log, and revenue tracking.</li>
            <li><strong>Live</strong> &mdash; Real-time event feed from all workers.</li>
            <li><strong>Brain</strong> &mdash; Memory browser, knowledge graph, and analytics.</li>
            <li><strong>Workspace</strong> &mdash; Embedded Claude Code and Codex terminals.</li>
          </ul>
          <p>
            The <strong>Mission Control</strong> tab gives you the full-screen orbital fleet visualization with detailed telemetry.
          </p>

          <h2>Key Concepts</h2>

          <h3>Computer Use</h3>
          <p>
            Unlike chatbots, AskAlf agents have full computer access. They can move the mouse, type on the
            keyboard, open browsers, navigate websites, use terminal commands, and interact with any
            application &mdash; just like a human at a desk.
          </p>

          <h3>Guardrails &amp; Checkpoints</h3>
          <p>
            Agents that control computers need safety rails. The platform supports human-in-the-loop approvals
            for sensitive actions, execution boundaries, and content filtering. Checkpoints let you review
            what an agent is about to do before it executes.
          </p>

          <h3>Cost Control</h3>
          <p>
            Every agent has configurable cost limits. Set per-execution budgets, per-agent caps, and track
            spending in real time. The Costs tab shows you exactly how much each task costs so there are
            no surprises.
          </p>

          <h3>Multi-Provider</h3>
          <p>
            Different workers can use different AI providers. Run your researcher on Claude, your builder
            on GPT &mdash; each using the model best suited for the task. Connect providers during
            onboarding or add them later from Settings.
          </p>

          <h3>24 Built-in Tools</h3>
          <p>
            Agents have access to tools for database queries, Docker management, web search, code analysis,
            team coordination, and more &mdash; all via the Model Context Protocol (MCP). Tools are
            automatically assigned based on the worker&apos;s role and your task requirements.
          </p>

          <h2 id="channels">Channel Integrations</h2>
          <p>
            Agents can receive messages and respond through six channels. Configure them
            in <strong>Settings &rarr; Channels</strong>.
          </p>

          <h3>API</h3>
          <p>
            Send tasks directly via REST API using your <code style={{ color: '#a78bfa' }}>fk_</code> API key.
            Supports synchronous (long-poll up to 120s) and asynchronous modes.
          </p>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem 1.25rem',
            marginBottom: '0.75rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            lineHeight: 1.6,
            overflowX: 'auto',
          }}>
            <div style={{ color: 'var(--text-secondary)' }}># Async dispatch</div>
            <div>POST /api/v1/forge/channels/api/dispatch</div>
            <div>Authorization: Bearer fk_your_api_key</div>
            <div>{'{'} &quot;message&quot;: &quot;Research competitors in fintech&quot; {'}'}</div>
            <br />
            <div style={{ color: 'var(--text-secondary)' }}># Sync dispatch (waits for result)</div>
            <div>{'{'} &quot;message&quot;: &quot;...&quot;, &quot;sync&quot;: true {'}'}</div>
          </div>

          <h3>Webhooks</h3>
          <p>
            Receive execution results at a URL you configure. Payloads are signed with
            HMAC-SHA256 &mdash; verify the <code style={{ color: '#a78bfa' }}>X-AskAlf-Signature</code> header
            using your webhook secret. Failed deliveries retry up to 3 times with exponential backoff.
          </p>

          <h3>Slack</h3>
          <p>
            Connect a Slack app to dispatch agents from any Slack channel. Setup:
          </p>
          <ol>
            <li>Create a Slack app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>api.slack.com/apps</a></li>
            <li>Enable Event Subscriptions and subscribe to <code style={{ color: '#a78bfa' }}>message.channels</code> and <code style={{ color: '#a78bfa' }}>message.im</code></li>
            <li>Set the Request URL to <code style={{ color: '#a78bfa' }}>https://askalf.org/api/v1/forge/channels/slack/webhook/YOUR_CONFIG_ID</code></li>
            <li>Copy your <strong>Bot Token</strong> and <strong>Signing Secret</strong> into Settings &rarr; Channels &rarr; Slack</li>
          </ol>

          <h3>Discord</h3>
          <p>
            Add a Discord bot that responds to slash commands. Setup:
          </p>
          <ol>
            <li>Create an application at <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>discord.com/developers</a></li>
            <li>Under &ldquo;General Information,&rdquo; copy the <strong>Application ID</strong> and <strong>Public Key</strong></li>
            <li>Under &ldquo;Bot,&rdquo; create a bot and copy the <strong>Bot Token</strong></li>
            <li>Set the Interactions Endpoint URL to <code style={{ color: '#a78bfa' }}>https://askalf.org/api/v1/forge/channels/discord/webhook/YOUR_CONFIG_ID</code></li>
            <li>Enter all three values in Settings &rarr; Channels &rarr; Discord</li>
          </ol>

          <h3>Telegram</h3>
          <p>
            Connect a Telegram bot. Setup:
          </p>
          <ol>
            <li>Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>@BotFather</a> on Telegram</li>
            <li>Copy the <strong>Bot Token</strong> into Settings &rarr; Channels &rarr; Telegram</li>
            <li>The webhook is registered automatically when you save</li>
          </ol>
          <p>
            Users message your bot directly. Messages prefixed with <code style={{ color: '#a78bfa' }}>/ask</code> are dispatched to agents.
          </p>

          <h3>WhatsApp</h3>
          <p>
            Connect via Meta&apos;s Cloud API. Setup:
          </p>
          <ol>
            <li>Create an app at <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>developers.facebook.com</a> with WhatsApp product</li>
            <li>Copy your <strong>Phone Number ID</strong>, <strong>Access Token</strong>, <strong>App Secret</strong>, and <strong>Verify Token</strong></li>
            <li>Set the webhook callback URL to <code style={{ color: '#a78bfa' }}>https://askalf.org/api/v1/forge/channels/whatsapp/webhook/YOUR_CONFIG_ID</code></li>
            <li>Subscribe to the <code style={{ color: '#a78bfa' }}>messages</code> webhook field</li>
          </ol>

          <h2>FAQ</h2>

          <h3>How much does it cost?</h3>
          <p>
            During the private beta, the platform itself is free. You provide your own Anthropic API key,
            so you pay Anthropic directly for AI usage at their standard rates. No additional platform fees
            during beta. When we launch paid tiers, beta members get guaranteed early-adopter pricing.
          </p>

          <h3>Do I need my own API key?</h3>
          <p>
            Yes. An Anthropic API key is required to use AskAlf &mdash; you&apos;ll connect it during
            onboarding. OpenAI is optional if you want multi-provider support. The platform handles
            everything else: orchestration, tool execution, computer use, and infrastructure.
          </p>

          <h3>Where does compute happen?</h3>
          <p>
            Orchestration, tool execution, and computer-use actions all run on our infrastructure in
            isolated, sandboxed containers. AI inference routes through your connected provider account
            using the API key you provided.
          </p>

          <h3>Is my data safe?</h3>
          <p>
            API keys are encrypted at rest (AES-256). Agent sessions run in isolated containers with no
            shared state. All traffic is encrypted with TLS 1.3. We don&apos;t use your data to train
            models. See our <Link to="/privacy" style={{ color: '#a78bfa' }}>Privacy Policy</Link> for full details.
          </p>

          <h3>Can I use multiple providers?</h3>
          <p>
            Yes. Connect Anthropic (required) and optionally OpenAI. You can assign different providers
            to different agents based on what works best for each task.
          </p>

          <h3>What if an agent does something wrong?</h3>
          <p>
            Guardrails and checkpoints let you require human approval before sensitive actions. Every agent
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
