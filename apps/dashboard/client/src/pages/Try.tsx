import { useState, useEffect, useRef, useCallback } from 'react';
import './Try.css';

function useScrollReveal() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -30px 0px' },
    );
    refs.current.forEach((ref) => { if (ref) observer.observe(ref); });
    return () => observer.disconnect();
  }, []);

  return setRef;
}

const capabilities = [
  { icon: '\u{1F5B1}\uFE0F', title: 'Mouse & Keyboard', desc: 'Click, type, scroll, drag. Full desktop control through native OS APIs.' },
  { icon: '\u{1F310}', title: 'Browse the Web', desc: 'Navigate sites, fill forms, click through workflows, extract data from any page.' },
  { icon: '\u{1F4C1}', title: 'Manage Files', desc: 'Read, write, organize files across your system. Edit configs, move assets, manage repos.' },
  { icon: '\u{1F4BB}', title: 'Run Commands', desc: 'Full shell access. Run build scripts, git operations, package managers, anything in your terminal.' },
  { icon: '\u{1F4F8}', title: 'See Your Screen', desc: 'Takes screenshots to understand context. Reads UI elements, identifies buttons, follows visual flows.' },
  { icon: '\u{1F527}', title: 'Edit Code', desc: 'Built-in text editor tool. Search, replace, create files with precision — not just copy-paste.' },
];

export default function TryPage() {
  const [copied, setCopied] = useState(false);
  const setRef = useScrollReveal();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Try @askalf/agent — Computer-Use Agent';
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm i -g @askalf/agent');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="try-page">
      {/* ── Nav ── */}
      <nav className="try-nav">
        <a href="/" className="try-nav-logo">askalf</a>
        <div className="try-nav-links">
          <a href="https://github.com/SprayberryLabs/agent#readme" className="try-nav-link" target="_blank" rel="noopener noreferrer">Docs</a>
          <a href="https://github.com/SprayberryLabs/agent" className="try-nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="try-hero">
        <div className="try-badge">Open Source</div>
        <h1>
          Control Your Computer<br />
          with <span className="accent">Natural Language</span>
        </h1>
        <p className="try-hero-sub">
          One command to install. Bring your own API key or Claude subscription.
          Full computer control — mouse, keyboard, browser, terminal.
        </p>

        <div className="try-install">
          <div className="try-install-cmd">
            <span className="prompt">$</span>
            <span>npm i -g @askalf/agent</span>
          </div>
          <button className={`try-install-copy ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Auth Mode Cards */}
        <div className="try-auth-section">
          <div className="try-auth-label">Two ways to authenticate</div>
          <div className="try-auth-cards">
            <div className="try-auth-card">
              <div className="try-auth-card-icon api">&#x1F511;</div>
              <h3>API Key</h3>
              <p>Paste your Anthropic API key. Pay per use. Uses the SDK directly with full computer use capabilities.</p>
              <span className="try-auth-card-tag sdk">SDK Mode</span>
            </div>
            <div className="try-auth-card">
              <div className="try-auth-card-icon oauth">&#x1F464;</div>
              <h3>Claude OAuth</h3>
              <p>Sign in with your Claude subscription. Uses the Claude CLI with MCP computer tools.</p>
              <span className="try-auth-card-tag cli">CLI Mode</span>
            </div>
          </div>
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── How It Works ── */}
      <section className="try-steps try-reveal" ref={setRef(0)}>
        <div className="try-section-label">How It Works</div>
        <h2 className="try-section-title">Three commands to a working agent</h2>
        <div className="try-steps-grid">
          <div className="try-step">
            <div className="try-step-number">1</div>
            <h3>Install</h3>
            <p>Global npm package. Works on macOS, Linux, and Windows.</p>
            <div className="try-step-cmd">npm i -g @askalf/agent</div>
          </div>
          <div className="try-step">
            <div className="try-step-number">2</div>
            <h3>Authenticate</h3>
            <p>Paste your API key or log in with your Claude account.</p>
            <div className="try-step-cmd">askalf-agent auth</div>
          </div>
          <div className="try-step">
            <div className="try-step-number">3</div>
            <h3>Run</h3>
            <p>Tell it what to do in plain English. It takes over from there.</p>
            <div className="try-step-cmd">askalf-agent run &quot;open Chrome and search for flights to Tokyo&quot;</div>
          </div>
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Terminal Demo ── */}
      <section className="try-terminal-section try-reveal" ref={setRef(1)}>
        <div className="try-section-label">Live Demo</div>
        <h2 className="try-section-title">See it in action</h2>
        <div className="try-terminal">
          <div className="try-terminal-bar">
            <div className="try-terminal-dot red" />
            <div className="try-terminal-dot yellow" />
            <div className="try-terminal-dot green" />
            <div className="try-terminal-title">askalf-agent</div>
          </div>
          <div className="try-terminal-body">
            <div className="try-terminal-line">
              <span className="term-prompt">$ </span>
              <span className="term-cmd">askalf-agent run &quot;find the cheapest flight from SF to Tokyo next week&quot;</span>
            </div>
            <div className="try-terminal-line"><br /></div>
            <div className="try-terminal-line">
              <span className="term-green">&#x2714; </span>
              <span className="term-result">SDK Mode &#x2014; Computer Use</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-dim">&#x2139; Model: claude-sonnet-4-6 | Screen: 2560x1440</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-dim">&#x2139; Budget: $1.00 | Max turns: 50</span>
            </div>
            <div className="try-terminal-line"><br /></div>
            <div className="try-terminal-line">
              <span className="term-action">[screenshot]</span>
              <span className="term-dim"> Capturing initial screen...</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-action">[computer]</span>
              <span className="term-result"> left_click &#x2014; Opening Chrome at (42, 780)</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-action">[computer]</span>
              <span className="term-result"> type &#x2014; &quot;google.com/flights&quot;</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-action">[computer]</span>
              <span className="term-result"> key &#x2014; Return</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-action">[screenshot]</span>
              <span className="term-dim"> Analyzing Google Flights page...</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-action">[computer]</span>
              <span className="term-result"> type &#x2014; &quot;San Francisco&quot; &#x2192; &quot;Tokyo&quot;</span>
            </div>
            <div className="try-terminal-line">
              <span className="term-dim">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</span>
              <br />
              <span className="term-dim">Tokens: </span><span className="term-result">12,847 in / 3,214 out</span>
              <br />
              <span className="term-dim">Cost: </span><span className="term-amber">$0.0867</span>
              <br />
              <span className="term-dim">Turns: </span><span className="term-result">8</span>
              <span className="try-terminal-cursor" />
            </div>
          </div>
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Capabilities ── */}
      <section className="try-capabilities try-reveal" ref={setRef(2)}>
        <div className="try-section-label">Capabilities</div>
        <h2 className="try-section-title">Everything a human can do on a computer</h2>
        <div className="try-cap-grid">
          {capabilities.map((cap) => (
            <div key={cap.title} className="try-cap-card">
              <span className="try-cap-icon">{cap.icon}</span>
              <h3>{cap.title}</h3>
              <p>{cap.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Open Source ── */}
      <section className="try-oss try-reveal" ref={setRef(3)}>
        <div className="try-oss-icon">&#x2B50;</div>
        <h2>Open Source. MIT Licensed.</h2>
        <p>
          Built in the open. Inspect the code, contribute features, fork for your own use.
          No vendor lock-in, no hidden behavior.
        </p>
        <div className="try-oss-links">
          <a href="https://github.com/SprayberryLabs/agent" className="try-oss-btn primary" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
          <a href="https://www.npmjs.com/package/@askalf/agent" className="try-oss-btn secondary" target="_blank" rel="noopener noreferrer">
            npm Package
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="try-footer">
        <span>
          &copy; 2026 AskAlf &middot;{' '}
          <a href="https://github.com/SprayberryLabs/agent#readme" target="_blank" rel="noopener noreferrer">Docs</a> &middot;{' '}
          <a href="https://github.com/SprayberryLabs/agent" target="_blank" rel="noopener noreferrer">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
