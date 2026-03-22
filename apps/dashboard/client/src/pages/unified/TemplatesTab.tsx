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
  source?: string;
  featured?: boolean;
  downloads?: number;
  author_name?: string;
  rating_count?: number;
  rating_sum?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  personal: 'Personal',
  content: 'Content',
  marketing: 'Marketing',
  support: 'Support',
  ecommerce: 'E-Commerce',
  finance: 'Finance',
  operations: 'Operations',
  hr: 'People & HR',
  legal: 'Legal & Compliance',
  research: 'Research',
  analyze: 'Analyze',
  automate: 'Automate',
  monitor: 'Monitor',
  build: 'Build',
  dev: 'Development',
  security: 'Security',
};

const CATEGORY_COLORS: Record<string, string> = {
  research: '#6366f1',
  security: '#ef4444',
  build: '#22c55e',
  automate: '#f59e0b',
  monitor: '#3b82f6',
  analyze: '#8b5cf6',
  dev: '#14b8a6',
  marketing: '#ec4899',
  support: '#06b6d4',
  ecommerce: '#f97316',
  content: '#a855f7',
  finance: '#10b981',
  legal: '#64748b',
  hr: '#f43f5e',
  operations: '#0ea5e9',
  personal: '#f472b6',
};

const CATEGORY_ICONS: Record<string, string> = {
  research: '\u{1F50D}',
  security: '\u{1F6E1}',
  build: '\u{1F528}',
  automate: '\u{2699}',
  monitor: '\u{1F4CA}',
  analyze: '\u{1F9EA}',
  dev: '\u{1F4BB}',
  marketing: '\u{1F4E3}',
  support: '\u{1F3E7}',
  ecommerce: '\u{1F6D2}',
  content: '\u{270F}',
  finance: '\u{1F4B0}',
  legal: '\u{2696}',
  hr: '\u{1F465}',
  operations: '\u{1F3ED}',
  personal: '\u{1F3E0}',
};

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web Search',
  web_browse: 'Web Browse',
  memory_search: 'Memory Search',
  memory_store: 'Memory Store',
  db_query: 'DB Query',
  substrate_db_query: 'Substrate DB',
  ticket_ops: 'Tickets',
  finding_ops: 'Findings',
  intervention_ops: 'Interventions',
  agent_call: 'Worker Call',
  docker_api: 'Docker',
  deploy_ops: 'Deploy',
  security_scan: 'Security Scan',
  code_analysis: 'Code Analysis',
  team_coordinate: 'Team Coord',
  forge_checkpoints: 'Checkpoints',
  forge_capabilities: 'Capabilities',
  forge_knowledge_graph: 'Knowledge Graph',
  forge_goals: 'Goals',
  forge_fleet_intel: 'Team Intel',
  forge_memory: 'Memory',
  forge_cost: 'Costs',
  forge_coordination: 'Coordination',
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
  const [runState, setRunState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [showTools, setShowTools] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const budgetCap = (template.agent_config as Record<string, unknown>)?.maxCostPerExecution;
  const budgetLabel = typeof budgetCap === 'number' ? `$${budgetCap.toFixed(2)} cap` : null;
  const model = (template.agent_config as Record<string, unknown>)?.model as string | undefined;
  const modelShort = model ?? null;
  const catColor = CATEGORY_COLORS[template.category] ?? '#666';
  const catIcon = CATEGORY_ICONS[template.category] ?? '\u{2B22}';

  const handleRun = async () => {
    if (!prompt.trim() || runState === 'running') return;
    setRunState('running');
    try {
      await onQuickRun(template, prompt.trim());
      setRunState('done');
      setTimeout(() => { setRunState('idle'); setShowPrompt(false); setPrompt(''); }, 2500);
    } catch {
      setRunState('error');
      setTimeout(() => setRunState('idle'), 3000);
    }
  };

  const runLabel = runState === 'running' ? 'Dispatching...'
    : runState === 'done' ? 'Dispatched!'
    : runState === 'error' ? 'Failed'
    : 'Run';

  return (
    <div className="tmpl-card">
      <div className="tmpl-card-header">
        <span className="tmpl-card-icon" aria-hidden="true">{catIcon}</span>
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
        {template.featured && <span className="tmpl-card-badge tmpl-badge-featured">Featured</span>}
        {template.source === 'community' && <span className="tmpl-card-badge tmpl-badge-community">Community</span>}
        {template.source === 'alf' && <span className="tmpl-card-badge tmpl-badge-alf">Alf</span>}
        {(template.downloads ?? 0) > 0 && <span className="tmpl-card-downloads">{template.downloads} installs</span>}
        {budgetLabel && <span className="tmpl-card-cost">{budgetLabel}</span>}
        {modelShort && <span className="tmpl-card-model">{modelShort}</span>}
        <button
          className="tmpl-card-tools-toggle"
          onClick={(e) => { e.stopPropagation(); setShowTools(v => !v); }}
          title={template.required_tools.map(t => TOOL_LABELS[t] ?? t).join(', ')}
        >
          {template.required_tools.length} tool{template.required_tools.length !== 1 ? 's' : ''}
        </button>
        {template.usage_count > 0 && (
          <span className="tmpl-card-usage">{template.usage_count} use{template.usage_count !== 1 ? 's' : ''}</span>
        )}
      </div>
      {showTools && template.required_tools.length > 0 && (
        <div className="tmpl-card-tool-list">
          {template.required_tools.map(t => (
            <span key={t} className="tmpl-tool-tag">{TOOL_LABELS[t] ?? t}</span>
          ))}
        </div>
      )}
      {showPrompt ? (
        <div className="tmpl-card-prompt">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRun(); if (e.key === 'Escape') { setShowPrompt(false); setPrompt(''); } }}
            placeholder="Describe your task..."
            className="tmpl-card-prompt-input"
            disabled={runState === 'running'}
            autoFocus
          />
          <div className="tmpl-card-prompt-actions">
            <button
              className={`tmpl-card-run ${runState === 'done' ? 'tmpl-card-run--done' : ''} ${runState === 'error' ? 'tmpl-card-run--error' : ''}`}
              onClick={handleRun}
              disabled={runState !== 'idle' || !prompt.trim()}
            >
              {runLabel}
            </button>
            <button
              className="tmpl-card-cancel"
              onClick={() => { setShowPrompt(false); setPrompt(''); setRunState('idle'); }}
              disabled={runState === 'running'}
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
  const importRef = useRef<HTMLInputElement>(null);

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
    // Instantiate agent from template, then run it
    const result = await hubApi.templates.instantiate(template.id, { name: `${template.name} (quick)` });
    const agentId = (result as { agent?: { id?: string } })?.agent?.id;
    if (!agentId) {
      setRunMessage({ type: 'error', text: 'Failed to create agent from template' });
      setTimeout(() => setRunMessage(null), 4000);
      throw new Error('Failed to create agent');
    }
    await hubApi.agents.run(agentId, prompt);
    setRunMessage({ type: 'success', text: `Dispatched "${template.name}" — check Team for progress` });
    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, usage_count: t.usage_count + 1 } : t));
    setTimeout(() => setRunMessage(null), 4000);
  }, []);

  const [page, setPage] = useState(0);
  const PAGE_SIZE = 24;

  const filteredTemplates = templates.filter(t => {
    if (filter !== 'all' && t.category !== filter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Reset page when filter/search changes
  useEffect(() => { setPage(0); }, [filter, search]);

  const totalPages = Math.ceil(filteredTemplates.length / PAGE_SIZE);
  const pagedTemplates = filteredTemplates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleExport = useCallback((scope: 'all' | 'filtered') => {
    const source = scope === 'filtered' ? filteredTemplates : templates;
    const exportData = source.map(t => ({
      name: t.name,
      slug: t.slug,
      category: t.category,
      description: t.description,
      icon: t.icon,
      agent_config: t.agent_config,
      schedule_config: t.schedule_config,
      estimated_cost_per_run: t.estimated_cost_per_run,
      required_tools: t.required_tools,
      sort_order: t.sort_order,
    }));
    const bundle = {
      version: 1,
      type: 'bundle' as const,
      name: scope === 'filtered' && filter !== 'all' ? `${CATEGORY_LABELS[filter] ?? filter} Bundle` : 'All Templates',
      exported_at: new Date().toISOString(),
      templates: exportData,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `askalf-${scope === 'filtered' && filter !== 'all' ? filter : 'templates'}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setRunMessage({ type: 'success', text: `Exported ${exportData.length} templates as bundle` });
    setTimeout(() => setRunMessage(null), 3000);
  }, [templates, filteredTemplates, filter]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Record<string, unknown>;
      // Support both single template and bundle format
      let templatesToImport: Record<string, unknown>[];
      if (Array.isArray(raw.templates)) {
        templatesToImport = raw.templates as Record<string, unknown>[];
      } else if (raw.name && raw.category) {
        // Single template file
        templatesToImport = [raw];
      } else {
        setRunMessage({ type: 'error', text: 'Invalid file — no templates found' });
        setTimeout(() => setRunMessage(null), 4000);
        return;
      }
      const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';
      const res = await fetch(`${API_BASE}/api/v1/forge/templates/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: templatesToImport }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json() as { imported: number };
      setRunMessage({ type: 'success', text: `Imported ${result.imported} templates` });
      // Reload
      const freshData = await hubApi.templates.list();
      setTemplates(freshData.templates as Template[]);
      setCategories(freshData.categories as Record<string, Template[]>);
    } catch (err) {
      setRunMessage({ type: 'error', text: `Import failed: ${err instanceof Error ? err.message : 'unknown error'}` });
    }
    setTimeout(() => setRunMessage(null), 4000);
    if (importRef.current) importRef.current.value = '';
  }, []);

  const categoryKeys = Object.keys(categories);

  if (loading) {
    return <div className="tmpl-loading">Loading skills...</div>;
  }

  return (
    <div className="tmpl-container">
      <div className="tmpl-header">
        <div className="tmpl-title-row">
          <span className="tmpl-icon">&#x2B22;</span>
          <h2>Templates</h2>
          <div className="tmpl-header-actions">
            <button className="tmpl-export-btn" onClick={() => handleExport('all')} title="Export all templates as bundle">
              Export All
            </button>
            {filter !== 'all' && (
              <button className="tmpl-export-btn" onClick={() => handleExport('filtered')} title={`Export ${CATEGORY_LABELS[filter] ?? filter} templates`}>
                Export {CATEGORY_LABELS[filter] ?? filter}
              </button>
            )}
            <button className="tmpl-import-btn" onClick={() => importRef.current?.click()} title="Import template bundle (.json)">
              Import Bundle
            </button>
            <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </div>
        </div>
        <p>Pre-built worker templates — run instantly or customize for your needs</p>
      </div>

      {/* Recently Used */}
      {templates.filter(t => t.usage_count > 0).length > 0 && filter === 'all' && !search && (
        <div className="tmpl-recent">
          <div className="tmpl-recent-label">RECENTLY USED</div>
          <div className="tmpl-recent-row">
            {templates
              .filter(t => t.usage_count > 0)
              .sort((a, b) => b.usage_count - a.usage_count)
              .slice(0, 5)
              .map(t => (
                <button key={t.id} className="tmpl-recent-chip" onClick={() => onUseTemplate?.(t)}>
                  {CATEGORY_ICONS[t.category] ?? ''} {t.name}
                  <span className="tmpl-recent-count">{t.usage_count}x</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="tmpl-filters">
        <input
          className="tmpl-search"
          type="text"
          placeholder="Search skills..."
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
        {pagedTemplates.map(t => (
          <TemplateCard key={t.id} template={t} onUse={handleUse} onQuickRun={handleQuickRun} />
        ))}
        {filteredTemplates.length === 0 && (
          <div className="tmpl-empty">No skills match your search</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="tmpl-pagination">
          <button className="tmpl-page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            &larr; Prev
          </button>
          <span className="tmpl-page-info">
            {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, filteredTemplates.length)} of {filteredTemplates.length}
          </span>
          <button className="tmpl-page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
