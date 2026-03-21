/**
 * HomeTab — Unified home: mission control + Alf chat in one view.
 * Left: compact orbital fleet with key stats.
 * Right: conversational chat with Alf.
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { formatCost, relativeTime } from '../../utils/format';
import { apiFetchSafe } from '../../utils/api';
import type { ForgeEvent } from '../../constants/status';
import './HomeTab.css';

const ChatTab = lazy(() => import('./ChatTab'));

interface AgentInfo { id: string; name: string; status: string }
interface ExecutionEntry { id: string; agent_name?: string; status: string; cost?: number; started_at: string }
interface MetricsData { agents?: { total?: number; running?: number }; tickets?: { open?: number } }

export default function HomeTab({ onNavigate }: { wsEvents?: ForgeEvent[]; onNavigate?: (tab: string) => void }) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [allAgents, setAllAgents] = useState<AgentInfo[]>([]);
  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [todayCost, setTodayCost] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async () => {
    const [m, ag, ex, c] = await Promise.all([
      apiFetchSafe<MetricsData>('/api/v1/admin/reports/metrics'),
      apiFetchSafe<{ agents: AgentInfo[] }>('/api/v1/admin/agents'),
      apiFetchSafe<{ executions: ExecutionEntry[] }>('/api/v1/admin/executions/timeline?hours=24'),
      apiFetchSafe<{ summary: { total: { totalCost: number } } }>('/api/v1/admin/costs?days=1'),
    ]);
    if (m) setMetrics(m);
    if (ag?.agents) setAllAgents(ag.agents.filter(a => a.status !== 'archived' && a.status !== 'decommissioned'));
    if (ex) setExecutions(Array.isArray(ex.executions) ? ex.executions.slice(0, 15) : []);
    if (c) setTodayCost(c.summary?.total?.totalCost ?? 0);
  }, []);

  usePolling(fetchAll, 30000);

  const activeAgents = metrics?.agents?.running ?? 0;
  const totalAgents = metrics?.agents?.total ?? 0;
  const openTickets = metrics?.tickets?.open ?? 0;
  const running = executions.filter(e => e.status === 'running');
  const completed = executions.filter(e => e.status === 'completed').length;

  // Mini orbital animation
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;

    // Color palette for agents
    const PALETTE: [number, number, number][] = [
      [96, 165, 250], [167, 139, 250], [52, 211, 153], [251, 146, 60],
      [248, 113, 113], [232, 121, 249], [45, 212, 191], [59, 130, 246],
    ];

    function agentColor(name: string): [number, number, number] {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
      return PALETTE[Math.abs(hash) % PALETTE.length]!;
    }

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = rect.width; const h = rect.height;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2; const cy = h / 2;
      const maxR = Math.min(w, h) * 0.4;

      // Orbital rings
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * (ring / 3), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(124, 58, 237, ${0.04 + ring * 0.02})`;
        ctx.lineWidth = 0.6; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
      }

      // Core
      const pulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      const coreR = 22 + pulse * 4;
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      coreGlow.addColorStop(0, `rgba(124, 58, 237, ${0.12 * pulse})`);
      coreGlow.addColorStop(1, 'rgba(124, 58, 237, 0)');
      ctx.beginPath(); ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
      ctx.fillStyle = coreGlow; ctx.fill();

      const coreGrad = ctx.createRadialGradient(cx - 3, cy - 3, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, 'rgba(167, 139, 250, 0.95)');
      coreGrad.addColorStop(1, 'rgba(124, 58, 237, 0.65)');
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad; ctx.fill();

      ctx.font = `700 ${coreR * 0.7}px Satoshi, system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(String(activeAgents), cx, cy - 2);
      ctx.font = `500 ${coreR * 0.3}px Satoshi, system-ui`;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`of ${totalAgents}`, cx, cy + coreR * 0.45);

      // Agent nodes
      allAgents.forEach((agent, i) => {
        const orbitR = maxR * 0.4 + (i % 3) * (maxR * 0.22);
        const speed = 0.0002 + (i * 0.618 % 1) * 0.0003;
        const angle = time * speed + (i * Math.PI * 2) / Math.max(allAgents.length, 1);
        const ax = cx + Math.cos(angle) * orbitR;
        const ay = cy + Math.sin(angle) * orbitR;
        const col = agentColor(agent.name);
        const isRunning = running.some(e => e.agent_name === agent.name);
        const nodeR = isRunning ? 10 : 7;

        // Glow
        const glow = ctx.createRadialGradient(ax, ay, 0, ax, ay, nodeR * 3);
        glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${isRunning ? 0.2 : 0.08})`);
        glow.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.beginPath(); ctx.arc(ax, ay, nodeR * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();

        // Node
        ctx.beginPath(); ctx.arc(ax, ay, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.85)`;
        ctx.fill();

        // Spin ring for running
        if (isRunning) {
          ctx.beginPath();
          const spin = time * 0.003;
          ctx.arc(ax, ay, nodeR + 2, spin, spin + Math.PI * 1.2);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.6)`;
          ctx.lineWidth = 1.5; ctx.stroke();
        }

        // Label
        ctx.font = '600 10px Satoshi, system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.75)`;
        ctx.fillText(agent.name, ax, ay + nodeR + 4);
      });

      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [allAgents, activeAgents, totalAgents, running]);

  return (
    <div className="home-tab">
      {/* Left: Mission Control */}
      <div className="home-mission">
        <div className="home-orbital" ref={containerRef}>
          <canvas ref={canvasRef} className="home-orbital-canvas" />
        </div>
        <div className="home-stats">
          <button className="home-stat" onClick={() => onNavigate?.('fleet')} type="button">
            <span className="home-stat-val green">{activeAgents}/{totalAgents}</span>
            <span className="home-stat-label">ACTIVE</span>
          </button>
          <button className="home-stat" onClick={() => onNavigate?.('ops')} type="button">
            <span className="home-stat-val violet">{completed}</span>
            <span className="home-stat-label">DONE 24H</span>
          </button>
          <button className="home-stat" onClick={() => onNavigate?.('ops')} type="button">
            <span className={`home-stat-val ${openTickets > 0 ? 'amber' : ''}`}>{openTickets}</span>
            <span className="home-stat-label">TICKETS</span>
          </button>
          <button className="home-stat" onClick={() => onNavigate?.('ops')} type="button">
            <span className="home-stat-val rose">{formatCost(todayCost)}</span>
            <span className="home-stat-label">COST</span>
          </button>
        </div>
        {running.length > 0 && (
          <div className="home-running">
            <div className="home-running-label">WORKING NOW</div>
            {running.slice(0, 4).map(e => (
              <div key={e.id} className="home-running-item">
                <span className="home-running-dot" />
                <span className="home-running-name">{e.agent_name || 'Worker'}</span>
                <span className="home-running-time">{relativeTime(e.started_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Alf Chat */}
      <div className="home-chat">
        <Suspense fallback={<div className="ud-loading">Loading...</div>}>
          <ChatTab onNavigate={onNavigate} />
        </Suspense>
      </div>
    </div>
  );
}
