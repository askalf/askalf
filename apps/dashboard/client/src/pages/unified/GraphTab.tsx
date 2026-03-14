import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { KnowledgeNode, KnowledgeEdge } from '../../hooks/useHubApi';
import { relativeTime } from '../../utils/format';
import './GraphTab.css';

// ── Bioluminescent color palette ──
const TYPE_COLORS: Record<string, [number, number, number]> = {
  concept:   [96, 165, 250],   // cool blue
  person:    [244, 114, 182],  // rose
  tool:      [167, 139, 250],  // lavender
  service:   [52, 211, 153],   // emerald
  file:      [251, 191, 36],   // amber
  error:     [248, 113, 113],  // coral
  pattern:   [129, 140, 248],  // indigo
  ticket:    [251, 146, 60],   // orange
  metric:    [45, 212, 191],   // teal
  component: [192, 132, 252],  // violet
  system:    [148, 163, 184],  // slate
};

const RELATION_COLORS: Record<string, string> = {
  uses: '#60a5fa', depends_on: '#f59e0b', causes: '#ef4444', fixes: '#22c55e',
  relates_to: '#a78bfa', contains: '#6366f1', produces: '#14b8a6',
};

function rgb(c: [number, number, number]): string { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rgba(c: [number, number, number], a: number): string { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

interface GNode {
  id: string; label: string; entity_type: string; mention_count: number;
  description: string | null; agent_name?: string; last_mentioned?: string;
  x: number; y: number; vx: number; vy: number; size: number;
  phase: number; // unique animation phase offset
}

interface GLink {
  source: string; target: string; relation: string; weight: number; id: string;
  pulseOffset: number; // unique pulse phase per link
}

interface TopNode { label: string; entity_type: string; mention_count: number; id: string; }

// ── Synaptic pulse particles traveling along edges ──
interface SynapticPulse {
  linkIdx: number;
  progress: number; // 0..1 along the edge
  speed: number;
  color: [number, number, number];
  size: number;
}

// ── Ambient floating particles ──
interface AmbientParticle {
  x: number; y: number; vx: number; vy: number;
  size: number; alpha: number; decay: number;
  color: [number, number, number];
}

// ── Force simulation ──
function runForceSimulation(nodes: GNode[], links: GLink[], width: number, height: number, iterations: number) {
  for (const n of nodes) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * Math.min(width, height) * 0.35;
    n.x = width / 2 + Math.cos(angle) * r;
    n.y = height / 2 + Math.sin(angle) * r;
    n.vx = 0; n.vy = 0;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = (1 - iter / iterations);
    if (alpha < 0.001) break;
    const repK = 900;

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
              const ddx = n.x - m.x; const ddy = n.y - m.y;
              const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              if (dist > cellSize * 3) continue;
              const force = repK / (dist * dist) * alpha;
              n.vx += (ddx / dist) * force; n.vy += (ddy / dist) * force;
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

    const linkK = 0.25; const idealLen = 65;
    for (const link of links) {
      const s = nodeMap.get(link.source); const t = nodeMap.get(link.target);
      if (!s || !t) continue;
      const dx = t.x - s.x; const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLen) * linkK * alpha;
      const fx = (dx / dist) * force; const fy = (dy / dist) * force;
      s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
    }

    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.008 * alpha;
      n.vy += (height / 2 - n.y) * 0.008 * alpha;
      n.vx *= 0.55; n.vy *= 0.55;
      n.x += n.vx; n.y += n.vy;
    }
  }
}

// ── Render the neural graph ──
function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number, height: number,
  nodes: GNode[], links: GLink[],
  nodeMap: Map<string, GNode>,
  transform: { x: number; y: number; k: number },
  time: number,
  highlightNodes: Set<string>,
  selectedNode: GNode | null,
  pulses: SynapticPulse[],
  particles: AmbientParticle[],
  mouseWorld: { x: number; y: number } | null,
  ripple: { x: number; y: number; t: number } | null,
) {
  // Background: deep void with subtle radial nebula
  const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.7);
  bgGrad.addColorStop(0, '#0d0d1a');
  bgGrad.addColorStop(0.5, '#080812');
  bgGrad.addColorStop(1, '#04040a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle nebula bloom at center
  const nebulaPhase = Math.sin(time * 0.0003) * 0.5 + 0.5;
  const nebula = ctx.createRadialGradient(width * 0.45, height * 0.4, 0, width * 0.45, height * 0.4, width * 0.35);
  nebula.addColorStop(0, `rgba(124, 58, 237, ${0.015 + nebulaPhase * 0.01})`);
  nebula.addColorStop(0.5, `rgba(45, 212, 191, ${0.008 + nebulaPhase * 0.005})`);
  nebula.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, width, height);

  // Draw ambient particles (behind everything)
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = rgba(p.color, p.alpha * 0.4);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const hasDim = highlightNodes.size > 0;

  // Draw edges with glow
  for (const link of links) {
    const s = nodeMap.get(link.source);
    const t = nodeMap.get(link.target);
    if (!s || !t) continue;

    const relColor = RELATION_COLORS[link.relation] || '#4b5563';
    const baseAlpha = hasDim ? 0.08 : 0.18;

    // Curved bezier edge (slight arc)
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const dx = t.x - s.x; const dy = t.y - s.y;
    const perpX = -dy * 0.08; const perpY = dx * 0.08;
    const cpx = mx + perpX; const cpy = my + perpY;

    // Edge glow layer
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(cpx, cpy, t.x, t.y);
    ctx.strokeStyle = relColor;
    ctx.globalAlpha = baseAlpha * 0.5;
    ctx.lineWidth = Math.max(1.5, link.weight * 2.5);
    ctx.stroke();

    // Edge core
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(cpx, cpy, t.x, t.y);
    ctx.globalAlpha = baseAlpha;
    ctx.lineWidth = Math.max(0.4, link.weight * 0.8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw synaptic pulses traveling along edges
  for (const pulse of pulses) {
    const link = links[pulse.linkIdx];
    if (!link) continue;
    const s = nodeMap.get(link.source);
    const t = nodeMap.get(link.target);
    if (!s || !t) continue;

    const p = pulse.progress;
    // Quadratic bezier interpolation
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const dx = t.x - s.x; const dy = t.y - s.y;
    const cpx = mx + (-dy * 0.08); const cpy = my + (dx * 0.08);
    const ip = 1 - p;
    const px = ip * ip * s.x + 2 * ip * p * cpx + p * p * t.x;
    const py = ip * ip * s.y + 2 * ip * p * cpy + p * p * t.y;

    // Pulse glow
    const grad = ctx.createRadialGradient(px, py, 0, px, py, pulse.size * 4);
    grad.addColorStop(0, rgba(pulse.color, 0.6));
    grad.addColorStop(0.5, rgba(pulse.color, 0.15));
    grad.addColorStop(1, rgba(pulse.color, 0));
    ctx.beginPath();
    ctx.arc(px, py, pulse.size * 4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Pulse core
    ctx.beginPath();
    ctx.arc(px, py, pulse.size, 0, Math.PI * 2);
    ctx.fillStyle = rgba(pulse.color, 0.9);
    ctx.fill();
  }

  // Draw ripple effect from selection
  if (ripple) {
    const age = (time - ripple.t) / 1000;
    if (age < 1.5) {
      const r = age * 120;
      const alpha = Math.max(0, 1 - age / 1.5);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(167, 139, 250, ${alpha * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, r * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(167, 139, 250, ${alpha * 0.2})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const col = TYPE_COLORS[node.entity_type] || [107, 114, 128];
    const isHighlighted = hasDim && highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isDimmed = hasDim && !highlightNodes.has(node.id);

    // Breathing animation — each node breathes at its own frequency
    const breathe = Math.sin(time * 0.002 + node.phase * Math.PI * 2) * 0.5 + 0.5;
    const dynamicSize = node.size * (0.9 + breathe * 0.2);

    // Mouse proximity glow
    let proximityGlow = 0;
    if (mouseWorld) {
      const dist = Math.sqrt((node.x - mouseWorld.x) ** 2 + (node.y - mouseWorld.y) ** 2);
      proximityGlow = Math.max(0, 1 - dist / 80);
    }

    const totalGlow = Math.min(1, (isDimmed ? 0 : 0.3) + proximityGlow * 0.5 + (isHighlighted ? 0.4 : 0) + (isSelected ? 0.6 : 0));

    // Outer aura (large, soft)
    if (!isDimmed && (node.mention_count > 2 || proximityGlow > 0 || isSelected)) {
      const auraR = dynamicSize * (2.5 + breathe * 1.5 + proximityGlow * 2);
      const aura = ctx.createRadialGradient(node.x, node.y, dynamicSize * 0.3, node.x, node.y, auraR);
      aura.addColorStop(0, rgba(col, 0.12 + totalGlow * 0.15));
      aura.addColorStop(0.6, rgba(col, 0.03 + totalGlow * 0.04));
      aura.addColorStop(1, rgba(col, 0));
      ctx.beginPath();
      ctx.arc(node.x, node.y, auraR, 0, Math.PI * 2);
      ctx.fillStyle = aura;
      ctx.fill();
    }

    // Inner corona
    if (!isDimmed) {
      const coronaR = dynamicSize * 1.6;
      const corona = ctx.createRadialGradient(node.x, node.y, dynamicSize * 0.5, node.x, node.y, coronaR);
      corona.addColorStop(0, rgba(col, 0.25 + breathe * 0.1));
      corona.addColorStop(1, rgba(col, 0));
      ctx.beginPath();
      ctx.arc(node.x, node.y, coronaR, 0, Math.PI * 2);
      ctx.fillStyle = corona;
      ctx.fill();
    }

    // Node core
    ctx.beginPath();
    ctx.arc(node.x, node.y, dynamicSize, 0, Math.PI * 2);
    if (isDimmed) {
      ctx.fillStyle = rgba(col, 0.15);
    } else {
      const coreGrad = ctx.createRadialGradient(
        node.x - dynamicSize * 0.3, node.y - dynamicSize * 0.3, 0,
        node.x, node.y, dynamicSize
      );
      coreGrad.addColorStop(0, rgba([Math.min(255, col[0] + 60), Math.min(255, col[1] + 60), Math.min(255, col[2] + 60)], 0.95));
      coreGrad.addColorStop(0.7, rgba(col, 0.9));
      coreGrad.addColorStop(1, rgba(col, 0.7));
      ctx.fillStyle = coreGrad;
    }
    ctx.fill();

    // Selection / highlight ring
    if (isSelected) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Double ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, dynamicSize + 4, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(col, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (isHighlighted) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label — only show when zoomed in enough or node is important
    if (transform.k > 0.4 || node.mention_count > 5 || isSelected || isHighlighted) {
      const fontSize = Math.round(Math.max(8, Math.min(13, dynamicSize * 1.1)) / Math.max(0.5, transform.k * 0.7));
      ctx.font = `600 ${fontSize}px Satoshi, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.08)' : `rgba(255,255,255,${0.6 + totalGlow * 0.35})`;
      ctx.fillText(node.label, Math.round(node.x), Math.round(node.y + dynamicSize + 4));
    }
  }

  ctx.restore();
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

  // Animation state (refs to avoid re-renders)
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const [, _forceRender] = useState(0);
  const dragRef = useRef<{ dragging: boolean; moved: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0,
  });
  const pulsesRef = useRef<SynapticPulse[]>([]);
  const particlesRef = useRef<AmbientParticle[]>([]);
  const rippleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const mouseWorldRef = useRef<{ x: number; y: number } | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const nodeMapRef = useRef(new Map<string, GNode>());
  const highlightRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef<GNode | null>(null);
  const animRef = useRef(0);

  // Sync state to refs for animation loop
  useEffect(() => { nodesRef.current = nodes; nodeMapRef.current = new Map(nodes.map(n => [n.id, n])); }, [nodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { highlightRef.current = highlightNodes; }, [highlightNodes]);
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  // Resize
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Initialize ambient particles
  useEffect(() => {
    const ps: AmbientParticle[] = [];
    for (let i = 0; i < 60; i++) {
      const cols = Object.values(TYPE_COLORS);
      ps.push({
        x: Math.random() * dimensions.width,
        y: Math.random() * dimensions.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.3 + 0.1,
        decay: 0,
        color: cols[Math.floor(Math.random() * cols.length)]!,
      });
    }
    particlesRef.current = ps;
  }, [dimensions.width, dimensions.height]);

  // Load graph
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

      const gNodes: GNode[] = (graphRes.nodes || []).map((n: KnowledgeNode, i: number) => ({
        id: n.id, label: n.label, entity_type: n.entity_type,
        mention_count: n.mention_count, description: n.description,
        agent_name: n.agent_name, last_mentioned: n.last_mentioned,
        x: 0, y: 0, vx: 0, vy: 0,
        size: Math.max(3, Math.min(16, Math.sqrt(n.mention_count) * 3 + 2)),
        phase: (i * 0.618) % 1, // golden ratio offset for natural-looking animation
      }));

      const nodeIds = new Set(gNodes.map(n => n.id));
      const gLinks: GLink[] = (graphRes.edges || [])
        .filter((e: KnowledgeEdge) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
        .map((e: KnowledgeEdge, i: number) => ({
          source: e.source_id, target: e.target_id,
          relation: e.relation, weight: e.weight, id: e.id,
          pulseOffset: (i * 0.381) % 1,
        }));

      runForceSimulation(gNodes, gLinks, dimensions.width || 800, dimensions.height || 600, Math.min(250, 60 + gNodes.length / 4));

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
    rippleRef.current = { x: node.x, y: node.y, t: performance.now() };
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

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastPulseSpawn = 0;

    const tick = (time: number) => {
      const ns = nodesRef.current;
      const ls = linksRef.current;
      const w = dimensions.width;
      const h = dimensions.height;

      // Set canvas size
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Spawn synaptic pulses periodically
      if (ls.length > 0 && time - lastPulseSpawn > 80) {
        lastPulseSpawn = time;
        // Spawn 1-3 pulses on random edges
        const count = Math.min(3, Math.max(1, Math.floor(ls.length / 100)));
        for (let i = 0; i < count; i++) {
          const linkIdx = Math.floor(Math.random() * ls.length);
          const link = ls[linkIdx]!;
          const sNode = nodeMapRef.current.get(link.source);
          const col: [number, number, number] = sNode ? (TYPE_COLORS[sNode.entity_type] || [148, 163, 184]) : [148, 163, 184];
          pulsesRef.current.push({
            linkIdx,
            progress: 0,
            speed: 0.008 + Math.random() * 0.012,
            color: col,
            size: 1.5 + Math.random() * 1.5,
          });
        }
      }

      // Update pulses
      pulsesRef.current = pulsesRef.current.filter(p => {
        p.progress += p.speed;
        return p.progress < 1;
      });

      // Update ambient particles
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        // Wrap around
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        // Gentle drift variation
        p.vx += (Math.random() - 0.5) * 0.02;
        p.vy += (Math.random() - 0.5) * 0.02;
        p.vx *= 0.99;
        p.vy *= 0.99;
      }

      // Render
      if (ns.length > 0) {
        renderFrame(
          ctx, w, h, ns, ls, nodeMapRef.current,
          transformRef.current, time,
          highlightRef.current, selectedRef.current,
          pulsesRef.current, particlesRef.current,
          mouseWorldRef.current, rippleRef.current,
        );
      } else {
        // Just draw background + particles
        ctx.fillStyle = '#08080f';
        ctx.fillRect(0, 0, w, h);
        for (const p of particlesRef.current) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = rgba(p.color, p.alpha * 0.3);
          ctx.fill();
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [dimensions]);

  // Pan & zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    const t = transformRef.current;
    const newK = Math.max(0.1, Math.min(5, t.k * scale));
    const rect = containerRef.current?.getBoundingClientRect();
    const mx = e.clientX - (rect?.left || 0);
    const my = e.clientY - (rect?.top || 0);
    transformRef.current = {
      x: mx - (mx - t.x) * (newK / t.k),
      y: my - (my - t.y) * (newK / t.k),
      k: newK,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const t = transformRef.current;
    dragRef.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Update mouse world position for proximity glow
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const t = transformRef.current;
      mouseWorldRef.current = {
        x: (e.clientX - rect.left - t.x) / t.k,
        y: (e.clientY - rect.top - t.y) / t.k,
      };
    }

    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    transformRef.current = {
      ...transformRef.current,
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    };
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current.dragging = false; }, []);
  const handleMouseLeave = useCallback(() => {
    dragRef.current.dragging = false;
    mouseWorldRef.current = null;
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = transformRef.current;
    const mx = (e.clientX - rect.left - t.x) / t.k;
    const my = (e.clientY - rect.top - t.y) / t.k;
    let closest: GNode | null = null;
    let closestDist = Infinity;
    for (const n of nodesRef.current) {
      const dist = Math.sqrt((n.x - mx) ** 2 + (n.y - my) ** 2);
      if (dist < n.size + 8 && dist < closestDist) { closest = n; closestDist = dist; }
    }
    if (closest) handleNodeClick(closest);
    else setSelectedNode(null);
  }, [handleNodeClick]);

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
        {Object.entries(TYPE_COLORS).map(([type, col]) => (
          <button key={type} className={`graph-legend-item ${typeFilter === type ? 'active' : ''}`}
            onClick={() => setTypeFilter(typeFilter === type ? '' : type)}>
            <span className="graph-legend-dot" style={{ background: rgb(col), boxShadow: `0 0 6px ${rgba(col, 0.5)}` }} />{type}
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
              <span className="graph-legend-dot" style={{ background: rgb(TYPE_COLORS[n.entity_type] || [107, 114, 128]) }} />
              <span className="graph-top-label">{n.label}</span>
              <span className="graph-top-count">{n.mention_count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div className="graph-canvas" ref={containerRef}>
        {loading && (
          <div className="graph-loading">
            <div className="graph-loading-orb" />
            <div>Mapping neural pathways...</div>
          </div>
        )}
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
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} onClick={handleCanvasClick} />
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <div className="graph-detail">
          <div className="graph-detail-header">
            <span className="graph-detail-type" style={{
              color: rgb(TYPE_COLORS[selectedNode.entity_type] || [107, 114, 128]),
              textShadow: `0 0 8px ${rgba(TYPE_COLORS[selectedNode.entity_type] || [107, 114, 128], 0.5)}`,
            }}>
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
