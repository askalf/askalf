import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { hubApi } from '../../hooks/useHubApi';
import type { KnowledgeNode, KnowledgeEdge } from '../../hooks/useHubApi';
import './GraphTab.css';

// ── Color map for entity types ──
const TYPE_COLORS: Record<string, string> = {
  concept: '#60a5fa',
  person: '#f472b6',
  tool: '#a78bfa',
  service: '#34d399',
  file: '#fbbf24',
  error: '#f87171',
  pattern: '#818cf8',
  ticket: '#fb923c',
  metric: '#2dd4bf',
  component: '#c084fc',
  system: '#94a3b8',
};

const RELATION_COLORS: Record<string, string> = {
  uses: '#60a5fa',
  depends_on: '#f59e0b',
  causes: '#ef4444',
  fixes: '#22c55e',
  relates_to: '#a78bfa',
  contains: '#6366f1',
  produces: '#14b8a6',
};

interface GraphData {
  nodes: { id: string; label: string; entity_type: string; mention_count: number; description: string | null; agent_name?: string; val: number }[];
  links: { source: string; target: string; relation: string; weight: number; id: string }[];
}

export default function GraphTab() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [stats, setStats] = useState<{ total_nodes: number; total_edges: number; top_entities: { entity_type: string; count: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphData['nodes'][0] | null>(null);
  const [, setNeighbors] = useState<KnowledgeNode[]>([]);
  const [neighborEdges, setNeighborEdges] = useState<KnowledgeEdge[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [entityTypes, setEntityTypes] = useState<{ entity_type: string; count: number }[]>([]);
  const [agents, setAgents] = useState<{ agent_id: string; agent_name: string; node_count: number }[]>([]);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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
      const [graphRes, statsRes, typesRes, agentsRes] = await Promise.all([
        hubApi.knowledgeGraph.graph({ limit: 1000, type: typeFilter || undefined, agent_id: agentFilter || undefined }),
        hubApi.knowledgeGraph.stats(),
        hubApi.knowledgeGraph.entityTypes(),
        hubApi.knowledgeGraph.agents(),
      ]);

      const nodes = (graphRes.nodes || []).map((n: KnowledgeNode) => ({
        id: n.id,
        label: n.label,
        entity_type: n.entity_type,
        mention_count: n.mention_count,
        description: n.description,
        agent_name: n.agent_name,
        val: Math.max(2, Math.min(12, n.mention_count * 2)),
      }));

      const nodeIds = new Set(nodes.map((n: { id: string }) => n.id));
      const links = (graphRes.edges || [])
        .filter((e: KnowledgeEdge) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
        .map((e: KnowledgeEdge) => ({
          source: e.source_id,
          target: e.target_id,
          relation: e.relation,
          weight: e.weight,
          id: e.id,
        }));

      setGraphData({ nodes, links });
      setStats(statsRes);
      setEntityTypes(typesRes.types || []);
      setAgents(agentsRes.agents || []);
    } catch (err) {
      console.error('Failed to load knowledge graph:', err);
    }
    setLoading(false);
  }, [typeFilter, agentFilter]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setHighlightNodes(new Set());
      return;
    }
    const q = searchQuery.toLowerCase();
    const matched = new Set(
      graphData.nodes
        .filter(n => n.label.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q))
        .map(n => n.id)
    );
    setHighlightNodes(matched);
  }, [searchQuery, graphData.nodes]);

  // Node click handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback(async (node: any) => {
    setSelectedNode(node);
    try {
      const res = await hubApi.knowledgeGraph.neighborhood(node.id);
      setNeighbors(res.neighbors || []);
      setNeighborEdges(res.edges || []);
    } catch {
      setNeighbors([]);
      setNeighborEdges([]);
    }
  }, []);

  // Node painting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const size = node.val || 4;
    const color = TYPE_COLORS[node.entity_type] || '#6b7280';
    const isHighlighted = highlightNodes.size > 0 && highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isDimmed = highlightNodes.size > 0 && !highlightNodes.has(node.id);

    const x = node.x as number;
    const y = node.y as number;

    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = isDimmed ? `${color}40` : color;
    ctx.fill();

    if (isSelected || isHighlighted) {
      ctx.strokeStyle = isSelected ? '#ffffff' : '#fbbf24';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.stroke();
    }

    // Label
    const label = node.label;
    const fontSize = Math.max(3, size * 0.8);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
    ctx.fillText(label, x, y + size + 2);
  }, [highlightNodes, selectedNode]);

  // Link painting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const color = RELATION_COLORS[link.relation] || '#4b5563';
    const sx = link.source.x as number; const sy = link.source.y as number;
    const tx = link.target.x as number; const ty = link.target.y as number;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = highlightNodes.size > 0 ? `${color}30` : `${color}60`;
    ctx.lineWidth = Math.max(0.5, link.weight * 1.5);
    ctx.stroke();
  }, [highlightNodes]);

  const isEmpty = !loading && graphData.nodes.length === 0;

  // Memoize the force graph to prevent re-renders
  const forceGraph = useMemo(() => {
    if (isEmpty || loading) return null;
    return (
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={paintNode}
        linkCanvasObject={paintLink}
        onNodeClick={handleNodeClick}
        nodeLabel=""
        cooldownTicks={100}
        warmupTicks={50}
        backgroundColor="#0a0a0f"
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.8}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
      />
    );
  }, [graphData, dimensions, paintNode, paintLink, handleNodeClick, isEmpty, loading]);

  return (
    <div className="graph-tab">
      {/* Controls overlay */}
      <div className="graph-controls">
        <div className="graph-controls-row">
          <div className="graph-search-wrap">
            <input
              type="text"
              className="graph-search"
              placeholder="Search nodes..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearchQuery(searchInput)}
            />
            {searchInput && (
              <button className="graph-search-clear" onClick={() => { setSearchInput(''); setSearchQuery(''); }}>
                x
              </button>
            )}
          </div>
          <select className="graph-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {entityTypes.map(t => (
              <option key={t.entity_type} value={t.entity_type}>{t.entity_type} ({t.count})</option>
            ))}
          </select>
          <select className="graph-filter" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a.agent_id} value={a.agent_id}>{a.agent_name} ({a.node_count})</option>
            ))}
          </select>
          <button className="graph-btn" onClick={loadGraph} title="Refresh">Reload</button>
        </div>
        {stats && (
          <div className="graph-stats-row">
            <span className="graph-stat">{stats.total_nodes} nodes</span>
            <span className="graph-stat">{stats.total_edges} edges</span>
            {highlightNodes.size > 0 && <span className="graph-stat highlight">{highlightNodes.size} matched</span>}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <button
            key={type}
            className={`graph-legend-item ${typeFilter === type ? 'active' : ''}`}
            onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
          >
            <span className="graph-legend-dot" style={{ background: color }} />
            {type}
          </button>
        ))}
      </div>

      {/* Graph canvas */}
      <div className="graph-canvas" ref={containerRef}>
        {loading && <div className="graph-loading">Loading knowledge graph...</div>}
        {isEmpty && (
          <div className="graph-empty">
            <div className="graph-empty-icon">Nodes</div>
            <div className="graph-empty-title">Knowledge graph is empty</div>
            <div className="graph-empty-msg">Run agents to populate the knowledge graph with entities and relationships</div>
          </div>
        )}
        {forceGraph}
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
            {selectedNode.agent_name && <span>Agent: {selectedNode.agent_name}</span>}
          </div>
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
