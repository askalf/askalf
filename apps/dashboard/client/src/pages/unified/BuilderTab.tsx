import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import './BuilderTab.css';

// ── Types ──

type BuilderStep = 'template' | 'configure' | 'tools' | 'model' | 'schedule' | 'review';

interface ProviderStatus {
  name: string;
  status: string;
  models?: string[];
}

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  provider: string;
  tools: string[];
  autonomyLevel: number;
  maxIterations: number;
  maxCostPerExecution: number;
  scheduleType: 'none' | 'interval' | 'cron';
  scheduleInterval: string;
  scheduleCron: string;
}

const STEPS: { key: BuilderStep; label: string }[] = [
  { key: 'template', label: '1. Template' },
  { key: 'configure', label: '2. Configure' },
  { key: 'tools', label: '3. Tools' },
  { key: 'model', label: '4. Model' },
  { key: 'schedule', label: '5. Schedule' },
  { key: 'review', label: '6. Review' },
];

const AVAILABLE_TOOLS = [
  // Workflow
  { id: 'ticket_ops', name: 'Ticket Operations', desc: 'Create and manage tickets' },
  { id: 'finding_ops', name: 'Finding Operations', desc: 'Create and manage findings' },
  { id: 'intervention_ops', name: 'Intervention Ops', desc: 'Request human intervention' },
  { id: 'agent_call', name: 'Agent Call', desc: 'Invoke another agent' },
  { id: 'proposal_ops', name: 'Proposal Operations', desc: 'Create and manage proposals' },
  // Data
  { id: 'db_query', name: 'Database Query', desc: 'Query the database' },
  { id: 'substrate_db_query', name: 'Substrate DB Query', desc: 'Query the substrate database directly' },
  { id: 'memory_search', name: 'Memory Search', desc: 'Search agent memory store' },
  { id: 'memory_store', name: 'Memory Store', desc: 'Store information in memory' },
  // Infrastructure
  { id: 'docker_api', name: 'Docker API', desc: 'Container management operations' },
  { id: 'deploy_ops', name: 'Deploy Operations', desc: 'Build and deploy services' },
  { id: 'security_scan', name: 'Security Scan', desc: 'Scan for security vulnerabilities' },
  { id: 'code_analysis', name: 'Code Analysis', desc: 'Analyze codebase files and patterns' },
  // Agent
  { id: 'web_search', name: 'Web Search', desc: 'Search the web for information' },
  { id: 'web_browse', name: 'Web Browse', desc: 'Browse and extract content from URLs' },
  { id: 'team_coordinate', name: 'Team Coordinate', desc: 'Coordinate with other agents' },
  // Forge
  { id: 'forge_checkpoints', name: 'Forge Checkpoints', desc: 'Save and restore agent execution state' },
  { id: 'forge_capabilities', name: 'Forge Capabilities', desc: 'Manage agent capabilities and skills' },
  { id: 'forge_knowledge_graph', name: 'Knowledge Graph', desc: 'Store and query knowledge relationships' },
  { id: 'forge_goals', name: 'Forge Goals', desc: 'Track and manage agent objectives' },
  { id: 'forge_fleet_intel', name: 'Fleet Intel', desc: 'Get fleet-wide status and intelligence' },
  { id: 'forge_memory', name: 'Forge Memory', desc: 'Agent long-term memory management' },
  { id: 'forge_cost', name: 'Forge Cost', desc: 'Track execution costs and budgets' },
  { id: 'forge_coordination', name: 'Forge Coordination', desc: 'Coordinate multi-agent workflows' },
];

const DEFAULT_CONFIG: AgentConfig = {
  name: '',
  description: '',
  systemPrompt: '',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  tools: [],
  autonomyLevel: 2,
  maxIterations: 15,
  maxCostPerExecution: 1.0,
  scheduleType: 'none',
  scheduleInterval: '6h',
  scheduleCron: '',
};

// ── Sub-components ──

function StepNav({
  current,
  onNav,
}: {
  current: BuilderStep;
  onNav: (step: BuilderStep) => void;
}) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="builder-steps">
      {STEPS.map((step, i) => (
        <button
          key={step.key}
          className={`builder-step ${step.key === current ? 'active' : ''} ${i < currentIdx ? 'done' : ''}`}
          onClick={() => onNav(step.key)}
        >
          {step.label}
        </button>
      ))}
    </div>
  );
}

function ConfigureStep({
  config,
  onChange,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
}) {
  const [optimizing, setOptimizing] = useState(false);

  const handleOptimize = useCallback(async () => {
    if (!config.systemPrompt.trim()) return;
    setOptimizing(true);
    try {
      const result = await hubApi.agents.optimizePrompt({ prompt: config.systemPrompt });
      if (result.optimized) {
        onChange({ systemPrompt: result.optimized });
      }
    } catch (err) {
      console.error('Optimize failed:', err);
    } finally {
      setOptimizing(false);
    }
  }, [config.systemPrompt, onChange]);

  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Agent Name</span>
        <input
          type="text"
          value={config.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Security Scanner"
        />
      </label>
      <label className="builder-field">
        <span>Description</span>
        <input
          type="text"
          value={config.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="What does this agent do?"
        />
      </label>
      <label className="builder-field">
        <span>
          System Prompt
          <button
            className="builder-optimize-btn"
            onClick={handleOptimize}
            disabled={optimizing || !config.systemPrompt.trim()}
          >
            {optimizing ? 'Optimizing...' : 'AI Improve'}
          </button>
        </span>
        <textarea
          value={config.systemPrompt}
          onChange={e => onChange({ systemPrompt: e.target.value })}
          placeholder="Instructions for the agent..."
          rows={8}
        />
      </label>
      <label className="builder-field">
        <span>Autonomy Level (1-5)</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={1}
            max={5}
            value={config.autonomyLevel}
            onChange={e => onChange({ autonomyLevel: parseInt(e.target.value, 10) })}
          />
          <span className="builder-slider-val">{config.autonomyLevel}</span>
        </div>
      </label>
    </div>
  );
}

function ToolsStep({
  config,
  onChange,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
}) {
  const toggleTool = useCallback((toolId: string) => {
    const current = config.tools;
    const next = current.includes(toolId)
      ? current.filter(t => t !== toolId)
      : [...current, toolId];
    onChange({ tools: next });
  }, [config.tools, onChange]);

  return (
    <div className="builder-tools-grid">
      {AVAILABLE_TOOLS.map(tool => (
        <label key={tool.id} className={`builder-tool-card ${config.tools.includes(tool.id) ? 'selected' : ''}`}>
          <input
            type="checkbox"
            checked={config.tools.includes(tool.id)}
            onChange={() => toggleTool(tool.id)}
          />
          <div className="builder-tool-info">
            <div className="builder-tool-name">{tool.name}</div>
            <div className="builder-tool-desc">{tool.desc}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

function ModelStep({
  config,
  onChange,
  providers,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
  providers: ProviderStatus[];
}) {
  const MODELS = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
    { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google' },
  ];

  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Model</span>
        <select value={config.model} onChange={e => onChange({ model: e.target.value })}>
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
          ))}
        </select>
      </label>
      <div className="builder-provider-status">
        <span className="builder-label">Provider Status:</span>
        {providers.map(p => (
          <span key={p.name} className={`builder-provider-badge ${p.status === 'healthy' ? 'healthy' : 'unhealthy'}`}>
            {p.name}: {p.status}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScheduleStep({
  config,
  onChange,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
}) {
  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Schedule Type</span>
        <select value={config.scheduleType} onChange={e => onChange({ scheduleType: e.target.value as AgentConfig['scheduleType'] })}>
          <option value="none">One-shot (manual trigger)</option>
          <option value="interval">Recurring interval</option>
          <option value="cron">Cron expression</option>
        </select>
      </label>
      {config.scheduleType === 'interval' && (
        <label className="builder-field">
          <span>Interval</span>
          <select value={config.scheduleInterval} onChange={e => onChange({ scheduleInterval: e.target.value })}>
            <option value="30m">Every 30 minutes</option>
            <option value="1h">Every hour</option>
            <option value="3h">Every 3 hours</option>
            <option value="6h">Every 6 hours</option>
            <option value="12h">Every 12 hours</option>
            <option value="24h">Every 24 hours</option>
          </select>
        </label>
      )}
      {config.scheduleType === 'cron' && (
        <label className="builder-field">
          <span>Cron Expression</span>
          <input
            type="text"
            value={config.scheduleCron}
            onChange={e => onChange({ scheduleCron: e.target.value })}
            placeholder="0 */6 * * *"
          />
        </label>
      )}
      <label className="builder-field">
        <span>Max Cost per Execution ($)</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={config.maxCostPerExecution}
            onChange={e => onChange({ maxCostPerExecution: parseFloat(e.target.value) })}
          />
          <span className="builder-slider-val">${config.maxCostPerExecution.toFixed(2)}</span>
        </div>
      </label>
      <label className="builder-field">
        <span>Max Iterations</span>
        <div className="builder-slider-row">
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={config.maxIterations}
            onChange={e => onChange({ maxIterations: parseInt(e.target.value, 10) })}
          />
          <span className="builder-slider-val">{config.maxIterations}</span>
        </div>
      </label>
    </div>
  );
}

function ReviewStep({
  config,
  onSubmit,
  submitting,
}: {
  config: AgentConfig;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="builder-review">
      <div className="builder-review-card">
        <h3>{config.name || 'Unnamed Agent'}</h3>
        <p>{config.description || 'No description'}</p>
        <div className="builder-review-grid">
          <div><strong>Model:</strong> {config.model}</div>
          <div><strong>Autonomy:</strong> Level {config.autonomyLevel}</div>
          <div><strong>Tools:</strong> {config.tools.length > 0 ? config.tools.join(', ') : 'None'}</div>
          <div><strong>Max Cost:</strong> ${config.maxCostPerExecution.toFixed(2)}</div>
          <div><strong>Max Iterations:</strong> {config.maxIterations}</div>
          <div>
            <strong>Schedule:</strong>{' '}
            {config.scheduleType === 'none'
              ? 'Manual'
              : config.scheduleType === 'interval'
              ? `Every ${config.scheduleInterval}`
              : config.scheduleCron}
          </div>
        </div>
        {config.systemPrompt && (
          <div className="builder-review-prompt">
            <strong>System Prompt:</strong>
            <pre>{config.systemPrompt}</pre>
          </div>
        )}
      </div>
      <button
        className="builder-create-btn"
        onClick={onSubmit}
        disabled={submitting || !config.name.trim()}
      >
        {submitting ? 'Creating...' : 'Create Agent'}
      </button>
    </div>
  );
}

// ── Main Component ──

export default function BuilderTab({
  prefilledTemplate,
}: {
  prefilledTemplate?: Record<string, unknown> | null;
}) {
  const [step, setStep] = useState<BuilderStep>('template');
  const [config, setConfig] = useState<AgentConfig>({ ...DEFAULT_CONFIG });
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ agentId: string; name: string } | null>(null);

  // Load provider status
  useEffect(() => {
    hubApi.providers.health().then(data => {
      if (data.providers) setProviders(data.providers.map((p: Record<string, unknown>) => ({
        name: p.name as string,
        status: (p.healthStatus as string) ?? 'unknown',
        models: p.models as string[] | undefined,
      })));
    }).catch(() => {});
  }, []);

  // Apply prefilled template
  useEffect(() => {
    if (prefilledTemplate) {
      const tmpl = prefilledTemplate;
      const agentConfig = (tmpl['agent_config'] ?? {}) as Record<string, unknown>;
      setConfig(prev => ({
        ...prev,
        name: (tmpl['name'] as string) ?? prev.name,
        description: (tmpl['description'] as string) ?? prev.description,
        systemPrompt: (agentConfig['systemPrompt'] as string) ?? prev.systemPrompt,
        model: (agentConfig['model'] as string) ?? prev.model,
        tools: (tmpl['required_tools'] as string[]) ?? prev.tools,
        autonomyLevel: (agentConfig['autonomyLevel'] as number) ?? prev.autonomyLevel,
        maxIterations: (agentConfig['maxIterations'] as number) ?? prev.maxIterations,
        maxCostPerExecution: (agentConfig['maxCostPerExecution'] as number) ?? prev.maxCostPerExecution,
      }));
      setStep('configure');
    }
  }, [prefilledTemplate]);

  const updateConfig = useCallback((updates: Partial<AgentConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!.key);
  }, [step]);

  const prevStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1]!.key);
  }, [step]);

  const handleSubmit = useCallback(async () => {
    if (!config.name.trim()) return;
    setSubmitting(true);
    try {
      const res = await hubApi.agents.create({
        name: config.name,
        type: 'custom',
        description: config.description,
        system_prompt: config.systemPrompt,
        modelId: config.model,
        autonomyLevel: config.autonomyLevel,
        enabledTools: config.tools,
        maxIterations: config.maxIterations,
        maxCostPerExecution: config.maxCostPerExecution,
        metadata: { source_layer: 'builder' },
      } as Parameters<typeof hubApi.agents.create>[0]);
      const agent = (res as { agent: { id: string; name: string } }).agent;
      setResult({ agentId: agent.id, name: agent.name ?? config.name });
    } catch (err) {
      console.error('Failed to create agent:', err);
    } finally {
      setSubmitting(false);
    }
  }, [config]);

  if (result) {
    return (
      <div className="builder-success">
        <h2>Agent Created!</h2>
        <p>"{result.name}" is ready. You can find it in the Fleet tab.</p>
        <button className="builder-create-btn" onClick={() => { setResult(null); setConfig({ ...DEFAULT_CONFIG }); setStep('template'); }}>
          Create Another
        </button>
      </div>
    );
  }

  const currentIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="builder-container">
      <StepNav current={step} onNav={setStep} />

      <div className="builder-content">
        {step === 'template' && (
          <div className="builder-template-step">
            <h3>Start from a template or build from scratch</h3>
            <button className="builder-scratch-btn" onClick={() => setStep('configure')}>
              Start from Scratch
            </button>
            <p className="builder-template-hint">
              Or pick a template from the Templates tab
            </p>
          </div>
        )}
        {step === 'configure' && <ConfigureStep config={config} onChange={updateConfig} />}
        {step === 'tools' && <ToolsStep config={config} onChange={updateConfig} />}
        {step === 'model' && <ModelStep config={config} onChange={updateConfig} providers={providers} />}
        {step === 'schedule' && <ScheduleStep config={config} onChange={updateConfig} />}
        {step === 'review' && <ReviewStep config={config} onSubmit={handleSubmit} submitting={submitting} />}
      </div>

      <div className="builder-nav">
        {currentIdx > 0 && (
          <button className="builder-nav-btn" onClick={prevStep}>Back</button>
        )}
        {currentIdx < STEPS.length - 1 && step !== 'template' && (
          <button className="builder-nav-btn builder-nav-next" onClick={nextStep}>Next</button>
        )}
      </div>
    </div>
  );
}
