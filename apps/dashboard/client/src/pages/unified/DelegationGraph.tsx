import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { Ticket } from '../../hooks/useHubApi';
import './DelegationGraph.css';

interface DelegNode {
  id: string; name: string; ticketCount: number;
  x: number; y: number; vx: number; vy: number; radius: number;
  phase: number; color: [number, number, number];
}

interface DelegLink {
  source: string; target: string; count: number; pulseOffset: number;
}

interface SynapticPulse {
  linkIdx: number; progress: number; speed: number;
  color: [number, number, number]; size: number;
}

const AGENT_COLORS: Record<string, [number, number, number]> = {
  'Alf': [245, 158, 11], 'System': [245, 158, 11], 'core_engine': [245, 158, 11],
  'Backend Dev': [96, 165, 250], 'Frontend Dev': [167, 139, 250],
  'QA': [52, 211, 153], 'Infra': [251, 146, 60],
  'Security': [248, 113, 113], 'Writer': [232, 121, 249], 'Watchdog': [45, 212, 191],
};
const DEFAULT_COLOR: [number, number, number] = [148, 163, 184];
function agentColor(name: string): [number, number, number] { return AGENT_COLORS[name] || DEFAULT_COLOR; }
function rgba(c: [number, number, number], a: number): string { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function rgb(c: [number, number, number]): string { return `rgb(${c[0]},${c[1]},${c[2]})`; }

function simulate(nodes: DelegNode[], links: DelegLink[], width: number, height: number) {
  const cx = width / 2; const cy = height / 2;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(width, height) * 0.28;
    n.x = cx + Math.cos(angle) * r; n.y = cy + Math.sin(angle) * r;
    n.vx = 0; n.vy = 0;
  });
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (let iter = 0; iter < 150; iter++) {
    const alpha = 1 - iter / 150;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        let dx = b.x - a.x; let dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (1000 * alpha) / (dist * dist);
        dx = (dx / dist) * force; dy = (dy / dist) * force;
        a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
      }
    }
    for (const link of links) {
      const a = nodeMap.get(link.source); const b = nodeMap.get(link.target);
      if (!a || !b) continue;
      let dx = b.x - a.x; let dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 120) * 0.02 * alpha;
      dx = (dx / dist) * force; dy = (dy / dist) * force;
      a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.01 * alpha;
      n.vy += (cy - n.y) * 0.01 * alpha;
      n.vx *= 0.55; n.vy *= 0.55;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.radius + 30, Math.min(width - n.radius - 30, n.x));
      n.y = Math.max(n.radius + 30, Math.min(height - n.radius - 30, n.y));
    }
  }
}

export default function DelegationGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<DelegNode[]>([]);
  const [links, setLinks] = useState<DelegLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  const nodesRef = useRef<DelegNode[]>([]);
  const linksRef = useRef<DelegLink[]>([]);
  const nodeMapRef = useRef(new Map<string, DelegNode>());
  const selectedRef = useRef<string | null>(null);
  const pulsesRef = useRef<SynapticPulse[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const animRef = useRef(0);

  useEffect(() => { nodesRef.current = nodes; nodeMapRef.current = new Map(nodes.map(n => [n.id, n])); }, [nodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hubApi.tickets.list({ limit: 200 });
      const tickets: Ticket[] = res.tickets || [];
      const nMap = new Map<string, number>();
      const eMap = new Map<string, number>();
      const bump = (name: string) => nMap.set(name, (nMap.get(name) || 0) + 1);
      for (const t of tickets) {
        const from = t.agent_name || 'System';
        const to = t.assigned_to;
        bump(from);
        if (to && to !== from) {
          bump(to);
          eMap.set(`${from}\0${to}`, (eMap.get(`${from}\0${to}`) || 0) + 1);
        }
      }
      const newNodes: DelegNode[] = Array.from(nMap.entries()).map(([name, count], i) => ({
        id: name, name, ticketCount: count,
        x: 0, y: 0, vx: 0, vy: 0,
        radius: Math.max(14, Math.min(40, 10 + Math.sqrt(count) * 5)),
        phase: (i * 0.618) % 1,
        color: agentColor(name),
      }));
      const nodeIds = new Set(newNodes.map(n => n.id));
      const newLinks: DelegLink[] = Array.from(eMap.entries())
        .filter(([key]) => { const [s, t] = key.split('\0'); return nodeIds.has(s!) && nodeIds.has(t!); })
        .map(([key, count], i) => {
          const [source, target] = key.split('\0');
          return { source: source!, target: target!, count, pulseOffset: (i * 0.381) % 1 };
        });
      simulate(newNodes, newLinks, dimensions.width, dimensions.height);
      setNodes(newNodes);
      setLinks(newLinks);
    } catch (err) { console.error('Failed to load delegation graph:', err); }
    setLoading(false);
  }, [dimensions.width, dimensions.height]);

  useEffect(() => { loadData(); }, [loadData]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const selectedDetail = selectedNode ? nodeMap.get(selectedNode) : null;
  const selectedEdges = selectedNode ? links.filter(l => l.source === selectedNode || l.target === selectedNode) : [];

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let lastPulse = 0;

    const tick = (time: number) => {
      const ns = nodesRef.current;
      const ls = linksRef.current;
      const w = dimensions.width; const h = dimensions.height;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background nebula
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
      bgGrad.addColorStop(0, '#0d0d1a');
      bgGrad.addColorStop(0.5, '#080812');
      bgGrad.addColorStop(1, '#04040a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle color bloom
      const bp = Math.sin(time * 0.0003) * 0.5 + 0.5;
      const bloom = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.4);
      bloom.addColorStop(0, `rgba(124, 58, 237, ${0.02 + bp * 0.01})`);
      bloom.addColorStop(0.6, `rgba(45, 212, 191, ${0.008})`);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, w, h);

      if (ns.length === 0) { animRef.current = requestAnimationFrame(tick); return; }

      const nm = nodeMapRef.current;
      const sel = selectedRef.current;

      // Spawn pulses
      if (ls.length > 0 && time - lastPulse > 200) {
        lastPulse = time;
        const idx = Math.floor(Math.random() * ls.length);
        const link = ls[idx]!;
        const sn = nm.get(link.source);
        const col: [number, number, number] = sn ? sn.color : DEFAULT_COLOR;
        pulsesRef.current.push({ linkIdx: idx, progress: 0, speed: 0.006 + Math.random() * 0.008, color: col, size: 2 + Math.random() * 2 });
      }
      pulsesRef.current = pulsesRef.current.filter(p => { p.progress += p.speed; return p.progress < 1; });

      // Draw edges
      for (const link of ls) {
        const s = nm.get(link.source); const t = nm.get(link.target);
        if (!s || !t) continue;
        const isHl = sel && (link.source === sel || link.target === sel);
        const baseAlpha = isHl ? 0.35 : 0.12;
        const lw = Math.max(0.8, Math.min(4, link.count * 0.8));

        const mx = (s.x + t.x) / 2; const my = (s.y + t.y) / 2;
        const dx = t.x - s.x; const dy = t.y - s.y;
        const cpx = mx + (-dy * 0.1); const cpy = my + (dx * 0.1);

        // Glow layer
        ctx.beginPath();
        ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(cpx, cpy, t.x, t.y);
        ctx.strokeStyle = rgba(s.color, baseAlpha * 0.4);
        ctx.lineWidth = lw + 3;
        ctx.stroke();

        // Core
        ctx.beginPath();
        ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(cpx, cpy, t.x, t.y);
        ctx.strokeStyle = rgba(s.color, baseAlpha);
        ctx.lineWidth = lw;
        ctx.stroke();

        // Arrow at 80%
        const at = 0.8;
        const it = 1 - at;
        const ax = it * it * s.x + 2 * it * at * cpx + at * at * t.x;
        const ay = it * it * s.y + 2 * it * at * cpy + at * at * t.y;
        const dt2 = 0.82; const it2 = 1 - dt2;
        const bx = it2 * it2 * s.x + 2 * it2 * dt2 * cpx + dt2 * dt2 * t.x;
        const by = it2 * it2 * s.y + 2 * it2 * dt2 * cpy + dt2 * dt2 * t.y;
        const angle = Math.atan2(bx - ax, by - ay);
        const arrSize = 6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + arrSize * Math.sin(angle - Math.PI / 6), ay + arrSize * Math.cos(angle - Math.PI / 6));
        ctx.lineTo(ax + arrSize * Math.sin(angle + Math.PI / 6), ay + arrSize * Math.cos(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = rgba(s.color, baseAlpha * 1.5);
        ctx.fill();
      }

      // Draw synaptic pulses
      for (const pulse of pulsesRef.current) {
        const link = ls[pulse.linkIdx]; if (!link) continue;
        const s = nm.get(link.source); const t = nm.get(link.target);
        if (!s || !t) continue;
        const p = pulse.progress; const ip = 1 - p;
        const mx = (s.x + t.x) / 2; const my = (s.y + t.y) / 2;
        const dx = t.x - s.x; const dy = t.y - s.y;
        const cpx = mx + (-dy * 0.1); const cpy = my + (dx * 0.1);
        const px = ip * ip * s.x + 2 * ip * p * cpx + p * p * t.x;
        const py = ip * ip * s.y + 2 * ip * p * cpy + p * p * t.y;

        const grad = ctx.createRadialGradient(px, py, 0, px, py, pulse.size * 5);
        grad.addColorStop(0, rgba(pulse.color, 0.5));
        grad.addColorStop(0.4, rgba(pulse.color, 0.12));
        grad.addColorStop(1, rgba(pulse.color, 0));
        ctx.beginPath(); ctx.arc(px, py, pulse.size * 5, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, pulse.size, 0, Math.PI * 2);
        ctx.fillStyle = rgba(pulse.color, 0.85); ctx.fill();
      }

      // Draw nodes
      for (const node of ns) {
        const col = node.color;
        const isSel = sel === node.id;
        const isDimmed = sel && !isSel;
        const breathe = Math.sin(time * 0.0018 + node.phase * Math.PI * 2) * 0.5 + 0.5;
        const r = node.radius * (0.92 + breathe * 0.16);

        let proxGlow = 0;
        if (mouseRef.current) {
          const dist = Math.sqrt((node.x - mouseRef.current.x) ** 2 + (node.y - mouseRef.current.y) ** 2);
          proxGlow = Math.max(0, 1 - dist / 100);
        }

        // Outer aura
        if (!isDimmed) {
          const auraR = r * (2.2 + breathe * 1.2 + proxGlow * 1.5);
          const aura = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, auraR);
          aura.addColorStop(0, rgba(col, 0.12 + proxGlow * 0.1));
          aura.addColorStop(0.6, rgba(col, 0.03));
          aura.addColorStop(1, rgba(col, 0));
          ctx.beginPath(); ctx.arc(node.x, node.y, auraR, 0, Math.PI * 2);
          ctx.fillStyle = aura; ctx.fill();
        }

        // Corona
        if (!isDimmed) {
          const coronaR = r * 1.5;
          const corona = ctx.createRadialGradient(node.x, node.y, r * 0.6, node.x, node.y, coronaR);
          corona.addColorStop(0, rgba(col, 0.2 + breathe * 0.08));
          corona.addColorStop(1, rgba(col, 0));
          ctx.beginPath(); ctx.arc(node.x, node.y, coronaR, 0, Math.PI * 2);
          ctx.fillStyle = corona; ctx.fill();
        }

        // Core
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (isDimmed) {
          ctx.fillStyle = rgba(col, 0.2);
        } else {
          const cg = ctx.createRadialGradient(node.x - r * 0.25, node.y - r * 0.25, 0, node.x, node.y, r);
          cg.addColorStop(0, rgba([Math.min(255, col[0] + 50), Math.min(255, col[1] + 50), Math.min(255, col[2] + 50)], 0.95));
          cg.addColorStop(0.6, rgba(col, 0.85));
          cg.addColorStop(1, rgba(col, 0.65));
          ctx.fillStyle = cg;
        }
        ctx.fill();

        // Selection ring
        if (isSel) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(col, 0.4); ctx.lineWidth = 1; ctx.stroke();
        }

        // Count text inside
        const fontSize = Math.max(10, r * 0.55);
        ctx.font = `700 ${fontSize}px Satoshi, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.95)';
        ctx.fillText(String(node.ticketCount), node.x, node.y);

        // Name label below
        const lblSize = Math.max(9, r * 0.4);
        ctx.font = `500 ${lblSize}px Satoshi, system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)';
        ctx.fillText(node.name, node.x, node.y + r + 6);
      }

      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [dimensions]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseLeave = useCallback(() => { mouseRef.current = null; }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    let closest: DelegNode | null = null; let closestDist = Infinity;
    for (const n of nodesRef.current) {
      const dist = Math.sqrt((n.x - mx) ** 2 + (n.y - my) ** 2);
      if (dist < n.radius + 10 && dist < closestDist) { closest = n; closestDist = dist; }
    }
    setSelectedNode(prev => closest ? (prev === closest.id ? null : closest.id) : null);
  }, []);

  return (
    <div className="deleg-graph">
      <div className="deleg-header">
        <div className="deleg-title">
          <h2>Agent Delegation Graph</h2>
          <span className="deleg-subtitle">Ticket flow between agents — node size = involvement</span>
        </div>
        <div className="deleg-legend">
          {nodes.map(n => (
            <span key={n.id} className="deleg-legend-item">
              <span className="deleg-legend-dot" style={{ background: rgb(n.color), boxShadow: `0 0 6px ${rgba(n.color, 0.4)}` }} />
              {n.name}
            </span>
          ))}
        </div>
      </div>

      <div className="deleg-body">
        <div className="deleg-canvas" ref={containerRef}>
          {loading && (
            <div className="deleg-loading">
              <div className="deleg-loading-orb" />
              <span>Mapping delegation pathways...</span>
            </div>
          )}
          <canvas ref={canvasRef}
            style={{ width: '100%', height: '100%', cursor: 'pointer' }}
            onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick} />
        </div>

        {selectedDetail && (
          <div className="deleg-detail">
            <div className="deleg-detail-header">
              <span className="deleg-detail-dot" style={{ background: rgb(selectedDetail.color), boxShadow: `0 0 8px ${rgba(selectedDetail.color, 0.5)}` }} />
              <strong>{selectedDetail.name}</strong>
              <button className="deleg-detail-close" onClick={() => setSelectedNode(null)}>x</button>
            </div>
            <div className="deleg-detail-stat">
              <span>Ticket involvement</span>
              <span>{selectedDetail.ticketCount}</span>
            </div>
            {selectedEdges.length > 0 && (
              <div className="deleg-detail-edges">
                <div className="deleg-detail-edges-label">Delegation links</div>
                {selectedEdges.map(e => {
                  const isOut = e.source === selectedNode;
                  const other = isOut ? e.target : e.source;
                  return (
                    <div key={`${e.source}-${e.target}`} className="deleg-edge-row">
                      <span className={`deleg-edge-dir ${isOut ? 'out' : 'in'}`}>{isOut ? '\u2192' : '\u2190'}</span>
                      <span>{other}</span>
                      <span className="deleg-edge-count">{e.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
