import { useState, useEffect, useRef, useCallback } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { hubApi } from '../../hooks/useHubApi';
import { API_BASE } from '../../utils/api';
import type { Agent } from '../../hooks/useHubApi';
import './OrganismTab.css';

// ── Types ──

interface NeuralSignal {
  from: string;
  to: string;
  type: string;
  timestamp: string;
}

interface KnowledgeNode {
  id: string;
  label: string;
  entity_type: string;
  confidence: number;
  access_count: number;
}

interface ImmuneIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
}

interface DreamEvent {
  type: string;
  description: string;
  timestamp: string;
}

interface EvolutionEvent {
  agent_name: string;
  action: string;
  detail: string;
  timestamp: string;
}

interface OrganismState {
  agents: Agent[];
  signals: NeuralSignal[];
  knowledge: { node_count: number; edge_count: number; recent: KnowledgeNode[] };
  immune: { status: string; active_incidents: number; antibody_count: number; incidents: ImmuneIncident[] };
  dreams: { last_cycle: string | null; patterns_extracted: number; events: DreamEvent[] };
  evolution: { events: EvolutionEvent[] };
  vitals: { cpu: number; memory: number; cost_today: number; executions_today: number; uptime: number };
}

// ── Canvas: Neural Network Visualization ──

function NeuralCanvas({ agents, signals }: { agents: Agent[]; signals: NeuralSignal[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<{ id: string; name: string; x: number; y: number; status: string; vx: number; vy: number; color: string }[]>([]);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const colors: Record<string, string> = {
    running: '#00ff88',
    idle: '#00c8ff',
    error: '#ff2d55',
    paused: '#ffb800',
    default: '#a855f7',
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize or update nodes
    const existingIds = new Set(nodesRef.current.map(n => n.id));
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    for (const agent of agents) {
      if (!existingIds.has(agent.id)) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * Math.min(w, h) * 0.3;
        nodesRef.current.push({
          id: agent.id,
          name: agent.name,
          x: w / 2 + Math.cos(angle) * radius,
          y: h / 2 + Math.sin(angle) * radius,
          status: agent.status,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          color: colors[agent.status] || colors.default,
        });
      } else {
        const node = nodesRef.current.find(n => n.id === agent.id);
        if (node) {
          node.status = agent.status;
          node.color = colors[agent.status] || colors.default;
        }
      }
    }

    function resize() {
      const dpr = Math.min(devicePixelRatio, 2);
      canvas!.width = canvas!.offsetWidth * dpr;
      canvas!.height = canvas!.offsetHeight * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const cw = canvas!.offsetWidth;
      const ch = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, cw, ch);
      timeRef.current += 0.008;
      const t = timeRef.current;
      const nodes = nodesRef.current;

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 200) {
            const a = (1 - d / 200) * 0.08;
            const mx = (nodes[i].x + nodes[j].x) / 2 + Math.sin(t + i) * 6;
            const my = (nodes[i].y + nodes[j].y) / 2 + Math.cos(t + j) * 6;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.quadraticCurveTo(mx, my, nodes[j].x, nodes[j].y);
            ctx!.strokeStyle = `rgba(0,255,136,${a})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      // Draw signal pulses
      for (const sig of signals) {
        const from = nodes.find(n => n.id === sig.from || n.name === sig.from);
        const to = nodes.find(n => n.id === sig.to || n.name === sig.to);
        if (!from || !to) continue;
        const age = (Date.now() - new Date(sig.timestamp).getTime()) / 1000;
        if (age > 5) continue;
        const progress = Math.min(age / 2, 1);
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        const gr = ctx!.createRadialGradient(x, y, 0, x, y, 8);
        gr.addColorStop(0, 'rgba(0,255,136,0.8)');
        gr.addColorStop(1, 'rgba(0,255,136,0)');
        ctx!.beginPath();
        ctx!.arc(x, y, 8, 0, Math.PI * 2);
        ctx!.fillStyle = gr;
        ctx!.fill();
      }

      // Draw nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 30 || n.x > cw - 30) n.vx *= -1;
        if (n.y < 30 || n.y > ch - 30) n.vy *= -1;

        const pulse = 0.4 + Math.sin(t * 2 + nodes.indexOf(n)) * 0.2;

        // Glow
        const gr = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, 20);
        gr.addColorStop(0, n.color.replace(')', `,${pulse * 0.15})`).replace('rgb', 'rgba'));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 20, 0, Math.PI * 2);
        ctx!.fillStyle = gr;
        ctx!.fill();

        // Core
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 4, 0, Math.PI * 2);
        ctx!.fillStyle = n.color;
        ctx!.globalAlpha = pulse;
        ctx!.fill();
        ctx!.globalAlpha = 1;

        // Label
        ctx!.font = '9px "Fira Code", monospace';
        ctx!.fillStyle = `rgba(200,214,229,${pulse})`;
        ctx!.textAlign = 'center';
        ctx!.fillText(n.name, n.x, n.y + 16);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [agents.length]);

  return <canvas ref={canvasRef} className="organism-canvas" />;
}

// ── Activity Feed ──

function ActivityFeed({ events }: { events: { text: string; color: string; time: string }[] }) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="organism-feed" ref={feedRef}>
      {events.length === 0 && <div className="organism-feed-empty">Waiting for activity...</div>}
      {events.map((e, i) => (
        <div key={i} className="organism-feed-line">
          <span className="organism-feed-time">{e.time}</span>
          <span className="organism-feed-dot" style={{ background: e.color }} />
          <span className="organism-feed-text">{e.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── Vital Signs ──

function VitalSigns({ vitals }: { vitals: OrganismState['vitals'] }) {
  return (
    <div className="organism-vitals">
      <div className="organism-vital">
        <div className="vital-label">NEURAL LOAD</div>
        <div className="vital-bar"><div className="vital-fill" style={{ width: `${Math.min(vitals.cpu, 100)}%`, background: vitals.cpu > 80 ? '#ff2d55' : '#00ff88' }} /></div>
        <div className="vital-value">{vitals.cpu.toFixed(0)}%</div>
      </div>
      <div className="organism-vital">
        <div className="vital-label">MEMORY</div>
        <div className="vital-bar"><div className="vital-fill" style={{ width: `${Math.min(vitals.memory, 100)}%`, background: vitals.memory > 80 ? '#ff2d55' : '#00c8ff' }} /></div>
        <div className="vital-value">{vitals.memory.toFixed(0)}%</div>
      </div>
      <div className="organism-vital">
        <div className="vital-label">COST TODAY</div>
        <div className="vital-value" style={{ color: '#ffb800' }}>${vitals.cost_today.toFixed(2)}</div>
      </div>
      <div className="organism-vital">
        <div className="vital-label">EXECUTIONS</div>
        <div className="vital-value" style={{ color: '#00ff88' }}>{vitals.executions_today}</div>
      </div>
      <div className="organism-vital">
        <div className="vital-label">IMMUNE</div>
        <div className="vital-value" style={{ color: '#00ff88' }}>CLEAR</div>
      </div>
    </div>
  );
}

// ── Systems Status ──

function SystemsPanel({ state }: { state: OrganismState }) {
  const systems = [
    { name: 'Nervous System', status: 'active', color: '#00ff88', detail: `${state.signals.length} signals` },
    { name: 'Immune System', status: state.immune.active_incidents > 0 ? 'responding' : 'clear', color: state.immune.active_incidents > 0 ? '#ff2d55' : '#00ff88', detail: `${state.immune.antibody_count} antibodies` },
    { name: 'Collective Memory', status: 'active', color: '#00c8ff', detail: `${state.knowledge.node_count} nodes` },
    { name: 'Dream Cycles', status: state.dreams.last_cycle ? 'resting' : 'idle', color: '#ffb800', detail: `${state.dreams.patterns_extracted} patterns` },
    { name: 'Natural Selection', status: 'evolving', color: '#a855f7', detail: `${state.evolution.events.length} events` },
    { name: 'Reputation Economy', status: 'active', color: '#00ff88', detail: `${state.agents.length} agents scored` },
  ];

  return (
    <div className="organism-systems">
      {systems.map(s => (
        <div key={s.name} className="organism-system-card">
          <div className="system-dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
          <div className="system-info">
            <div className="system-name">{s.name}</div>
            <div className="system-detail">{s.detail}</div>
          </div>
          <div className="system-status" style={{ color: s.color }}>{s.status.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export default function OrganismTab() {
  const [state, setState] = useState<OrganismState>({
    agents: [],
    signals: [],
    knowledge: { node_count: 0, edge_count: 0, recent: [] },
    immune: { status: 'clear', active_incidents: 0, antibody_count: 0, incidents: [] },
    dreams: { last_cycle: null, patterns_extracted: 0, events: [] },
    evolution: { events: [] },
    vitals: { cpu: 0, memory: 0, cost_today: 0, executions_today: 0, uptime: 0 },
  });

  const [feedEvents, setFeedEvents] = useState<{ text: string; color: string; time: string }[]>([]);

  const fetchOrganism = useCallback(async () => {
    try {
      const [agents, knowledgeStats, incidents, signals] = await Promise.all([
        hubApi.agents.list().then(r => r.agents).catch(() => []),
        fetch(`${API_BASE}/api/v1/knowledge/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/api/v1/incidents`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/api/v1/nervous/signals/recent`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      // Build vitals from agent data
      const costToday = agents.reduce((sum: number, a: Agent) => {
        const cost = (a as unknown as Record<string, unknown>)['cost_today'];
        return sum + (typeof cost === 'number' ? cost : 0);
      }, 0);

      const execsToday = agents.reduce((sum: number, a: Agent) => sum + a.tasks_completed, 0);

      setState(prev => ({
        ...prev,
        agents: agents as Agent[],
        signals: (signals?.signals || signals || []) as NeuralSignal[],
        knowledge: {
          node_count: knowledgeStats?.node_count || prev.knowledge.node_count,
          edge_count: knowledgeStats?.edge_count || prev.knowledge.edge_count,
          recent: knowledgeStats?.recent || prev.knowledge.recent,
        },
        immune: {
          status: incidents?.active_count > 0 ? 'responding' : 'clear',
          active_incidents: incidents?.active_count || 0,
          antibody_count: incidents?.antibody_count || prev.immune.antibody_count,
          incidents: incidents?.incidents || prev.immune.incidents,
        },
        vitals: {
          ...prev.vitals,
          cost_today: costToday,
          executions_today: execsToday,
          memory: Math.random() * 40 + 30, // TODO: real metrics
          cpu: Math.random() * 30 + 15, // TODO: real metrics
        },
      }));
    } catch {
      // Silent fail — organism view is observational
    }
  }, []);

  usePolling(fetchOrganism, 5000);

  // Build feed from signals and events
  useEffect(() => {
    const newEvents: { text: string; color: string; time: string }[] = [];

    for (const sig of state.signals.slice(-20)) {
      const time = new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      newEvents.push({
        text: `${sig.from} → ${sig.to}: ${sig.type}`,
        color: '#00ff88',
        time,
      });
    }

    for (const inc of state.immune.incidents.slice(-5)) {
      const time = new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      newEvents.push({
        text: `IMMUNE: ${inc.title} [${inc.severity}]`,
        color: inc.severity === 'critical' ? '#ff2d55' : '#ffb800',
        time,
      });
    }

    if (newEvents.length > 0) {
      setFeedEvents(prev => [...prev, ...newEvents].slice(-100));
    }
  }, [state.signals, state.immune.incidents]);

  return (
    <div className="organism-tab">
      <div className="organism-header">
        <h2 className="organism-title">The Organism</h2>
        <div className="organism-subtitle">Real-time view of a living system</div>
      </div>

      <VitalSigns vitals={state.vitals} />

      <div className="organism-main">
        <div className="organism-left">
          <div className="organism-canvas-wrap">
            <NeuralCanvas agents={state.agents} signals={state.signals} />
          </div>
          <SystemsPanel state={state} />
        </div>
        <div className="organism-right">
          <div className="organism-feed-header">AUTONOMOUS DECISIONS</div>
          <ActivityFeed events={feedEvents} />
        </div>
      </div>
    </div>
  );
}
