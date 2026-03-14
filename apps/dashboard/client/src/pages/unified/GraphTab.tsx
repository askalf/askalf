import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { KnowledgeNode, KnowledgeEdge } from '../../hooks/useHubApi';
import { relativeTime } from '../../utils/format';
import './GraphTab.css';

// ── Color map for entity types ──
const TYPE_COLORS: Record<string, string> = {
  concept: '#60a5fa', person: '#f472b6', tool: '#a78bfa', service: '#34d399',
  file: '#fbbf24', error: '#f87171', pattern: '#818cf8', ticket: '#fb923c',
  metric: '#2dd4bf', component: '#c084fc', system: '#94a3b8',
};

const RELATION_COLORS: Record<string, string> = {
  uses: '#60a5fa', depends_on: '#f59e0b', causes: '#ef4444', fixes: '#22c55e',
  relates_to: '#a78bfa', contains: '#6366f1', produces: '#14b8a6',
};

interface GNode {
  id: string; label: string; entity_type: string; mention_count: number;
  description: string | null; agent_name?: string; last_mentioned?: string;
  x: number; y: number; vx: number; vy: number; size: number;
}

interface GLink {
  source: string; target: string; relation: string; weight: number; id: string;
}

interface TopNode { label: string; entity_type: string; mention_count: number; id: string; }

// ── Simple force simulation ──
function runForceSimulation(nodes: GNode[], links: GLink[], width: number, height: number, iterations: number) {
  // Init positions
  for (const n of nodes) {
    n.x = width / 2 + (Math.random() - 0.5) * width * 0.8;
    n.y = height / 2 + (Math.random() - 0.5) * height * 0.8;
    n.vx = 0; n.vy = 0;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const alpha0 = 1.0;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = alpha0 * (1 - iter / iterations);
    if (alpha < 0.001) break;

    // Repulsion (Barnes-Hut simplified: just pairwise for manageable sizes, grid-based for large)
    const repK = 800;
    // Use grid-based approximation for large graphs
    if (nodes.length > 500) {
      const cellSize = 80;
      const grid = new Map<string, GNode[]>();
      for (const n of nodes) {
        const key = `${Math.floor(n.x / cellSize)},${Math.floor(n.y / cellSize)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(n);
      }
      for (const n of nodes) {
        const cx = Math.floor(n.x / cellSize);
        const cy = Math.floor(n.y / cellSize);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const neighbors = grid.get(`${cx + dx},${cy + dy}`);
            if (!neighbors) continue;
            for (const m of neighbors) {
              if (m.id === n.id) continue;
              const ddx = n.x - m.x;
              const ddy = n.y - m.y;
              const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              if (dist > cellSize * 3) continue;
              const force = repK / (dist * dist) * alpha;
              n.vx += (ddx / dist) * force;
              n.vy += (ddy / dist) * force;
            }
          }
        }
      }
    } else {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!, b = nodes[j]!;
          const dx = a.x - b.x; const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repK / (dist * dist) * alpha;
          const fx = (dx / dist) * force; const fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
    }

    // Link attraction
    const linkK = 0.3;
    const idealLen = 60;
    for (const link of links) {
      const s = nodeMap.get(link.source); const t = nodeMap.get(link.target);
      if (!s || !t) continue;
      const dx = t.x - s.x; const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLen) * linkK * alpha;
      const fx = (dx / dist) * force; const fy = (dy / dist) * force;
      s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.01 * alpha;
      n.vy += (height / 2 - n.y) * 0.01 * alpha;
    }

    // Apply velocity with damping
    for (const n of nodes) {
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
    }
  }
}

export default function GraphTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [links, setLinks] = useState<GLink[]>([]);
  const [stats, setStats] = useState<{ totalNodes: number; totalEdges: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);
  const [neighborNodes, setNeighborNodes] = useState<KnowledgeNode[]>([]);
  const [neighborEdges, setNeighborEdges] = useState<KnowledgeEdge[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [entityTypes, setEntityTypes] = useState<{ entity_type: string; count: number }[]>([]);
  const [agents, setAgents] = useState<{ agent_id: string; agent_name: string; node_count: number }[]>([]);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [topConnected, setTopConnected] = useState<TopNode[]>([]);
  const [showTopPanel, setShowTopPanel] = useState(false);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

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

  // Load graph data
  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const [graphRes, statsRes, typesRes, agentsRes, topRes] = await Promise.all([
        hubApi.knowledgeGraph.graph({ limit: 1000, type: typeFilter || undefined, agent_id: agentFilter || undefined }),
        hubApi.knowledgeGraph.stats(),
        hubApi.knowledgeGraph.entityTypes(),
        hubApi.knowledgeGraph.agents(),
        hubApi.knowledgeGraph.topConnected(10),
      ]);

      const gNodes: GNode[] = (graphRes.nodes || []).map((n: KnowledgeNode) => ({
        id: n.id, label: n.label, entity_type: n.entity_type,
        mention_count: n.mention_count, description: n.description,
        agent_name: n.agent_name, last_mentioned: n.last_mentioned,
        x: 0, y: 0, vx: 0, vy: 0,
        size: Math.max(3, Math.min(14, n.mention_count * 2)),
      }));

      const nodeIds = new Set(gNodes.map(n => n.id));
      const gLinks: GLink[] = (graphRes.edges || [])
        .filter((e: KnowledgeEdge) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
        .map((e: KnowledgeEdge) => ({
          source: e.source_id, target: e.target_id,
          relation: e.relation, weight: e.weight, id: e.id,
        }));

      // Run simulation
      runForceSimulation(gNodes, gLinks, dimensions.width || 800, dimensions.height || 600, Math.min(200, 50 + gNodes.length / 5));

      setNodes(gNodes);
      setLinks(gLinks);
      setStats(statsRes);
      setEntityTypes((typesRes.types || typesRes) as { entity_type: string; count: number }[]);
      setAgents((agentsRes.agents || agentsRes) as { agent_id: string; agent_name: string; node_count: number }[]);
      setTopConnected(((topRes.nodes || topRes) as KnowledgeNode[]).map((n: KnowledgeNode) => ({
        label: n.label, entity_type: n.entity_type, mention_count: n.mention_count, id: n.id,
      })));
    } catch (err) {
      console.error('Failed to load knowledge graph:', err);
    }
    setLoading(false);
  }, [typeFilter, agentFilter, dimensions.width, dimensions.height]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) { setHighlightNodes(new Set()); return; }
    const q = searchQuery.toLowerCase();
    setHighlightNodes(new Set(
      nodes.filter(n => n.label.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q)).map(n => n.id)
    ));
  }, [searchQuery, nodes]);

  // Node click
  const handleNodeClick = useCallback(async (node: GNode) => {
    setSelectedNode(node);
    try {
      const res = await hubApi.knowledgeGraph.neighborhood(node.id);
      setNeighborNodes(res.nodes || []);
      setNeighborEdges(res.edges || []);
    } catch { setNeighborNodes([]); setNeighborEdges([]); }
  }, []);

  const knownByAgents = useMemo(() => {
    if (!selectedNode || neighborNodes.length === 0) return [];
    const agentSet = new Map<string, string>();
    for (const n of neighborNodes) {
      if (n.agent_name && n.agent_id) agentSet.set(n.agent_id, n.agent_name);
    }
    return Array.from(agentSet.values());
  }, [selectedNode, neighborNodes]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dimensions.width * (window.devicePixelRatio || 1);
    canvas.height = dimensions.height * (window.devicePixelRatio || 1);
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const { x: tx, y: ty, k } = transform;
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(k, k);

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const hasDim = highlightNodes.size > 0;
    const phase = (Date.now() % 4000) / 4000;

    // Draw links
    for (const link of links) {
      const s = nodeMap.get(link.source);
      const t = nodeMap.get(link.target);
      if (!s || !t) continue;
      const color = RELATION_COLORS[link.relation] || '#4b5563';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = hasDim ? `${color}30` : `${color}50`;
      ctx.lineWidth = Math.max(0.3, link.weight * 1.2);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const color = TYPE_COLORS[node.entity_type] || '#6b7280';
      const isHighlighted = hasDim && highlightNodes.has(node.id);
      const isSelected = selectedNode?.id === node.id;
      const isDimmed = hasDim && !highlightNodes.has(node.id);

      // Pulse glow for high-mention nodes
      if (!isDimmed && node.mention_count > 3) {
        const nodePhase = ((node.id.charCodeAt(0) || 0) % 17) / 17;
        const pulse = Math.sin((phase + nodePhase) * Math.PI * 2) * 0.5 + 0.5;
        const glowR = node.size + 4 + pulse * 4;
        const gradient = ctx.createRadialGradient(node.x, node.y, node.size * 0.5, node.x, node.y, glowR);
        const alpha = Math.round((0.08 + pulse * 0.07) * 255).toString(16).padStart(2, '0');
        gradient.addColorStop(0, `${color}${alpha}`);
        gradient.addColorStop(1, `${color}00`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
      ctx.fillStyle = isDimmed ? `${color}40` : color;
      ctx.fill();

      if (isSelected || isHighlighted) {
        ctx.strokeStyle = isSelected ? '#ffffff' : '#fbbf24';
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.stroke();
      }

      // Label
      const fontSize = Math.max(3, node.size * 0.8);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
      ctx.fillText(node.label, node.x, node.y + node.size + 2);
    }

    ctx.restore();
  }, [nodes, links, dimensions, transform, highlightNodes, selectedNode]);

  // Animate pulse
  useEffect(() => {
    if (nodes.length === 0) return;
    let frame = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        // Trigger re-render by updating transform identity (no visible change)
        setTransform(t => ({ ...t }));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [nodes.length]);

  // Pan & zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => {
      const newK = Math.max(0.1, Math.min(5, t.k * scale));
      const rect = containerRef.current?.getBoundingClientRect();
      const mx = e.clientX - (rect?.left || 0);
      const my = e.clientY - (rect?.top || 0);
      return { x: mx - (mx - t.x) * (newK / t.k), y: my - (my - t.y) * (newK / t.k), k: newK };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    setTransform(t => ({
      ...t,
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    }));
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current.dragging = false; }, []);

  // Click detection on canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.dragging) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - transform.x) / transform.k;
    const my = (e.clientY - rect.top - transform.y) / transform.k;
    // Find closest node within click radius
    let closest: GNode | null = null;
    let closestDist = Infinity;
    for (const n of nodes) {
      const dist = Math.sqrt((n.x - mx) ** 2 + (n.y - my) ** 2);
      if (dist < n.size + 5 && dist < closestDist) {
        closest = n;
        closestDist = dist;
      }
    }
    if (closest) handleNodeClick(closest);
    else setSelectedNode(null);
  }, [nodes, transform, handleNodeClick]);

  const isEmpty = !loading && nodes.length === 0;

  return (
    <div className="graph-tab">
      {/* Controls */}
      <div className="graph-controls">
        <div className="graph-controls-row">
          <div className="graph-search-wrap">
            <input type="text" className="graph-search" placeholder="Search nodes..."
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearchQuery(searchInput)} />
            {searchInput && (
              <button className="graph-search-clear" onClick={() => { setSearchInput(''); setSearchQuery(''); }}>x</button>
            )}
          </div>
          <select className="graph-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {entityTypes.map(t => <option key={t.entity_type} value={t.entity_type}>{t.entity_type} ({t.count})</option>)}
          </select>
          <select className="graph-filter" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All Agents</option>
            {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.agent_name} ({a.node_count})</option>)}
          </select>
          <button className="graph-btn" onClick={loadGraph}>Reload</button>
        </div>
        {stats && (
          <div className="graph-stats-row">
            <span className="graph-stat">{stats.totalNodes} nodes</span>
            <span className="graph-stat">{stats.totalEdges} edges</span>
            {highlightNodes.size > 0 && <span className="graph-stat highlight">{highlightNodes.size} matched</span>}
            {topConnected.length > 0 && (
              <button className={`graph-stat graph-stat-btn ${showTopPanel ? 'active' : ''}`}
                onClick={() => setShowTopPanel(!showTopPanel)}>Top hubs</button>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <button key={type} className={`graph-legend-item ${typeFilter === type ? 'active' : ''}`}
            onClick={() => setTypeFilter(typeFilter === type ? '' : type)}>
            <span className="graph-legend-dot" style={{ background: color }} />{type}
          </button>
        ))}
      </div>

      {/* Top connected panel */}
      {showTopPanel && topConnected.length > 0 && (
        <div className="graph-top-panel">
          <h4 className="graph-top-title">Most Connected Nodes</h4>
          {topConnected.map((n, i) => (
            <div key={n.id} className="graph-top-item" onClick={() => {
              const gn = nodes.find(x => x.id === n.id);
              if (gn) handleNodeClick(gn);
            }}>
              <span className="graph-top-rank">#{i + 1}</span>
              <span className="graph-legend-dot" style={{ background: TYPE_COLORS[n.entity_type] || '#6b7280' }} />
              <span className="graph-top-label">{n.label}</span>
              <span className="graph-top-count">{n.mention_count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div className="graph-canvas" ref={containerRef}>
        {loading && <div className="graph-loading">Loading knowledge graph...</div>}
        {isEmpty && (
          <div className="graph-empty">
            <div className="graph-empty-icon">Nodes</div>
            <div className="graph-empty-title">Knowledge graph is empty</div>
            <div className="graph-empty-msg">Run agents to populate the knowledge graph</div>
          </div>
        )}
        <canvas ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: dragRef.current.dragging ? 'grabbing' : 'grab' }}
          onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onClick={handleCanvasClick} />
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <div className="graph-detail">
          <div className="graph-detail-header">
            <span className="graph-detail-type" style={{ color: TYPE_COLORS[selectedNode.entity_type] || '#6b7280' }}>
              {selectedNode.entity_type}
            </span>
            <button className="graph-detail-close" onClick={() => setSelectedNode(null)}>x</button>
          </div>
          <h3 className="graph-detail-title">{selectedNode.label}</h3>
          {selectedNode.description && <p className="graph-detail-desc">{selectedNode.description}</p>}
          <div className="graph-detail-meta">
            <span>Mentions: {selectedNode.mention_count}</span>
            {selectedNode.agent_name && <span>Source: {selectedNode.agent_name}</span>}
            {selectedNode.last_mentioned && <span>Last seen: {relativeTime(selectedNode.last_mentioned)}</span>}
          </div>
          {knownByAgents.length > 0 && (
            <div className="graph-detail-agents">
              <h4>Known by agents ({knownByAgents.length})</h4>
              <div className="graph-detail-agent-list">
                {knownByAgents.map(a => <span key={a} className="graph-agent-tag">{a}</span>)}
              </div>
            </div>
          )}
          {neighborEdges.length > 0 && (
            <div className="graph-detail-edges">
              <h4>Connections ({neighborEdges.length})</h4>
              <div className="graph-detail-edge-list">
                {neighborEdges.map(e => {
                  const isSource = e.source_id === selectedNode.id;
                  const otherLabel = isSource ? e.target_label : e.source_label;
                  return (
                    <div key={e.id} className="graph-detail-edge">
                      <span className="graph-edge-relation" style={{ color: RELATION_COLORS[e.relation] || '#6b7280' }}>
                        {isSource ? `--${e.relation}-->` : `<--${e.relation}--`}
                      </span>
                      <span className="graph-edge-target">{otherLabel || '?'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
