import { useEffect, useRef, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

const k8sMapping = [
  { left: 'Pods', right: 'Agents' },
  { left: 'Deployments', right: 'Fleet Coordinator' },
  { left: 'Health Probes', right: 'Monitoring Agent' },
  { left: 'Canary Deploys', right: 'Agent Evolution' },
  { left: 'Resource Limits', right: 'Token Budgets' },
  { left: 'Service Mesh', right: 'Agent Communication' },
];

const features = [
  {
    icon: '01',
    title: 'Fleet Orchestration',
    desc: 'DAG workflows, parallel execution, conditional routing. Deploy agent fleets that coordinate like microservices.',
  },
  {
    icon: '02',
    title: 'Darwinian Evolution',
    desc: 'Agents clone and mutate. A/B test on real tasks. Winners promote, losers get decommissioned.',
  },
  {
    icon: '03',
    title: 'Budget Enforcement',
    desc: 'Per-execution cost limits, cheapest-model routing, token budgets. No surprise bills.',
  },
  {
    icon: '04',
    title: 'Auto-Healing',
    desc: 'Stuck execution detection, failure rate monitoring, automatic recovery. Reconciliation loops that never sleep.',
  },
  {
    icon: '05',
    title: '4-Tier Memory',
    desc: 'Procedural, episodic, semantic, and working memory. Persisted in PostgreSQL with pgvector.',
  },
  {
    icon: '06',
    title: 'Human Checkpoints',
    desc: 'Pause workflows for approval, review, or input. Stay in the loop without babysitting.',
  },
];

const steps = [
  {
    num: 1,
    title: 'Deploy',
    desc: 'Define agents with models, tools, and budgets. Push to your fleet.',
  },
  {
    num: 2,
    title: 'Compete',
    desc: 'Agents clone and mutate. A/B test on real tasks. Losers get decommissioned.',
  },
  {
    num: 3,
    title: 'Operate',
    desc: 'Health probes, cost dashboards, reconciliation loops. The control plane handles the rest.',
  },
];

const stack = [
  'TypeScript',
  'Fastify',
  'PostgreSQL + pgvector',
  'Redis Streams',
  'Docker',
  'Cloudflare Zero Trust',
];

function useScrollReveal() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    refs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  return setRef;
}

/* ---- Terminal Demo ---- */
const terminalLines = [
  { text: '$ orcastr8r deploy --fleet research-v3 --agents 12', type: 'cmd', typed: true },
  { text: '\u2713 Fleet deployed: 12 agents across 3 models', type: 'success', typed: false },
  { text: '$ orcastr8r evolve --strategy darwinian --generations 5', type: 'cmd', typed: true },
  { text: '\u25D0 Gen 1: agent-7b mutated \u2192 +14.2% accuracy', type: 'info', typed: false },
  { text: '\u25D0 Gen 2: agent-3a promoted \u2192 lowest cost/query', type: 'info', typed: false },
  { text: '\u2713 Evolution complete: 3 winners, 2 decommissioned', type: 'success', typed: false },
  { text: '$ orcastr8r status', type: 'cmd', typed: true },
  { text: 'Fleet: research-v3  |  Active: 10  |  Budget: $4.21/$50.00', type: 'output', typed: false },
  { text: '\u26A0 agent-9c: stuck 47s \u2192 auto-healing...', type: 'warn', typed: false },
  { text: '\u2713 agent-9c: recovered via checkpoint rollback', type: 'success', typed: false },
];

function TerminalDemo() {
  const [visibleLines, setVisibleLines] = useState<{ text: string; type: string }[]>([]);
  const [currentChar, setCurrentChar] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lineIndex >= terminalLines.length) {
      const timeout = setTimeout(() => {
        setVisibleLines([]);
        setLineIndex(0);
        setCurrentChar(0);
        setIsTyping(true);
      }, 3000);
      return () => clearTimeout(timeout);
    }

    const line = terminalLines[lineIndex];

    if (line.typed && isTyping) {
      if (currentChar < line.text.length) {
        const timeout = setTimeout(() => setCurrentChar((c) => c + 1), 25);
        return () => clearTimeout(timeout);
      } else {
        const timeout = setTimeout(() => {
          setVisibleLines((prev) => [...prev, { text: line.text, type: line.type }]);
          setLineIndex((i) => i + 1);
          setCurrentChar(0);
          setIsTyping(true);
        }, 400);
        return () => clearTimeout(timeout);
      }
    } else if (!line.typed) {
      const timeout = setTimeout(() => {
        setVisibleLines((prev) => [...prev, { text: line.text, type: line.type }]);
        setLineIndex((i) => i + 1);
        setCurrentChar(0);
        setIsTyping(true);
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [lineIndex, currentChar, isTyping]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines, currentChar]);

  const currentLine = lineIndex < terminalLines.length ? terminalLines[lineIndex] : null;

  return (
    <div className="landing-terminal">
      <div className="landing-terminal-bar">
        <span className="landing-terminal-dot dot-red" />
        <span className="landing-terminal-dot dot-yellow" />
        <span className="landing-terminal-dot dot-green" />
        <span className="landing-terminal-title">orcastr8r</span>
      </div>
      <div className="landing-terminal-body" ref={containerRef}>
        {visibleLines.map((line, i) => (
          <div key={i} className={`landing-terminal-line is-${line.type}`}>{line.text}</div>
        ))}
        {currentLine && currentLine.typed && (
          <div className={`landing-terminal-line is-${currentLine.type}`}>
            {currentLine.text.slice(0, currentChar)}
            <span className="landing-terminal-cursor" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Agent Constellation (Canvas) ---- */
function AgentConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; pulse: number; pulseSpeed: number }[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    const init = () => {
      resize();
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const count = Math.min(35, Math.floor((w * h) / 15000));
      particles.length = 0;
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: 1.5 + Math.random() * 2,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.01 + Math.random() * 0.02,
        });
      }
    };

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      // Update + draw connections
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += p.pulseSpeed;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            const alpha = (1 - dist / 140) * 0.15;
            ctx.strokeStyle = `rgba(124, 58, 237, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        const opacity = 0.3 + Math.sin(p.pulse) * 0.2;
        ctx.fillStyle = `rgba(167, 139, 250, ${opacity})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    init();
    draw();
    window.addEventListener('resize', init);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', init);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-constellation" />;
}

/* ---- Metrics Bar ---- */
function useCountUp(target: number, duration: number, trigger: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, trigger]);
  return value;
}

const metrics = [
  { value: 9, label: 'Containers', suffix: '' },
  { value: 6, label: 'AI Providers', suffix: '' },
  { value: 4, label: 'Memory Tiers', suffix: '' },
  { value: 1, label: 'Response Time', suffix: '', prefix: '<', unit: 's' },
];

function MetricItem({ metric, triggered }: { metric: typeof metrics[0]; triggered: boolean }) {
  const count = useCountUp(metric.value, 1500, triggered);
  return (
    <div className="landing-metric">
      <div className="landing-metric-value">
        {metric.prefix || ''}{count}{metric.unit || ''}
      </div>
      <div className="landing-metric-label">{metric.label}</div>
    </div>
  );
}

function MetricsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setTriggered(true); },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-metrics" ref={ref}>
      {metrics.map((m) => (
        <MetricItem key={m.label} metric={m} triggered={triggered} />
      ))}
    </div>
  );
}

/* ---- Agent Topology Diagram ---- */
const topoProviders = [
  { id: 'claude', label: 'Claude', x: 80, y: 80, tip: 'Anthropic Claude\n3 active agents\n$1.24 spent today' },
  { id: 'gpt', label: 'GPT', x: 80, y: 200, tip: 'OpenAI GPT\n4 active agents\n$2.08 spent today' },
  { id: 'gemini', label: 'Gemini', x: 80, y: 320, tip: 'Google Gemini\n3 active agents\n$0.89 spent today' },
];
const topoHub = { x: 400, y: 200 };
const topoAgents = [
  { id: 'agent-1a', x: 720, y: 60 },
  { id: 'agent-3b', x: 720, y: 160 },
  { id: 'agent-7c', x: 720, y: 260 },
  { id: 'agent-9d', x: 720, y: 360 },
];

const agentStatuses = [
  { label: 'running', color: '#4ade80' },
  { label: 'evolving', color: '#a78bfa' },
  { label: 'healing', color: '#fbbf24' },
  { label: 'killed', color: '#ef4444' },
];

type Particle = { edge: number; progress: number; speed: number; direction: 'in' | 'out' };

function AgentTopology() {
  const [statuses, setStatuses] = useState([0, 1, 0, 2]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const circlesRef = useRef<SVGCircleElement[]>([]);

  // Build edges: providers→hub (3) + hub→agents (4) = 7 edges
  const edges = [
    ...topoProviders.map(p => ({ x1: p.x + 60, y1: p.y, x2: topoHub.x - 70, y2: topoHub.y })),
    ...topoAgents.map(a => ({ x1: topoHub.x + 70, y1: topoHub.y, x2: a.x - 60, y2: a.y })),
  ];

  // Initialize particles
  useEffect(() => {
    const parts: Particle[] = [];
    for (let i = 0; i < 18; i++) {
      parts.push({
        edge: Math.floor(Math.random() * edges.length),
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.004,
        direction: Math.random() > 0.5 ? 'in' : 'out',
      });
    }
    particlesRef.current = parts;

    const animate = () => {
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.progress += p.speed;
        if (p.progress > 1) {
          p.progress = 0;
          p.edge = Math.floor(Math.random() * edges.length);
          p.speed = 0.003 + Math.random() * 0.004;
        }
        const e = edges[p.edge];
        const t = p.progress;
        const cx = e.x1 + (e.x2 - e.x1) * t;
        const cy = e.y1 + (e.y2 - e.y1) * t;
        const circle = circlesRef.current[i];
        if (circle) {
          circle.setAttribute('cx', String(cx));
          circle.setAttribute('cy', String(cy));
          circle.setAttribute('opacity', String(0.3 + Math.sin(t * Math.PI) * 0.7));
        }
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Rotate agent statuses
  useEffect(() => {
    const interval = setInterval(() => {
      setStatuses(prev => {
        const next = [...prev];
        const idx = Math.floor(Math.random() * next.length);
        next[idx] = (next[idx] + 1) % agentStatuses.length;
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const agentTips = topoAgents.map((a, i) => {
    const s = agentStatuses[statuses[i]];
    const gens = [3, 5, 2, 1];
    const accs = ['94.2%', '87.6%', '91.0%', '\u2014'];
    return `${a.id} \u00B7 Gen ${gens[i]}\nStatus: ${s.label}\nAccuracy: ${accs[i]}`;
  });

  return (
    <div className="landing-topology-wrap">
      <svg ref={svgRef} viewBox="0 0 800 400" className="landing-topology-svg" aria-label="Agent topology diagram">
        <defs>
          <filter id="hubGlow">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Edges */}
        {edges.map((e, i) => (
          <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke="rgba(124,58,237,0.15)" strokeWidth="1.5" />
        ))}

        {/* Particles */}
        {Array.from({ length: 18 }).map((_, i) => (
          <circle key={`p${i}`} r="3" fill="#a78bfa" opacity="0"
            ref={el => { if (el) circlesRef.current[i] = el; }} />
        ))}

        {/* Provider nodes */}
        {topoProviders.map(p => (
          <g key={p.id}
            onMouseEnter={() => setHoveredNode(p.id)}
            onMouseLeave={() => setHoveredNode(null)}
            style={{ cursor: 'pointer' }}
          >
            <rect x={p.x - 50} y={p.y - 22} width="100" height="44" rx="10"
              fill="#111113" stroke="rgba(124,58,237,0.3)" strokeWidth="1.5" />
            <text x={p.x} y={p.y + 5} textAnchor="middle"
              fill="#a1a1aa" fontSize="13" fontFamily="'JetBrains Mono', monospace" fontWeight="600">
              {p.label}
            </text>
          </g>
        ))}

        {/* Hub node */}
        <g>
          <rect x={topoHub.x - 65} y={topoHub.y - 30} width="130" height="60" rx="14"
            fill="#111113" stroke="#7c3aed" strokeWidth="2" filter="url(#hubGlow)" />
          <text x={topoHub.x} y={topoHub.y + 6} textAnchor="middle"
            fill="#a78bfa" fontSize="16" fontFamily="'JetBrains Mono', monospace" fontWeight="800">
            orcastr8r
          </text>
        </g>

        {/* Agent nodes */}
        {topoAgents.map((a, i) => {
          const s = agentStatuses[statuses[i]];
          return (
            <g key={a.id}
              onMouseEnter={() => setHoveredNode(a.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={a.x - 55} y={a.y - 20} width="110" height="40" rx="8"
                fill="#111113" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <circle cx={a.x - 35} cy={a.y} r="4" fill={s.color}>
                <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
              </circle>
              <text x={a.x + 2} y={a.y + 4} textAnchor="middle"
                fill="#71717a" fontSize="11" fontFamily="'JetBrains Mono', monospace" fontWeight="500">
                {a.id}
              </text>
            </g>
          );
        })}

        {/* Tooltip */}
        {hoveredNode && (() => {
          const prov = topoProviders.find(p => p.id === hoveredNode);
          const agentIdx = topoAgents.findIndex(a => a.id === hoveredNode);
          const tip = prov ? prov.tip : agentIdx >= 0 ? agentTips[agentIdx] : null;
          if (!tip) return null;
          const node = prov || topoAgents[agentIdx];
          const lines = tip.split('\n');
          const tx = node.x;
          const ty = node.y - 45;
          return (
            <g>
              <rect x={tx - 75} y={ty - 12 * lines.length} width="150" height={lines.length * 18 + 16} rx="8"
                fill="#1a1a1d" stroke="rgba(124,58,237,0.3)" strokeWidth="1" />
              {lines.map((line, li) => (
                <text key={li} x={tx} y={ty - 12 * lines.length + 20 + li * 18} textAnchor="middle"
                  fill={li === 0 ? '#fafafa' : '#71717a'} fontSize="11"
                  fontFamily="'JetBrains Mono', monospace" fontWeight={li === 0 ? '600' : '400'}>
                  {line}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

export default function LandingPage() {
  const setRef = useScrollReveal();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Orcastr8r — The Control Plane for Autonomous Agents';
  }, []);

  return (
    <div className="landing-page">
      {/* Animated constellation background */}
      <AgentConstellation />

      {/* Nav */}
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">orcastr8r</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <section className="landing-hero">
        <div className="landing-badge">Early Access</div>
        <h1>
          The control plane for{' '}
          <span>autonomous agents</span>
        </h1>
        <p className="landing-hero-sub">
          Kubernetes-style orchestration for AI agents. Deploy fleets,
          enforce budgets, evolve what works, kill what doesn't.
        </p>
        <TerminalDemo />
        <div className="landing-hero-actions">
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
          <a href="#how-it-works" className="landing-cta-secondary">
            See How It Works
          </a>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ METRICS BAR ============ */}
      <MetricsBar />

      <hr className="landing-divider" />

      {/* ============ THE PROBLEM ============ */}
      <section className="landing-problem landing-reveal" ref={setRef(0)}>
        <div className="landing-problem-content">
          <p className="landing-section-label">// the problem</p>
          <h2 className="landing-problem-headline">
            Agent frameworks give you chains.<br />
            You need a <em>control plane</em>.
          </h2>
          <p className="landing-problem-body">
            Frameworks help you build one agent. They don't help you run fifty.
            Production agents need observability, cost control, healing, and evolution
            — not another prompt wrapper.
          </p>
          <div className="landing-problem-compare">
            <div className="landing-problem-col is-old landing-stagger">
              <div className="landing-problem-col-title">Frameworks</div>
              <ul>
                <li>Single agent chains</li>
                <li>No cost visibility</li>
                <li>Manual restarts on failure</li>
                <li>Static prompts</li>
                <li>No fleet coordination</li>
              </ul>
            </div>
            <div className="landing-problem-col is-new landing-stagger">
              <div className="landing-problem-col-title">Control Plane</div>
              <ul>
                <li>Fleet orchestration</li>
                <li>Per-agent token budgets</li>
                <li>Auto-healing + reconciliation</li>
                <li>Darwinian prompt evolution</li>
                <li>DAG workflows + handoffs</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ K8S MAPPING ============ */}
      <section className="landing-k8s landing-reveal" ref={setRef(1)}>
        <div className="landing-k8s-header">
          <p className="landing-section-label">// architecture</p>
          <h2 className="landing-section-title">
            Kubernetes for agents
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Every concept you know from container orchestration, mapped to autonomous agents.
          </p>
        </div>
        <div className="landing-k8s-table">
          <div className="landing-k8s-row is-header">
            <span className="landing-k8s-left">Kubernetes</span>
            <span className="landing-k8s-arrow" />
            <span className="landing-k8s-right">Orcastr8r</span>
          </div>
          {k8sMapping.map((row) => (
            <div key={row.left} className="landing-k8s-row landing-stagger">
              <span className="landing-k8s-left">{row.left}</span>
              <span className="landing-k8s-arrow">{'\u2192'}</span>
              <span className="landing-k8s-right">{row.right}</span>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ TOPOLOGY ============ */}
      <section className="landing-topology landing-reveal" ref={setRef(2)}>
        <div className="landing-topology-header">
          <p className="landing-section-label">// topology</p>
          <h2 className="landing-section-title">
            See the control plane in action
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Model providers feed the hub. The hub orchestrates agents. Agents compete, evolve, and self-heal.
          </p>
        </div>
        <AgentTopology />
      </section>

      <hr className="landing-divider" />

      {/* ============ FEATURES ============ */}
      <section className="landing-features landing-reveal" ref={setRef(3)}>
        <div className="landing-features-header">
          <p className="landing-section-label">// capabilities</p>
          <h2 className="landing-section-title">
            Production-grade agent infrastructure
          </h2>
        </div>
        <div className="landing-features-grid">
          {features.map((f) => (
            <div key={f.title} className="landing-feature-card landing-stagger">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ HOW IT WORKS ============ */}
      <section id="how-it-works" className="landing-how landing-reveal" ref={setRef(4)}>
        <div className="landing-how-header">
          <p className="landing-section-label">// workflow</p>
          <h2 className="landing-section-title">
            Three steps to production agents
          </h2>
        </div>
        <div className="landing-steps">
          {steps.map((s) => (
            <div key={s.title} className="landing-step landing-stagger">
              <div className="landing-step-number">{s.num}</div>
              <h3 className="landing-step-title">{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ THE STACK ============ */}
      <section className="landing-stack landing-reveal" ref={setRef(5)}>
        <div className="landing-stack-header">
          <p className="landing-section-label">// infrastructure</p>
          <h2 className="landing-section-title">The stack</h2>
        </div>
        <div className="landing-stack-content">
          <div className="landing-stack-items">
            {stack.map((item) => (
              <span key={item} className="landing-stack-item landing-stagger">
                {item}
              </span>
            ))}
          </div>
          <p className="landing-stack-stat">9 containers. 2 services. Zero frameworks.</p>
          <p className="landing-stack-stat-sub">Darwinism for LLMs.</p>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ FINAL CTA ============ */}
      <section className="landing-final-cta landing-reveal" ref={setRef(6)}>
        <div className="landing-final-cta-inner">
          <h2 className="landing-final-headline">
            Ready to run agents like infrastructure?
          </h2>
          <p className="landing-final-sub">
            Early access is open. Join the waitlist and be first to deploy
            agents that evolve, compete, and self-heal.
          </p>
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} Orcastr8r. All rights reserved.
            </span>
            <span className="landing-footer-built">
              Built by one developer who got tired of frameworks.
            </span>
          </div>
          <div className="landing-footer-links">
            <a
              href="https://amnesia.tax"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              amnesia.tax — the world's fastest aggregated search engine
            </a>
            <a
              href="https://x.com/meetaskalf"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              X / Twitter
            </a>
            <Link to="/login" className="landing-footer-link">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
