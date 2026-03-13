import { useEffect, useState, useCallback, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { hubApi } from '../../hooks/useHubApi';
import type { Ticket } from '../../hooks/useHubApi';
import './DelegationGraph.css';

interface DelegNode {
  id: string;
  name: string;
  ticketCount: number;
  val: number;
  x?: number;
  y?: number;
}

interface DelegLink {
  source: string | DelegNode;
  target: string | DelegNode;
  count: number;
  id: string;
}

interface GraphData {
  nodes: DelegNode[];
  links: DelegLink[];
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
};

const DEFAULT_COLOR = '#94a3b8';

function agentColor(name: string): string {
  return AGENT_COLORS[name] || DEFAULT_COLOR;
}

export default function DelegationGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<DelegNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const pulsePhaseRef = useRef(0);
  const animFrameRef = useRef(0);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Ambient pulse animation
  useEffect(() => {
    const tick = () => {
      pulsePhaseRef.current = (Date.now() % 4000) / 4000;
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
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
          const key = `${from}→${to}`;
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        } else if (to && to === from) {
          // self-assigned — node already bumped
        } else if (to) {
          bump(to);
        }
      }

      const nodes: DelegNode[] = Array.from(nodeMap.entries()).map(([name, count]) => ({
        id: name,
        name,
        ticketCount: count,
        val: Math.max(5, Math.min(18, count * 1.8)),
      }));

      const nodeIds = new Set(nodes.map(n => n.id));
      const links: DelegLink[] = Array.from(edgeMap.entries())
        .filter(([key]) => {
          const sep = key.indexOf('→');
          const s = key.slice(0, sep);
          const t = key.slice(sep + 1);
          return nodeIds.has(s) && nodeIds.has(t);
        })
        .map(([key, count]) => {
          const sep = key.indexOf('→');
          return {
            source: key.slice(0, sep),
            target: key.slice(sep + 1),
            count,
            id: key,
          };
        });

      setGraphData({ nodes, links });
    } catch (err) {
      console.error('Failed to load delegation graph:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const paintNode = useCallback((node: DelegNode, ctx: CanvasRenderingContext2D) => {
    const size = node.val || 6;
    const color = agentColor(node.name);
    const isSelected = selectedNode?.id === node.id;
    const x = node.x as number;
    const y = node.y as number;

    const phase = pulsePhaseRef.current;
    const nodePhase = ((node.id?.charCodeAt?.(0) || 0) % 17) / 17;
    const pulse = Math.sin((phase + nodePhase) * Math.PI * 2) * 0.5 + 0.5;

    // Glow
    const glowRadius = size + 3 + pulse * 3;
    const glowAlpha = 0.06 + pulse * 0.08;
    const gradient = ctx.createRadialGradient(x, y, size * 0.5, x, y, glowRadius);
    gradient.addColorStop(0, `${color}${Math.round(glowAlpha * 255).toString(16).padStart(2, '0')}`);
    gradient.addColorStop(1, `${color}00`);
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label
    const fontSize = Math.max(4, size * 0.75);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(node.name, x, y + size + 2);
  }, [selectedNode]);

  const paintLink = useCallback((link: DelegLink, ctx: CanvasRenderingContext2D) => {
    const s = link.source as DelegNode;
    const t = link.target as DelegNode;
    if (typeof s !== 'object' || typeof t !== 'object') return;

    const sx = s.x as number;
    const sy = s.y as number;
    const tx = t.x as number;
    const ty = t.y as number;

    const alpha = Math.min(0.8, 0.2 + link.count * 0.15);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
    ctx.lineWidth = Math.max(0.5, Math.min(3, link.count * 0.8));
    ctx.stroke();

    // Arrow at midpoint
    const angle = Math.atan2(ty - sy, tx - sx);
    const arrowLen = 5;
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx - arrowLen * Math.cos(angle - Math.PI / 6), my - arrowLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(mx - arrowLen * Math.cos(angle + Math.PI / 6), my - arrowLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = `rgba(148,163,184,${alpha})`;
    ctx.fill();
  }, []);

  const handleNodeClick = useCallback((node: DelegNode) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node);
  }, []);

  const selectedEdges = selectedNode
    ? graphData.links.filter(l => {
        const s = typeof l.source === 'object' ? (l.source as DelegNode).id : l.source as string;
        const t = typeof l.target === 'object' ? (l.target as DelegNode).id : l.target as string;
        return s === selectedNode.id || t === selectedNode.id;
      })
    : [];

  const visibleAgents = Object.entries(AGENT_COLORS).filter(([name]) =>
    graphData.nodes.some(n => n.name === name)
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
            <div className="deleg-loading">Loading delegation data…</div>
          ) : graphData.nodes.length === 0 ? (
            <div className="deleg-loading">No delegation data found.</div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={paintNode}
              nodeCanvasObjectMode={() => 'replace'}
              linkCanvasObject={paintLink}
              linkCanvasObjectMode={() => 'replace'}
              onNodeClick={handleNodeClick}
              backgroundColor="transparent"
              nodeLabel={(node: DelegNode) => `${node.name} — ${node.ticketCount} ticket(s)`}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}
        </div>

        {selectedNode && (
          <div className="deleg-detail">
            <div className="deleg-detail-header">
              <span className="deleg-detail-dot" style={{ background: agentColor(selectedNode.name) }} />
              <strong>{selectedNode.name}</strong>
              <button className="deleg-detail-close" onClick={() => setSelectedNode(null)}>×</button>
            </div>
            <div className="deleg-detail-stat">
              <span>Ticket involvement</span>
              <span>{selectedNode.ticketCount}</span>
            </div>
            {selectedEdges.length > 0 && (
              <div className="deleg-detail-edges">
                <div className="deleg-detail-edges-label">Delegation links</div>
                {selectedEdges.map(e => {
                  const s = typeof e.source === 'object' ? (e.source as DelegNode).id : e.source as string;
                  const t = typeof e.target === 'object' ? (e.target as DelegNode).id : e.target as string;
                  const isOut = s === selectedNode.id;
                  const other = isOut ? t : s;
                  return (
                    <div key={e.id} className="deleg-edge-row">
                      <span className={`deleg-edge-dir ${isOut ? 'out' : 'in'}`}>{isOut ? '→' : '←'}</span>
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
