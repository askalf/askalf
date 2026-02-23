import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface KnowledgeNode {
  id: string;
  label: string;
  entity_type: string;
  description: string | null;
  mention_count: number;
  similarity?: number;
}

interface KnowledgeEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  topEntities: Array<{ label: string; mention_count: number; entity_type: string }>;
  topRelations: Array<{ relation: string; count: number }>;
}

export default function KnowledgeGraph() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeNode[]>([]);
  const [neighborhood, setNeighborhood] = useState<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    hubApi.knowledge.stats().then((d) => setStats(d as unknown as GraphStats)).catch(() => {});
  }, []);

  const pollStats = useCallback(async () => {
    try { const d = await hubApi.knowledge.stats(); setStats(d as unknown as GraphStats); } catch { /* ignore */ }
  }, []);
  usePolling(pollStats, 30000);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await hubApi.knowledge.search(searchQuery) as KnowledgeNode[];
      setSearchResults(results);
      setNeighborhood(null);
      setSelectedNode(null);
    } catch { setSearchResults([]); }
  };

  const handleNodeClick = async (nodeId: string) => {
    setSelectedNode(nodeId);
    try {
      const data = await hubApi.knowledge.neighborhood(nodeId) as { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };
      setNeighborhood(data);
    } catch { setNeighborhood(null); }
  };

  const typeColors: Record<string, string> = {
    concept: '#6366f1', person: '#ec4899', tool: '#f97316',
    service: '#06b6d4', file: '#8b5cf6', error: '#ef4444', pattern: '#4ade80',
  };

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={stats?.totalNodes ?? '-'} label="Nodes" />
        <StatCard value={stats?.totalEdges ?? '-'} label="Edges" />
        <StatCard value={stats?.topEntities?.length ?? 0} label="Entity Types" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left: Search + Results */}
        <div className="fo-section">
          <div className="fo-section-header"><h3>Knowledge Search</h3></div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search entities..." style={{ flex: 1, fontSize: '13px' }}
            />
            <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={handleSearch}>Search</button>
          </div>

          {searchResults.map((node) => (
            <div key={node.id} className="fo-card" onClick={() => handleNodeClick(node.id)}
              style={{ marginBottom: '6px', cursor: 'pointer', padding: '8px', border: selectedNode === node.id ? '1px solid #6366f1' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: typeColors[node.entity_type] || '#6b7280' }} />
                <strong style={{ fontSize: '13px' }}>{node.label}</strong>
                <span style={{ fontSize: '11px', opacity: 0.5 }}>{node.entity_type}</span>
                {node.similarity != null && <span style={{ fontSize: '11px', opacity: 0.4 }}>{(node.similarity * 100).toFixed(0)}%</span>}
              </div>
              {node.description && <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>{node.description}</div>}
              <div style={{ fontSize: '11px', opacity: 0.4 }}>{node.mention_count} mentions</div>
            </div>
          ))}

          {/* Top Entities */}
          {!searchResults.length && stats && stats.topEntities?.length > 0 && (
            <>
              <h4 style={{ fontSize: '13px', marginTop: '16px', marginBottom: '8px' }}>Top Entities</h4>
              {stats.topEntities.map((e, i) => (
                <div key={i} style={{ fontSize: '12px', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                  <span><span style={{ color: typeColors[e.entity_type] || '#6b7280' }}>{e.entity_type}</span> {e.label}</span>
                  <span style={{ opacity: 0.5 }}>{e.mention_count}x</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Right: Neighborhood view */}
        <div className="fo-section">
          <div className="fo-section-header"><h3>Neighborhood</h3></div>
          {!neighborhood && <div className="fo-empty">Click a node to see its connections</div>}
          {neighborhood && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <h4 style={{ fontSize: '13px', marginBottom: '6px' }}>Nodes ({neighborhood.nodes.length})</h4>
                {neighborhood.nodes.map((n) => (
                  <span key={n.id} onClick={() => handleNodeClick(n.id)}
                    style={{ display: 'inline-block', padding: '3px 8px', margin: '2px', borderRadius: '12px', fontSize: '11px', cursor: 'pointer',
                      background: n.id === selectedNode ? '#6366f1' : 'rgba(255,255,255,0.06)', color: n.id === selectedNode ? '#fff' : undefined }}>
                    {n.label}
                  </span>
                ))}
              </div>
              <h4 style={{ fontSize: '13px', marginBottom: '6px' }}>Relationships ({neighborhood.edges.length})</h4>
              {neighborhood.edges.map((e) => {
                const src = neighborhood.nodes.find((n) => n.id === e.source_id);
                const tgt = neighborhood.nodes.find((n) => n.id === e.target_id);
                return (
                  <div key={e.id} style={{ fontSize: '12px', padding: '4px 0', opacity: 0.8 }}>
                    <strong>{src?.label ?? '?'}</strong>
                    <span style={{ margin: '0 6px', opacity: 0.5 }}>&rarr; {e.relation} &rarr;</span>
                    <strong>{tgt?.label ?? '?'}</strong>
                    <span style={{ marginLeft: '8px', fontSize: '10px', opacity: 0.4 }}>weight: {e.weight.toFixed(1)}</span>
                  </div>
                );
              })}
            </>
          )}

          {/* Top Relations */}
          {!neighborhood && stats && stats.topRelations?.length > 0 && (
            <>
              <h4 style={{ fontSize: '13px', marginTop: '16px', marginBottom: '8px' }}>Top Relations</h4>
              {stats.topRelations.map((r, i) => (
                <div key={i} style={{ fontSize: '12px', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.relation}</span>
                  <span style={{ opacity: 0.5 }}>{r.count}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
