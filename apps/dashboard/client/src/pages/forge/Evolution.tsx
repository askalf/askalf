import { useState, useEffect, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface Experiment {
  id: string;
  parent_agent_id: string;
  variant_agent_id: string;
  mutation_type: string;
  mutation_description: string;
  test_task: string;
  parent_score: number | null;
  variant_score: number | null;
  winner: string | null;
  status: string;
  results: Record<string, unknown>;
}

export default function Evolution() {
  const agents = useHubStore((s) => s.agents);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);

  // Clone form
  const [showClone, setShowClone] = useState(false);
  const [mutationType, setMutationType] = useState('prompt');
  const [mutationDesc, setMutationDesc] = useState('');
  const [promptOverride, setPromptOverride] = useState('');
  const [cloning, setCloning] = useState(false);

  // Experiment form
  const [showExperiment, setShowExperiment] = useState(false);
  const [variantId, setVariantId] = useState('');
  const [testTask, setTestTask] = useState('');
  const [experimenting, setExperimenting] = useState(false);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const loadExperiments = useCallback(async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      const data = await hubApi.evolution.experiments(selectedAgent) as Experiment[];
      setExperiments(Array.isArray(data) ? data : []);
    } catch { setExperiments([]); }
    setLoading(false);
  }, [selectedAgent]);

  useEffect(() => { loadExperiments(); }, [loadExperiments]);
  usePolling(loadExperiments, 30000);

  const handleClone = async () => {
    if (!selectedAgent || !mutationDesc) return;
    setCloning(true);
    try {
      const result = await hubApi.evolution.clone(selectedAgent, {
        type: mutationType, description: mutationDesc,
        promptOverride: promptOverride || undefined,
      });
      setVariantId(result.variantId);
      setShowClone(false);
      setMutationDesc('');
      setPromptOverride('');
      await fetchAgents();
    } catch (err) { console.error(err); }
    setCloning(false);
  };

  const handleExperiment = async () => {
    if (!selectedAgent || !variantId || !testTask) return;
    setExperimenting(true);
    try {
      await hubApi.evolution.experiment({
        parentId: selectedAgent, variantId, testTask,
        mutationDescription: mutationDesc || 'A/B test',
      });
      setShowExperiment(false);
      setTestTask('');
      await loadExperiments();
    } catch (err) { console.error(err); }
    setExperimenting(false);
  };

  const handlePromote = async (experimentId: string) => {
    try {
      await hubApi.evolution.promote(experimentId);
      await loadExperiments();
    } catch (err) { console.error(err); }
  };

  const completed = experiments.filter((e) => e.status === 'completed');
  const variantWins = completed.filter((e) => e.winner === 'variant');

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={experiments.length} label="Experiments" />
        <StatCard value={completed.length} label="Completed" variant="success" />
        <StatCard value={variantWins.length} label="Variant Wins" />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Agent Evolution</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="hub-select" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
              <option value="">Select parent agent...</option>
              {agents.filter((a) => !a.is_decommissioned).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="hub-btn hub-btn--sm" onClick={() => setShowClone(!showClone)} disabled={!selectedAgent}>Clone</button>
            <button className="hub-btn hub-btn--sm" onClick={() => setShowExperiment(!showExperiment)} disabled={!selectedAgent}>A/B Test</button>
          </div>
        </div>

        {showClone && (
          <div className="fo-card" style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>Clone Agent with Mutation</h4>
            <div className="hub-form-group">
              <label style={{ fontSize: '12px' }}>Mutation Type</label>
              <select className="hub-select" value={mutationType} onChange={(e) => setMutationType(e.target.value)}>
                <option value="prompt">Prompt</option>
                <option value="model">Model</option>
                <option value="tools">Tools</option>
                <option value="config">Config</option>
                <option value="combined">Combined</option>
              </select>
            </div>
            <div className="hub-form-group">
              <label style={{ fontSize: '12px' }}>Description</label>
              <input type="text" value={mutationDesc} onChange={(e) => setMutationDesc(e.target.value)} placeholder="What's different about this variant?" />
            </div>
            {mutationType === 'prompt' && (
              <div className="hub-form-group">
                <label style={{ fontSize: '12px' }}>Prompt Override (optional)</label>
                <textarea value={promptOverride} onChange={(e) => setPromptOverride(e.target.value)} rows={3} placeholder="New system prompt..." />
              </div>
            )}
            <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={handleClone} disabled={cloning || !mutationDesc}>
              {cloning ? 'Cloning...' : 'Create Variant'}
            </button>
          </div>
        )}

        {showExperiment && (
          <div className="fo-card" style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>Run A/B Test</h4>
            <div className="hub-form-group">
              <label style={{ fontSize: '12px' }}>Variant Agent</label>
              <select className="hub-select" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">Select variant...</option>
                {agents.filter((a) => a.id !== selectedAgent).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="hub-form-group">
              <label style={{ fontSize: '12px' }}>Test Task</label>
              <textarea value={testTask} onChange={(e) => setTestTask(e.target.value)} rows={2} placeholder="Task to run on both agents..." />
            </div>
            <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={handleExperiment} disabled={experimenting || !variantId || !testTask}>
              {experimenting ? 'Starting...' : 'Run Experiment'}
            </button>
          </div>
        )}

        {loading && <div className="fo-empty">Loading experiments...</div>}

        {experiments.map((exp) => (
          <div key={exp.id} className="fo-card" style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{exp.mutation_description}</div>
                <div style={{ fontSize: '12px', opacity: 0.6 }}>Type: {exp.mutation_type} | Task: {exp.test_task.substring(0, 100)}</div>
                {exp.status === 'completed' && (
                  <div style={{ fontSize: '13px', marginTop: '6px' }}>
                    Parent: <strong>{exp.parent_score?.toFixed(1)}</strong> vs Variant: <strong>{exp.variant_score?.toFixed(1)}</strong>
                    {' '}&rarr; <span style={{ color: exp.winner === 'variant' ? '#4ade80' : exp.winner === 'parent' ? '#f97316' : '#6b7280', fontWeight: 600 }}>
                      {exp.winner === 'variant' ? 'Variant Wins' : exp.winner === 'parent' ? 'Parent Wins' : 'Tie'}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span className={`hub-badge hub-badge--${exp.status === 'completed' ? 'success' : exp.status === 'running' ? 'warning' : exp.status === 'failed' ? 'danger' : 'default'}`}>
                  {exp.status}
                </span>
                {exp.winner === 'variant' && (
                  <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={() => handlePromote(exp.id)}>Promote</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
