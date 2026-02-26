import { useCallback, useEffect, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { ContentFeedItem } from '../../hooks/useHubApi';
import StatusBadge from './shared/StatusBadge';
import PaginationBar from './shared/PaginationBar';
import Modal from './shared/Modal';
import EmptyState from './shared/EmptyState';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDateFull = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatCost = (cost: number) => cost > 0 ? `$${cost.toFixed(4)}` : '-';
const formatTokens = (tokens: number) => tokens > 0 ? tokens.toLocaleString() : '-';
const formatDuration = (ms: number) => {
  if (ms <= 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// ── Markdown renderer ──
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const renderInline = (str: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let remaining = str;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/`(.+?)`/);

      let earliest: { type: string; match: RegExpMatchArray } | null = null;
      if (boldMatch && boldMatch.index !== undefined) {
        earliest = { type: 'bold', match: boldMatch };
      }
      if (codeMatch && codeMatch.index !== undefined) {
        if (!earliest || codeMatch.index < earliest.match.index!) {
          earliest = { type: 'code', match: codeMatch };
        }
      }

      if (!earliest) {
        parts.push(remaining);
        break;
      }

      const idx = earliest.match.index!;
      if (idx > 0) parts.push(remaining.slice(0, idx));

      if (earliest.type === 'bold') {
        parts.push(<strong key={`b-${key++}`}>{earliest.match[1]}</strong>);
      } else {
        parts.push(<code key={`c-${key++}`} className="cf-inline-code">{earliest.match[1]}</code>);
      }
      remaining = remaining.slice(idx + earliest.match[0].length);
    }
    return parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="cf-code-block">
            {codeLang && <span className="cf-code-lang">{codeLang}</span>}
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="cf-md-h4">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="cf-md-h3">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="cf-md-h2">{renderInline(line.slice(2))}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={i} className="cf-list-item">{renderInline(line.slice(2))}</div>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<div key={i} className="cf-list-item numbered">{renderInline(line)}</div>);
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="cf-spacer" />);
    } else {
      elements.push(<div key={i} className="cf-line">{renderInline(line)}</div>);
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(<pre key="code-end" className="cf-code-block"><code>{codeLines.join('\n')}</code></pre>);
  }

  return elements;
}

// ── Source icon ──
function SourceIcon({ source }: { source: string }) {
  if (source === 'execution') {
    return (
      <span className="cf-source-icon cf-source-execution" title="Execution Output">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </span>
    );
  }
  if (source === 'resolution') {
    return (
      <span className="cf-source-icon cf-source-resolution" title="Resolved Ticket">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="cf-source-icon cf-source-finding" title="Finding">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </span>
  );
}

// ── Main component ──
export default function ContentFeed() {
  const contentItems = useHubStore((s) => s.contentItems);
  const contentPagination = useHubStore((s) => s.contentPagination);
  const contentPage = useHubStore((s) => s.contentPage);
  const contentAgentFilter = useHubStore((s) => s.contentAgentFilter);
  const contentSourceFilter = useHubStore((s) => s.contentSourceFilter);
  const contentSeverityFilter = useHubStore((s) => s.contentSeverityFilter);
  const contentCategoryFilter = useHubStore((s) => s.contentCategoryFilter);
  const contentDateFrom = useHubStore((s) => s.contentDateFrom);
  const contentDateTo = useHubStore((s) => s.contentDateTo);
  const contentSearch = useHubStore((s) => s.contentSearch);
  const contentAgents = useHubStore((s) => s.contentAgents);
  const contentCategories = useHubStore((s) => s.contentCategories);
  const selectedContentItem = useHubStore((s) => s.selectedContentItem);
  const loading = useHubStore((s) => s.loading);

  const setContentPage = useHubStore((s) => s.setContentPage);
  const setContentAgentFilter = useHubStore((s) => s.setContentAgentFilter);
  const setContentSourceFilter = useHubStore((s) => s.setContentSourceFilter);
  const setContentSeverityFilter = useHubStore((s) => s.setContentSeverityFilter);
  const setContentCategoryFilter = useHubStore((s) => s.setContentCategoryFilter);
  const setContentDateFrom = useHubStore((s) => s.setContentDateFrom);
  const setContentDateTo = useHubStore((s) => s.setContentDateTo);
  const setContentSearch = useHubStore((s) => s.setContentSearch);
  const setSelectedContentItem = useHubStore((s) => s.setSelectedContentItem);

  const fetchContentFeed = useHubStore((s) => s.fetchContentFeed);
  const fetchContentAgents = useHubStore((s) => s.fetchContentAgents);
  const fetchContentCategories = useHubStore((s) => s.fetchContentCategories);
  const [searchInput, setSearchInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setContentSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setContentSearch]);

  // Load filter options on mount
  useEffect(() => {
    fetchContentAgents();
    fetchContentCategories();
  }, [fetchContentAgents, fetchContentCategories]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchContentFeed();
  }, [contentPage, contentAgentFilter, contentSourceFilter, contentSeverityFilter, contentCategoryFilter, contentDateFrom, contentDateTo, contentSearch, fetchContentFeed]);

  // Poll
  const poll = useCallback(() => {
    fetchContentFeed();
  }, [fetchContentFeed]);
  usePolling(poll, 30000);

  const hasActiveFilters = contentAgentFilter || contentSourceFilter || contentSeverityFilter || contentCategoryFilter || contentDateFrom || contentDateTo;

  const clearAllFilters = () => {
    setSearchInput('');
    setContentSearch('');
    setContentAgentFilter('');
    setContentSourceFilter('');
    setContentSeverityFilter('');
    setContentCategoryFilter('');
    setContentDateFrom('');
    setContentDateTo('');
  };

  const sourceLabel = (s: string) => {
    if (s === 'execution') return 'output';
    if (s === 'resolution') return 'resolution';
    return 'finding';
  };

  /** Extract a human-readable title from the content item */
  const itemTitle = (item: ContentFeedItem): string => {
    // Resolutions already have a title
    if (item.title) return item.title;
    // Executions: use the input/task as the title
    if (item.source === 'execution' && item.input) {
      const text = typeof item.input === 'string' ? item.input : JSON.stringify(item.input);
      return text.length > 120 ? text.slice(0, 120) + '…' : text;
    }
    // Findings: pull the first line of content as title
    if (item.content) {
      const firstLine = item.content.split('\n').find(l => l.trim()) || '';
      // Strip markdown headers
      const cleaned = firstLine.replace(/^#+\s*/, '').trim();
      return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned;
    }
    return 'Untitled';
  };

  /** Get a short summary from content, skipping the first line (used as title) */
  const itemSummary = (item: ContentFeedItem): string => {
    if (!item.content) return '';
    const lines = item.content.split('\n').filter(l => l.trim());
    // Skip first line (used as title), take next few for summary
    const rest = lines.slice(1).join(' ').replace(/[#*`]/g, '').trim();
    return rest.length > 200 ? rest.slice(0, 200) + '…' : rest;
  };

  const modalTitle = (item: ContentFeedItem) => {
    if (item.source === 'execution') return 'Execution Output';
    if (item.source === 'resolution') return item.title || 'Resolution Detail';
    return 'Finding Detail';
  };

  return (
    <>
      {/* Search Bar */}
      <div className="cf-search-bar">
        <div className="cf-search-input-wrap">
          <svg className="cf-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="cf-search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search content, findings, and resolutions..."
            aria-label="Search content"
          />
        </div>
        <button
          className={`cf-advanced-toggle ${showAdvanced ? 'active' : ''}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-label="Toggle advanced filters"
          title="Advanced filters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          {hasActiveFilters && <span className="cf-filter-dot" />}
        </button>
      </div>

      {/* Collapsible Advanced Filters */}
      {showAdvanced && (
        <div className="cf-advanced-panel">
          <div className="cf-advanced-grid">
            <div className="cf-filter-group">
              <label>Agent</label>
              <select value={contentAgentFilter} onChange={(e) => setContentAgentFilter(e.target.value)}>
                <option value="">All Agents</option>
                {contentAgents.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="cf-filter-group">
              <label>Source</label>
              <select value={contentSourceFilter} onChange={(e) => setContentSourceFilter(e.target.value)}>
                <option value="">All Sources</option>
                <option value="execution">Execution Outputs</option>
                <option value="finding">Findings</option>
                <option value="resolution">Resolutions</option>
              </select>
            </div>
            <div className="cf-filter-group">
              <label>Severity</label>
              <select value={contentSeverityFilter} onChange={(e) => setContentSeverityFilter(e.target.value)}>
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div className="cf-filter-group">
              <label>Category</label>
              <select value={contentCategoryFilter} onChange={(e) => setContentCategoryFilter(e.target.value)}>
                <option value="">All Categories</option>
                {contentCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="cf-filter-group">
              <label>From</label>
              <input type="date" value={contentDateFrom} onChange={(e) => setContentDateFrom(e.target.value)} />
            </div>
            <div className="cf-filter-group">
              <label>To</label>
              <input type="date" value={contentDateTo} onChange={(e) => setContentDateTo(e.target.value)} />
            </div>
          </div>
          {hasActiveFilters && (
            <button className="hub-btn hub-btn--small cf-clear-btn" onClick={clearAllFilters}>
              Clear All Filters
            </button>
          )}
        </div>
      )}

      {/* Content List */}
      {loading.content && contentItems.length === 0 ? (
        <div className="hub-loading-state">Loading content...</div>
      ) : contentItems.length === 0 ? (
        <EmptyState icon="📝" title="No content yet" message="Run agents to generate outputs, findings, and resolutions." />
      ) : (
        <>
          <div className="cf-content-list">
            {contentItems.map((item) => (
              <div
                key={`${item.source}-${item.id}`}
                className={`cf-content-card ${item.source}`}
                onClick={() => setSelectedContentItem(item)}
              >
                <div className="cf-content-header">
                  <SourceIcon source={item.source} />
                  <span className="cf-content-agent">{item.agent_name}</span>
                  <span className={`cf-content-source-tag ${item.source}`}>
                    {sourceLabel(item.source)}
                  </span>
                  {item.severity && (
                    <StatusBadge status={item.severity} />
                  )}
                  {item.category && (
                    <span className="cf-content-category">{item.category}</span>
                  )}
                  <span className="cf-content-time">{formatDate(item.sort_date)}</span>
                </div>
                <h3 className="cf-content-title">{itemTitle(item)}</h3>
                {itemSummary(item) && (
                  <p className="cf-content-preview">{itemSummary(item)}</p>
                )}
                <div className="cf-content-footer">
                  {item.tokens > 0 && (
                    <span className="cf-content-meta">{formatTokens(item.tokens)} tokens</span>
                  )}
                  {item.cost > 0 && (
                    <span className="cf-content-meta">{formatCost(item.cost)}</span>
                  )}
                  {item.duration_ms > 0 && (
                    <span className="cf-content-meta">{formatDuration(item.duration_ms)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <PaginationBar pagination={contentPagination} currentPage={contentPage} onPageChange={setContentPage} />
        </>
      )}

      {/* Detail Modal */}
      {selectedContentItem && (
        <Modal
          title={modalTitle(selectedContentItem)}
          onClose={() => setSelectedContentItem(null)}
          size="medium"
        >
          <div className="cf-detail">
            <div className="hub-hist-detail-grid" style={{ marginBottom: 'var(--space-lg)' }}>
              <div><strong>Source:</strong></div>
              <div style={{ textTransform: 'capitalize' }}>{selectedContentItem.source}</div>
              <div><strong>Agent:</strong></div>
              <div>{selectedContentItem.agent_name}</div>
              {selectedContentItem.severity && (
                <>
                  <div><strong>Severity:</strong></div>
                  <div><StatusBadge status={selectedContentItem.severity} /></div>
                </>
              )}
              {selectedContentItem.category && (
                <>
                  <div><strong>Category:</strong></div>
                  <div>{selectedContentItem.category}</div>
                </>
              )}
              <div><strong>Date:</strong></div>
              <div>{formatDateFull(selectedContentItem.sort_date)}</div>
              {selectedContentItem.tokens > 0 && (
                <>
                  <div><strong>Tokens:</strong></div>
                  <div>{formatTokens(selectedContentItem.tokens)}</div>
                </>
              )}
              {selectedContentItem.cost > 0 && (
                <>
                  <div><strong>Cost:</strong></div>
                  <div>{formatCost(selectedContentItem.cost)}</div>
                </>
              )}
              {selectedContentItem.duration_ms > 0 && (
                <>
                  <div><strong>Duration:</strong></div>
                  <div>{formatDuration(selectedContentItem.duration_ms)}</div>
                </>
              )}
              {selectedContentItem.execution_id && (
                <>
                  <div><strong>Execution:</strong></div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{selectedContentItem.execution_id}</div>
                </>
              )}
            </div>

            {/* Original problem (resolutions) */}
            {selectedContentItem.source === 'resolution' && selectedContentItem.description && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Original Problem
                </strong>
                <div className="cf-markdown-body">
                  {renderMarkdown(selectedContentItem.description)}
                </div>
              </div>
            )}

            {/* Task/input (executions) */}
            {selectedContentItem.input && selectedContentItem.source === 'execution' && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Task / Input
                </strong>
                <div className="cf-markdown-body" style={{ maxHeight: '150px' }}>
                  {renderMarkdown(typeof selectedContentItem.input === 'string' ? selectedContentItem.input : JSON.stringify(selectedContentItem.input, null, 2))}
                </div>
              </div>
            )}

            {/* Full content */}
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                {selectedContentItem.source === 'execution' ? 'Output' : selectedContentItem.source === 'resolution' ? 'Resolution' : 'Finding'}
              </strong>
              <div className="cf-markdown-body">
                {renderMarkdown(selectedContentItem.content || '')}
              </div>
            </div>

            {/* Agent notes thread (resolutions) */}
            {selectedContentItem.source === 'resolution' && selectedContentItem.notes && selectedContentItem.notes.length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Agent Notes ({selectedContentItem.notes.length})
                </strong>
                <div className="cf-notes-thread">
                  {selectedContentItem.notes.map((note) => (
                    <div key={note.id} className="cf-note">
                      <div className="cf-note-header">
                        <span className="cf-note-author">{note.author}</span>
                        <span className="cf-note-time">{formatDate(note.created_at)}</span>
                      </div>
                      <div className="cf-markdown-body" style={{ padding: 'var(--space-sm)', fontSize: '0.825rem' }}>
                        {renderMarkdown(note.content)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            {selectedContentItem.metadata && Object.keys(selectedContentItem.metadata).length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Metadata</strong>
                <div className="hub-hist-detail-output" style={{ maxHeight: '200px' }}>
                  {JSON.stringify(selectedContentItem.metadata, null, 2)}
                </div>
              </div>
            )}

          </div>
        </Modal>
      )}

      {/* Scoped styles for markdown rendering */}
      <style>{`
        .cf-markdown-body {
          background: var(--surface-alt, var(--bg-secondary, rgba(0,0,0,0.15)));
          border-radius: 8px;
          padding: var(--space-md);
          font-size: 0.875rem;
          line-height: 1.6;
          color: var(--text);
          max-height: 500px;
          overflow-y: auto;
        }
        .cf-md-h2 { font-size: 1.1rem; font-weight: 700; margin: var(--space-sm) 0 var(--space-xs); color: var(--text); }
        .cf-md-h3 { font-size: 1rem; font-weight: 600; margin: var(--space-sm) 0 var(--space-xs); color: var(--text); }
        .cf-md-h4 { font-size: 0.9rem; font-weight: 600; margin: var(--space-xs) 0; color: var(--text-secondary); }
        .cf-line { margin-bottom: 2px; }
        .cf-spacer { height: var(--space-xs); }
        .cf-list-item { padding-left: 1rem; position: relative; margin-bottom: 2px; }
        .cf-list-item::before { content: '\\2022'; position: absolute; left: 0; color: var(--text-secondary); }
        .cf-list-item.numbered::before { content: none; }
        .cf-inline-code {
          background: rgba(255,255,255,0.06);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.8em;
        }
        .cf-code-block {
          background: rgba(0,0,0,0.3);
          border-radius: 6px;
          padding: var(--space-sm) var(--space-md);
          margin: var(--space-xs) 0;
          overflow-x: auto;
          font-size: 0.8rem;
          line-height: 1.5;
          position: relative;
        }
        .cf-code-block code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .cf-code-lang {
          position: absolute;
          top: 4px;
          right: 8px;
          font-size: 0.65rem;
          color: var(--text-secondary);
          opacity: 0.6;
          text-transform: uppercase;
        }
        .cf-source-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cf-source-execution { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
        .cf-source-finding { background: rgba(250, 204, 21, 0.15); color: #facc15; }
        .cf-source-resolution { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
        .cf-notes-thread {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }
        .cf-note {
          border-left: 3px solid var(--border);
          padding-left: var(--space-sm);
        }
        .cf-note-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin-bottom: 4px;
        }
        .cf-note-author {
          font-weight: 600;
          font-size: 0.8rem;
          color: var(--color-primary, #818cf8);
        }
        .cf-note-time {
          font-size: 0.7rem;
          color: var(--text-secondary);
        }
        .cf-content-category {
          font-size: 0.7rem;
          padding: 1px 6px;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
          color: var(--text-secondary);
        }
        .hub-loading-state {
          text-align: center;
          padding: var(--space-xl);
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
      `}</style>
    </>
  );
}
