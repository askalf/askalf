import { useState, useEffect, useCallback, useRef } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import './TemplatesTab.css';

// ── Types ──

interface Template {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  icon: string | null;
  agent_config: Record<string, unknown>;
  schedule_config: Record<string, unknown> | null;
  estimated_cost_per_run: string | null;
  required_tools: string[];
  usage_count: number;
  sort_order: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  research: 'Research',
  security: 'Security',
  build: 'Build',
  automate: 'Automate',
  monitor: 'Monitor',
  analyze: 'Analyze',
};

const CATEGORY_COLORS: Record<string, string> = {
  research: '#6366f1',
  security: '#ef4444',
  build: '#22c55e',
  automate: '#f59e0b',
  monitor: '#3b82f6',
  analyze: '#8b5cf6',
};

// ── Sub-components ──

function TemplateCard({
  template,
  onUse,
  onQuickRun,
}: {
  template: Template;
  onUse: (t: Template) => void;
  onQuickRun: (t: Template, prompt: string) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const budgetCap = (template.agent_config as Record<string, unknown>)?.maxCostPerExecution;
  const budgetLabel = typeof budgetCap === 'number' ? `$${budgetCap.toFixed(2)} cap` : null;
  const catColor = CATEGORY_COLORS[template.category] ?? '#666';

  const handleRun = () => {
    if (!prompt.trim()) return;
    setRunning(true);
    onQuickRun(template, prompt.trim());
    setTimeout(() => { setRunning(false); setShowPrompt(false); setPrompt(''); }, 2000);
  };

  return (
    <div className="tmpl-card">
      <div className="tmpl-card-header">
        <span className="tmpl-card-icon">{template.icon ?? '🤖'}</span>
        <span
          className="tmpl-card-category"
          style={{ backgroundColor: `${catColor}20`, color: catColor, borderColor: `${catColor}40` }}
        >
          {CATEGORY_LABELS[template.category] ?? template.category}
        </span>
      </div>
      <h3 className="tmpl-card-name">{template.name}</h3>
      <p className="tmpl-card-desc">{template.description}</p>
      <div className="tmpl-card-meta">
        {budgetLabel && <span className="tmpl-card-cost">{budgetLabel}</span>}
        <span className="tmpl-card-tools">{template.required_tools.length} tools</span>
        {template.usage_count > 0 && (
          <span className="tmpl-card-usage">{template.usage_count} uses</span>
        )}
      </div>
      {showPrompt ? (
        <div className="tmpl-card-prompt">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRun(); if (e.key === 'Escape') setShowPrompt(false); }}
            placeholder="Describe your task..."
            className="tmpl-card-prompt-input"
            autoFocus
          />
          <div className="tmpl-card-prompt-actions">
            <button
              className="tmpl-card-run"
              onClick={handleRun}
              disabled={running || !prompt.trim()}
            >
              {running ? 'Dispatching...' : 'Run'}
            </button>
            <button
              className="tmpl-card-cancel"
              onClick={() => { setShowPrompt(false); setPrompt(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="tmpl-card-actions">
          <button className="tmpl-card-quick" onClick={() => setShowPrompt(true)}>
            Quick Run
          </button>
          <button className="tmpl-card-use" onClick={() => onUse(template)}>
            Customize
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export default function TemplatesTab({
  onUseTemplate,
}: {
  onUseTemplate?: (template: Template) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Record<string, Template[]>>({});
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [runMessage, setRunMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const data = await hubApi.templates.list();
        setTemplates(data.templates as Template[]);
        setCategories(data.categories as Record<string, Template[]>);
      } catch (err) {
        console.error('Failed to fetch templates:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  const handleUse = useCallback((template: Template) => {
    if (onUseTemplate) {
      onUseTemplate(template);
    }
  }, [onUseTemplate]);

  const handleQuickRun = useCallback(async (template: Template, prompt: string) => {
    try {
      // Instantiate agent from template, then run it
      const result = await hubApi.templates.instantiate(template.id, { name: `${template.name} (quick)` });
      const agentId = (result as { agent?: { id?: string } })?.agent?.id;
      if (agentId) {
        await hubApi.agents.run(agentId, prompt);
        setRunMessage({ type: 'success', text: `Dispatched "${template.name}" — check Executions for results` });
        // Update usage count locally
        setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, usage_count: t.usage_count + 1 } : t));
      } else {
        setRunMessage({ type: 'error', text: 'Failed to create agent from template' });
      }
    } catch (err) {
      setRunMessage({ type: 'error', text: err instanceof Error ? err.message : 'Quick run failed' });
    }
    setTimeout(() => setRunMessage(null), 4000);
  }, []);

  const filteredTemplates = templates.filter(t => {
    if (filter !== 'all' && t.category !== filter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categoryKeys = Object.keys(categories);

  if (loading) {
    return <div className="tmpl-loading">Loading templates...</div>;
  }

  return (
    <div className="tmpl-container">
      <div className="tmpl-header">
        <h2>Agent Templates</h2>
        <p>Pre-configured agent blueprints ready to deploy</p>
      </div>

      <div className="tmpl-filters">
        <input
          className="tmpl-search"
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="tmpl-category-pills">
          <button
            className={`tmpl-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({templates.length})
          </button>
          {categoryKeys.map(cat => (
            <button
              key={cat}
              className={`tmpl-pill ${filter === cat ? 'active' : ''}`}
              onClick={() => setFilter(cat)}
              style={filter === cat ? {
                backgroundColor: `${CATEGORY_COLORS[cat] ?? '#666'}20`,
                borderColor: `${CATEGORY_COLORS[cat] ?? '#666'}60`,
              } : {}}
            >
              {CATEGORY_LABELS[cat] ?? cat} ({categories[cat]?.length ?? 0})
            </button>
          ))}
        </div>
      </div>

      {runMessage && (
        <div className={`tmpl-message tmpl-message-${runMessage.type}`}>
          {runMessage.text}
        </div>
      )}

      <div className="tmpl-grid">
        {filteredTemplates.map(t => (
          <TemplateCard key={t.id} template={t} onUse={handleUse} onQuickRun={handleQuickRun} />
        ))}
        {filteredTemplates.length === 0 && (
          <div className="tmpl-empty">No templates match your search</div>
        )}
      </div>
    </div>
  );
}
