import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { ForgeTool } from '../../hooks/useHubApi';
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
  scheduleType: 'none' | 'interval';
  scheduleInterval: string;
}

const STEPS: { key: BuilderStep; label: string }[] = [
  { key: 'template', label: '1. Template' },
  { key: 'configure', label: '2. Configure' },
  { key: 'tools', label: '3. Tools' },
  { key: 'model', label: '4. Model' },
  { key: 'schedule', label: '5. Schedule' },
  { key: 'review', label: '6. Review' },
];

/* Tools fetched dynamically from forge_tools DB via API.
   RISK_ORDER used for visual sorting: critical/high tools at bottom. */
const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function toToolItem(t: ForgeTool) {
  return { id: t.name, name: t.display_name, desc: t.description, risk: t.risk_level };
}

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
};

// ── Sub-components ──

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  agent_config?: Record<string, unknown>;
  required_tools?: string[];
  schedule_config?: Record<string, unknown>;
}

const CATEGORY_ICONS: Record<string, string> = {
  research: '\u{1F50D}', security: '\u{1F6E1}', build: '\u{1F528}', automate: '\u{2699}',
  monitor: '\u{1F4E1}', analyze: '\u{1F4CA}', dev: '\u{1F4BB}', content: '\u{270F}',
};

function TemplatePickerStep({ onSelect, onSkip }: { onSelect: (tmpl: Record<string, unknown>) => void; onSkip: () => void }) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    hubApi.templates.list().then(data => {
      if (data.templates) setTemplates(data.templates as unknown as TemplateItem[]);
    }).catch(() => {}).finally(() => setLoadingTemplates(false));
  }, []);

  const filtered = filter
    ? templates.filter(t => t.category === filter)
    : templates;

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="builder-template-step">
      <h3>Start from a template or build from scratch</h3>
      <button className="builder-scratch-btn" onClick={onSkip}>
        Start from Scratch
      </button>

      <div style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button
            className={`builder-scratch-btn ${!filter ? 'active' : ''}`}
            style={{ padding: '4px 12px', fontSize: '12px' }}
            onClick={() => setFilter('')}
          >
            All ({templates.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              className={`builder-scratch-btn ${filter === cat ? 'active' : ''}`}
              style={{ padding: '4px 12px', fontSize: '12px' }}
              onClick={() => setFilter(f => f === cat ? '' : cat)}
            >
              {CATEGORY_ICONS[cat] || ''} {cat}
            </button>
          ))}
        </div>

        {loadingTemplates ? (
          <p className="builder-template-hint">Loading templates...</p>
        ) : filtered.length === 0 ? (
          <p className="builder-template-hint">No templates found</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
            {filtered.map(t => (
              <button
                key={t.id}
                className="builder-template-card"
                onClick={() => onSelect(t as unknown as Record<string, unknown>)}
                style={{
                  textAlign: 'left', padding: '16px', borderRadius: 'var(--radius-sm, 10px)',
                  background: 'var(--glass, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(240,240,242,0.06))',
                  cursor: 'pointer', transition: 'all 0.2s', color: 'var(--text, #f0f0f2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span>{CATEGORY_ICONS[t.category] || '\u{1F916}'}</span>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{t.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim, rgba(240,240,242,0.55))', lineHeight: 1.5 }}>
                  {t.description?.slice(0, 100)}{(t.description?.length ?? 0) > 100 ? '...' : ''}
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted, rgba(240,240,242,0.35))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t.category} · {t.required_tools?.length ?? 0} tools
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
        <span>Autonomy Level</span>
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
        <div className="builder-autonomy-desc">
          {config.autonomyLevel === 1 && <span><strong>Manual</strong> — Agent proposes actions, waits for your approval before doing anything</span>}
          {config.autonomyLevel === 2 && <span><strong>Guided</strong> — Agent handles routine tasks, asks before anything risky or destructive</span>}
          {config.autonomyLevel === 3 && <span><strong>Balanced</strong> — Agent works independently on most tasks, checks in on major decisions</span>}
          {config.autonomyLevel === 4 && <span><strong>Autonomous</strong> — Agent operates freely, only alerts you on errors or cost thresholds</span>}
          {config.autonomyLevel === 5 && <span><strong>Full Auto</strong> — Agent runs end-to-end without interruption, including deploys and git pushes</span>}
        </div>
      </label>
    </div>
  );
}

function ToolsStep({
  config,
  onChange,
  tools,
}: {
  config: AgentConfig;
  onChange: (updates: Partial<AgentConfig>) => void;
  tools: { id: string; name: string; desc: string; risk: string }[];
}) {
  const [filter, setFilter] = useState('');

  const toggleTool = useCallback((toolId: string) => {
    const current = config.tools;
    const next = current.includes(toolId)
      ? current.filter(t => t !== toolId)
      : [...current, toolId];
    onChange({ tools: next });
  }, [config.tools, onChange]);

  const filtered = filter
    ? tools.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()) || t.desc.toLowerCase().includes(filter.toLowerCase()))
    : tools;

  return (
    <div>
      <div className="builder-tools-header">
        <input
          type="text"
          placeholder="Filter tools..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="builder-tools-filter"
        />
        <span className="builder-tools-count">{config.tools.length} selected / {tools.length} available</span>
      </div>
      <div className="builder-tools-grid">
        {filtered.map(tool => (
          <label key={tool.id} className={`builder-tool-card ${config.tools.includes(tool.id) ? 'selected' : ''}`}>
            <input
              type="checkbox"
              checked={config.tools.includes(tool.id)}
              onChange={() => toggleTool(tool.id)}
            />
            <div className="builder-tool-info">
              <div className="builder-tool-name">
                {tool.name}
                {tool.risk !== 'low' && (
                  <span className={`builder-tool-risk builder-tool-risk--${tool.risk}`}>{tool.risk}</span>
                )}
              </div>
              <div className="builder-tool-desc">{tool.desc}</div>
            </div>
          </label>
        ))}
      </div>
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

  const selectedModel = MODELS.find(m => m.id === config.model);
  const selectedProvider = selectedModel ? providers.find(p => p.name === selectedModel.provider) : null;
  const providerUnhealthy = selectedProvider && selectedProvider.status !== 'healthy';

  return (
    <div className="builder-form">
      <label className="builder-field">
        <span>Model</span>
        <select value={config.model} onChange={e => {
          const m = MODELS.find(x => x.id === e.target.value);
          onChange({ model: e.target.value, provider: m?.provider || config.provider });
        }}>
          {MODELS.map(m => {
            const p = providers.find(x => x.name === m.provider);
            const ok = p?.status === 'healthy';
            return (
              <option key={m.id} value={m.id}>{m.label} ({m.provider}{ok ? '' : ' - not configured'})</option>
            );
          })}
        </select>
      </label>
      {providerUnhealthy && (
        <div className="builder-provider-warning">
          Provider "{selectedProvider.name}" is not configured. This agent won't be able to run until you add an API key in Settings &gt; Providers.
        </div>
      )}
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
  toolNames,
}: {
  config: AgentConfig;
  onSubmit: () => void;
  submitting: boolean;
  toolNames: Record<string, string>;
}) {
  return (
    <div className="builder-review">
      <div className="builder-review-card">
        <h3>{config.name || 'Unnamed Agent'}</h3>
        <p>{config.description || 'No description'}</p>
        <div className="builder-review-grid">
          <div><strong>Model:</strong> {config.model}</div>
          <div><strong>Autonomy:</strong> {config.autonomyLevel === 1 ? 'Manual' : config.autonomyLevel === 2 ? 'Guided' : config.autonomyLevel === 3 ? 'Balanced' : config.autonomyLevel === 4 ? 'Autonomous' : 'Full Auto'} ({config.autonomyLevel}/5)</div>
          <div><strong>Tools:</strong> {config.tools.length > 0 ? config.tools.map(t => toolNames[t] || t).join(', ') : 'None'}</div>
          <div><strong>Max Cost:</strong> ${config.maxCostPerExecution.toFixed(2)}</div>
          <div><strong>Max Iterations:</strong> {config.maxIterations}</div>
          <div>
            <strong>Schedule:</strong>{' '}
            {config.scheduleType === 'none'
              ? 'Manual'
              : `Every ${config.scheduleInterval}`}
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
  const [availableTools, setAvailableTools] = useState<{ id: string; name: string; desc: string; risk: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ agentId: string; name: string } | null>(null);

  // Load provider status + available tools
  useEffect(() => {
    hubApi.providers.health().then(data => {
      if (data.providers) setProviders(data.providers.map((p: Record<string, unknown>) => ({
        name: p.name as string,
        status: (p.healthStatus as string) ?? 'unknown',
        models: p.models as string[] | undefined,
      })));
    }).catch(() => {});

    hubApi.tools.list().then(data => {
      if (data.tools) {
        const sorted = data.tools
          .map(toToolItem)
          .sort((a, b) => (RISK_ORDER[a.risk] ?? 0) - (RISK_ORDER[b.risk] ?? 0) || a.name.localeCompare(b.name));
        setAvailableTools(sorted);
      }
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
      // Apply schedule config from template
      const schedCfg = (tmpl['schedule_config'] ?? {}) as Record<string, unknown>;
      if (schedCfg['interval_minutes']) {
        const mins = schedCfg['interval_minutes'] as number;
        const inverseMap: Record<number, string> = { 30: '30m', 60: '1h', 180: '3h', 360: '6h', 720: '12h', 1440: '24h' };
        setConfig(prev => ({
          ...prev,
          scheduleType: 'interval',
          scheduleInterval: inverseMap[mins] ?? '6h',
        }));
      }
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

      // Wire schedule if not manual/one-shot
      if (config.scheduleType !== 'none' && agent.id) {
        const intervalMap: Record<string, number> = {
          '30m': 30, '1h': 60, '3h': 180, '6h': 360, '12h': 720, '24h': 1440,
        };
        const intervalMinutes = intervalMap[config.scheduleInterval] ?? 360;
        try {
          await hubApi.agents.setSchedule(agent.id, {
            schedule_type: 'scheduled',
            interval_minutes: intervalMinutes,
          });
        } catch (schedErr) {
          console.error('Failed to set schedule:', schedErr);
        }
      }

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
          <TemplatePickerStep onSelect={(tmpl) => {
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
            const schedCfg = (tmpl['schedule_config'] ?? {}) as Record<string, unknown>;
            if (schedCfg['interval_minutes']) {
              const mins = schedCfg['interval_minutes'] as number;
              const inverseMap: Record<number, string> = { 30: '30m', 60: '1h', 180: '3h', 360: '6h', 720: '12h', 1440: '24h' };
              setConfig(prev => ({ ...prev, scheduleType: 'interval', scheduleInterval: inverseMap[mins] ?? '6h' }));
            }
            setStep('configure');
          }} onSkip={() => setStep('configure')} />
        )}
        {step === 'configure' && <ConfigureStep config={config} onChange={updateConfig} />}
        {step === 'tools' && <ToolsStep config={config} onChange={updateConfig} tools={availableTools} />}
        {step === 'model' && <ModelStep config={config} onChange={updateConfig} providers={providers} />}
        {step === 'schedule' && <ScheduleStep config={config} onChange={updateConfig} />}
        {step === 'review' && <ReviewStep config={config} onSubmit={handleSubmit} submitting={submitting} toolNames={Object.fromEntries(availableTools.map(t => [t.id, t.name]))} />}
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
