import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { Ticket } from '../../hooks/useHubApi';
import './DelegationGraph.css';

interface DelegNode {
  id: string;
  name: string;
  ticketCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface DelegLink {
  source: string;
  target: string;
  count: number;
}

const AGENT_COLORS: Record<string, string> = {
  'Alf': '#f59e0b',
  'System': '#f59e0b',
  'Backend Dev': '#60a5fa',
  'Frontend Dev': '#a78bfa',
  'QA': '#34d399',
  'Infra': '#fb923c',
  'Security': '#f87171',
  'Writer': '#e879f9',
  'Watchdog': '#2dd4bf',
  'core_engine': '#f59e0b',
};

const DEFAULT_COLOR = '#94a3b8';

function agentColor(name: string): string {
  return AGENT_COLORS[name] || DEFAULT_COLOR;
}

// Simple force simulation
function simulate(nodes: DelegNode[], links: DelegLink[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;

  // Place nodes in a circle initially
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(width, height) * 0.3;
    n.x = cx + Math.cos(angle) * r;
    n.y = cy + Math.sin(angle) * r;
    n.vx = 0;
    n.vy = 0;
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Run 120 iterations of force simulation
  for (let iter = 0; iter < 120; iter++) {
    const alpha = 1 - iter / 120;

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (800 * alpha) / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx;
        a.vy -= dy;
        b.vx += dx;
        b.vy += dy;
      }
    }

    // Attraction along links
    for (const link of links) {
      const a = nodeMap.get(link.source);
      const b = nodeMap.get(link.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 100) * 0.02 * alpha;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.01 * alpha;
      n.vy += (cy - n.y) * 0.01 * alpha;
    }

    // Apply velocity with damping
    for (const n of nodes) {
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      // Keep in bounds
      n.x = Math.max(n.radius + 20, Math.min(width - n.radius - 20, n.x));
      n.y = Math.max(n.radius + 20, Math.min(height - n.radius - 20, n.y));
    }
  }
}

export default function DelegationGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<DelegNode[]>([]);
  const [links, setLinks] = useState<DelegLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

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

      const nodeMap = new Map<string, number>();
      const edgeMap = new Map<string, number>();

      const bump = (name: string) => nodeMap.set(name, (nodeMap.get(name) || 0) + 1);

      for (const t of tickets) {
        const from = t.agent_name || 'System';
        const to = t.assigned_to;
        bump(from);
        if (to && to !== from) {
          bump(to);
          const key = `${from}\0${to}`;
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        }
      }

      const newNodes: DelegNode[] = Array.from(nodeMap.entries()).map(([name, count]) => ({
        id: name,
        name,
        ticketCount: count,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: Math.max(12, Math.min(35, 8 + count * 1.5)),
      }));

      const nodeIds = new Set(newNodes.map(n => n.id));
      const newLinks: DelegLink[] = Array.from(edgeMap.entries())
        .filter(([key]) => {
          const [s, t] = key.split('\0');
          return nodeIds.has(s!) && nodeIds.has(t!);
        })
        .map(([key, count]) => {
          const [source, target] = key.split('\0');
          return { source: source!, target: target!, count };
        });

      simulate(newNodes, newLinks, dimensions.width, dimensions.height);
      setNodes(newNodes);
      setLinks(newLinks);
    } catch (err) {
      console.error('Failed to load delegation graph:', err);
    }
    setLoading(false);
  }, [dimensions.width, dimensions.height]);

  useEffect(() => { loadData(); }, [loadData]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const selectedDetail = selectedNode ? nodeMap.get(selectedNode) : null;
  const selectedEdges = selectedNode
    ? links.filter(l => l.source === selectedNode || l.target === selectedNode)
    : [];

  const visibleAgents = Object.entries(AGENT_COLORS).filter(([name]) =>
    nodes.some(n => n.name === name)
  );

  return (
    <div className="deleg-graph">
      <div className="deleg-header">
        <div className="deleg-title">
          <h2>Agent Delegation Graph</h2>
          <span className="deleg-subtitle">Ticket assignments between agents — node size = ticket involvement</span>
        </div>
        {visibleAgents.length > 0 && (
          <div className="deleg-legend">
            {visibleAgents.map(([name, color]) => (
              <span key={name} className="deleg-legend-item">
                <span className="deleg-legend-dot" style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="deleg-body">
        <div className="deleg-canvas" ref={containerRef}>
          {loading ? (
            <div className="deleg-loading">Loading delegation data...</div>
          ) : nodes.length === 0 ? (
            <div className="deleg-loading">No delegation data found.</div>
          ) : (
            <svg width={dimensions.width} height={dimensions.height} style={{ display: 'block' }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="rgba(148,163,184,0.5)" />
                </marker>
              </defs>

              {/* Links */}
              {links.map((link) => {
                const s = nodeMap.get(link.source);
                const t = nodeMap.get(link.target);
                if (!s || !t) return null;
                const alpha = Math.min(0.7, 0.15 + link.count * 0.12);
                const width = Math.max(1, Math.min(4, link.count * 0.8));
                const isHighlighted = selectedNode && (link.source === selectedNode || link.target === selectedNode);
                return (
                  <line
                    key={`${link.source}-${link.target}`}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={isHighlighted ? 'rgba(148,163,184,0.8)' : `rgba(148,163,184,${alpha})`}
                    strokeWidth={isHighlighted ? width + 1 : width}
                    markerEnd="url(#arrowhead)"
                  />
                );
              })}

              {/* Link counts at midpoints */}
              {links.map((link) => {
                const s = nodeMap.get(link.source);
                const t = nodeMap.get(link.target);
                if (!s || !t || link.count < 2) return null;
                const mx = (s.x + t.x) / 2;
                const my = (s.y + t.y) / 2;
                return (
                  <g key={`count-${link.source}-${link.target}`}>
                    <circle cx={mx} cy={my} r={8} fill="rgba(15,23,42,0.8)" stroke="rgba(148,163,184,0.3)" strokeWidth={1} />
                    <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize={9} fontWeight={600}>
                      {link.count}
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const color = agentColor(node.name);
                const isSelected = selectedNode === node.id;
                return (
                  <g
                    key={node.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedNode(prev => prev === node.id ? null : node.id)}
                  >
                    {/* Glow */}
                    <circle cx={node.x} cy={node.y} r={node.radius + 6} fill={color} opacity={0.08} />
                    {/* Main circle */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={color}
                      stroke={isSelected ? '#ffffff' : 'none'}
                      strokeWidth={isSelected ? 2.5 : 0}
                      opacity={selectedNode && !isSelected ? 0.4 : 1}
                    />
                    {/* Count inside */}
                    <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={Math.max(10, node.radius * 0.6)} fontWeight={700}>
                      {node.ticketCount}
                    </text>
                    {/* Label below */}
                    <text x={node.x} y={node.y + node.radius + 14} textAnchor="middle" fill="rgba(241,245,249,0.85)" fontSize={11} fontWeight={500}>
                      {node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {selectedDetail && (
          <div className="deleg-detail">
            <div className="deleg-detail-header">
              <span className="deleg-detail-dot" style={{ background: agentColor(selectedDetail.name) }} />
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
