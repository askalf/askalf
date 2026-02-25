import { useState, useEffect, useCallback } from 'react';
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
}: {
  template: Template;
  onUse: (t: Template) => void;
}) {
  const budgetCap = (template.agent_config as Record<string, unknown>)?.maxCostPerExecution;
  const budgetLabel = typeof budgetCap === 'number' ? `$${budgetCap.toFixed(2)} cap` : null;
  const catColor = CATEGORY_COLORS[template.category] ?? '#666';

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
      <button className="tmpl-card-use" onClick={() => onUse(template)}>
        Use Template
      </button>
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

      <div className="tmpl-grid">
        {filteredTemplates.map(t => (
          <TemplateCard key={t.id} template={t} onUse={handleUse} />
        ))}
        {filteredTemplates.length === 0 && (
          <div className="tmpl-empty">No templates match your search</div>
        )}
      </div>
    </div>
  );
}
