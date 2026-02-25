import { useState } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface OrchTask {
  title: string;
  agentName: string;
  executionId: string;
  status: string;
  output?: string;
  error?: string;
  durationMs?: number;
}

export default function NLOrchestrate() {
  const [instruction, setInstruction] = useState('');
  const [maxAgents, setMaxAgents] = useState(5);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<OrchTask[]>([]);
  const [polling, setPolling] = useState(false);

  const handleOrchestrate = async () => {
    if (!instruction.trim()) return;
    setRunning(true);
    setTasks([]);
    try {
      const result = await hubApi.nlOrchestrate.run(instruction, maxAgents) as { sessionId: string; tasks: OrchTask[] };
      setSessionId(result.sessionId);
      setTasks(Array.isArray(result.tasks) ? result.tasks : []);
      // Start polling
      pollStatus(result.sessionId);
    } catch (err) {
      console.error(err);
    }
    setRunning(false);
  };

  const pollStatus = async (sid: string) => {
    setPolling(true);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const status = await hubApi.nlOrchestrate.status(sid) as { tasks: OrchTask[]; completed: number; running: number; pending: number };
        setTasks(Array.isArray(status.tasks) ? status.tasks : []);
        if (status.running === 0 && status.pending === 0) break;
      } catch { break; }
    }
    setPolling(false);
  };

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={tasks.length} label="Tasks Dispatched" />
        <StatCard value={completed} label="Completed" variant="success" />
        <StatCard value={failed} label="Failed" variant={failed > 0 ? 'danger' : 'default'} />
      </div>

      <div className="fo-section">
        <div className="fo-section-header"><h3>Natural Language Orchestration</h3></div>
        <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '12px' }}>
          Describe what you want done in plain English. AskAlf will decompose the task, match agents, and execute automatically.
        </p>

        <div className="hub-form-group">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g., Review the security of our API endpoints, check for any outdated dependencies, and write a summary report..."
            rows={4}
            style={{ width: '100%', fontSize: '14px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
          <label style={{ fontSize: '13px' }}>Max Agents:</label>
          <input type="number" min={1} max={10} value={maxAgents} onChange={(e) => setMaxAgents(Number(e.target.value))} style={{ width: '60px' }} />
          <button className="hub-btn hub-btn--primary" onClick={handleOrchestrate} disabled={running || !instruction.trim()}>
            {running ? 'Orchestrating...' : 'Orchestrate'}
          </button>
          {polling && <span style={{ fontSize: '12px', opacity: 0.6 }}>Polling status...</span>}
        </div>

        {sessionId && <div style={{ fontSize: '12px', opacity: 0.5, marginBottom: '12px' }}>Session: {sessionId}</div>}

        {tasks.map((task, i) => (
          <div key={task.executionId || i} className="fo-card" style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{task.title}</strong>
                <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.6 }}>{task.agentName}</span>
              </div>
              <span className={`hub-badge hub-badge--${task.status === 'completed' ? 'success' : task.status === 'failed' ? 'danger' : task.status === 'running' ? 'warning' : 'default'}`}>
                {task.status}
              </span>
            </div>
            {task.output && <pre style={{ fontSize: '11px', marginTop: '8px', maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap', opacity: 0.8 }}>{task.output}</pre>}
            {task.error && <div style={{ fontSize: '11px', marginTop: '4px', color: '#f87171' }}>{task.error}</div>}
            {task.durationMs && <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px' }}>{(task.durationMs / 1000).toFixed(1)}s</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
