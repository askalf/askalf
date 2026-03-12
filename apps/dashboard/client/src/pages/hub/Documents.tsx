import { useCallback, useEffect, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { formatDate, formatDateFull, formatCost, formatTokens, formatDuration } from '../../utils/format';
import type { DocumentItem, DocumentDetail } from '../../hooks/useHubApi';
import PaginationBar from './shared/PaginationBar';
import Modal from './shared/Modal';
import EmptyState from './shared/EmptyState';
import './Documents.css';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ── Generate clean markdown with frontmatter ── */
function generateMarkdown(doc: DocumentDetail): string {
  const dateStr = doc.completed_at ? new Date(doc.completed_at).toISOString() : 'unknown';
  const frontmatter = [
    '---',
    `title: "${doc.agent_name} Output"`,
    `agent: ${doc.agent_name}`,
    `type: ${doc.agent_type}`,
    `date: ${dateStr}`,
    `tokens: ${doc.tokens}`,
    `cost: ${formatCost(doc.cost)}`,
    `duration: ${formatDuration(doc.duration_ms)}`,
    `execution_id: ${doc.id}`,
    '---',
    '',
  ].join('\n');

  return frontmatter + doc.output;
}

function downloadMarkdown(doc: DocumentDetail) {
  const md = generateMarkdown(doc);
  const dateSlug = doc.completed_at ? new Date(doc.completed_at).toISOString().slice(0, 10) : 'undated';
  const filename = `${slugify(doc.agent_name)}-${dateSlug}.md`;
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Markdown renderer (same as ContentFeed) ──
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
      if (boldMatch && boldMatch.index !== undefined) earliest = { type: 'bold', match: boldMatch };
      if (codeMatch && codeMatch.index !== undefined) {
        if (!earliest || codeMatch.index < earliest.match.index!) earliest = { type: 'code', match: codeMatch };
      }
      if (!earliest) { parts.push(remaining); break; }
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
        codeLines = []; codeLang = ''; inCodeBlock = false;
      } else { inCodeBlock = true; codeLang = line.slice(3).trim(); }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }
    if (line.startsWith('### ')) elements.push(<h4 key={i} className="cf-md-h4">{renderInline(line.slice(4))}</h4>);
    else if (line.startsWith('## ')) elements.push(<h3 key={i} className="cf-md-h3">{renderInline(line.slice(3))}</h3>);
    else if (line.startsWith('# ')) elements.push(<h2 key={i} className="cf-md-h2">{renderInline(line.slice(2))}</h2>);
    else if (line.startsWith('- ') || line.startsWith('* ')) elements.push(<div key={i} className="cf-list-item">{renderInline(line.slice(2))}</div>);
    else if (/^\d+\.\s/.test(line)) elements.push(<div key={i} className="cf-list-item numbered">{renderInline(line)}</div>);
    else if (line.trim() === '') elements.push(<div key={i} className="cf-spacer" />);
    else elements.push(<div key={i} className="cf-line">{renderInline(line)}</div>);
  }
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(<pre key="code-end" className="cf-code-block"><code>{codeLines.join('\n')}</code></pre>);
  }
  return elements;
}

// ── Document Card ──
function DocumentCard({ doc, onClick }: { doc: DocumentItem; onClick: () => void }) {
  return (
    <div className="docs-card" onClick={onClick}>
      <div className="docs-card-header">
        <span className="docs-agent-badge">{doc.agent_name}</span>
        <span className="docs-card-date">{formatDate(doc.completed_at)}</span>
      </div>
      {doc.input && (
        <div className="docs-card-input">{doc.input.slice(0, 200)}</div>
      )}
      <div className="docs-card-preview">{doc.preview}</div>
      <div className="docs-card-stats">
        <span className="docs-card-stat">{formatTokens(doc.tokens)} tokens</span>
        <span className="docs-card-stat">{formatCost(doc.cost)}</span>
        <span className="docs-card-stat">{formatDuration(doc.duration_ms)}</span>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function Documents() {
  const {
    documents, documentsPagination, documentsPage,
    documentsAgentFilter, documentsSearch, documentsDateFrom, documentsDateTo,
    documentsAgents, selectedDocument,
    setDocumentsPage, setDocumentsAgentFilter, setDocumentsSearch,
    setDocumentsDateFrom, setDocumentsDateTo, setSelectedDocument,
    fetchDocuments, fetchDocumentDetail, fetchDocumentsAgents,
    loading,
  } = useHubStore();

  const [searchInput, setSearchInput] = useState(documentsSearch);
  const [showInput, setShowInput] = useState(true);
  const [copied, setCopied] = useState(false);

  // Initial load
  useEffect(() => { fetchDocuments(); fetchDocumentsAgents(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch on filter/page change
  useEffect(() => { fetchDocuments(); }, [documentsPage, documentsAgentFilter, documentsSearch, documentsDateFrom, documentsDateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { if (searchInput !== documentsSearch) setDocumentsSearch(searchInput); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCardClick = useCallback((doc: DocumentItem) => {
    fetchDocumentDetail(doc.id);
  }, [fetchDocumentDetail]);

  const clearFilters = useCallback(() => {
    setDocumentsAgentFilter('');
    setDocumentsSearch('');
    setDocumentsDateFrom('');
    setDocumentsDateTo('');
    setSearchInput('');
  }, [setDocumentsAgentFilter, setDocumentsSearch, setDocumentsDateFrom, setDocumentsDateTo]);

  const hasFilters = documentsAgentFilter || documentsSearch || documentsDateFrom || documentsDateTo;

  return (
    <div className="docs-container">
      <div className="docs-header">
        <h2>Library</h2>
        {documentsPagination && (
          <span className="docs-header-count">{documentsPagination.total} item{documentsPagination.total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Filters */}
      <div className="docs-filters">
        <select value={documentsAgentFilter} onChange={(e) => setDocumentsAgentFilter(e.target.value)}>
          <option value="">All Agents</option>
          {documentsAgents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          className="docs-search-input"
          type="text"
          placeholder="Search library..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <input
          type="date"
          value={documentsDateFrom}
          onChange={(e) => setDocumentsDateFrom(e.target.value)}
          title="From date"
        />
        <input
          type="date"
          value={documentsDateTo}
          onChange={(e) => setDocumentsDateTo(e.target.value)}
          title="To date"
        />
        {hasFilters && (
          <button className="docs-clear-btn" onClick={clearFilters}>Clear Filters</button>
        )}
      </div>

      {/* Loading */}
      {loading['documents'] && documents.length === 0 && (
        <EmptyState icon="..." title="Loading" message="Loading documents..." />
      )}

      {/* Empty */}
      {!loading['documents'] && documents.length === 0 && (
        <EmptyState
          icon={hasFilters ? '?' : '...'}
          title={hasFilters ? 'No Results' : 'No Content Yet'}
          message={hasFilters ? 'No content matches your filters.' : 'Content from Writer, Researcher, Analyst, and Sentinel agents will appear here — reports, documentation, research, and security audits.'}
        />
      )}

      {/* Card grid */}
      {documents.length > 0 && (
        <div className="docs-grid">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} onClick={() => handleCardClick(doc)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {documentsPagination && documentsPagination.totalPages > 1 && (
        <PaginationBar
          pagination={documentsPagination}
          currentPage={documentsPage}
          onPageChange={setDocumentsPage}
        />
      )}

      {/* Detail Modal */}
      {selectedDocument && (
        <Modal title={selectedDocument.agent_name + ' Output'} onClose={() => { setSelectedDocument(null); setCopied(false); }} size="large">
          {/* Action bar */}
          <div className="docs-action-bar">
            <button
              className="docs-download-btn"
              onClick={() => downloadMarkdown(selectedDocument)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download .md
            </button>
            <button
              className={`docs-copy-btn ${copied ? 'docs-copy-btn--done' : ''}`}
              onClick={async () => {
                const ok = await copyToClipboard(selectedDocument.output);
                if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
              }}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  Copy
                </>
              )}
            </button>
          </div>

          <dl className="docs-detail-meta">
            <div><dt>Agent</dt><dd>{selectedDocument.agent_name}</dd></div>
            <div><dt>Type</dt><dd>{selectedDocument.agent_type}</dd></div>
            <div><dt>Tokens</dt><dd>{formatTokens(selectedDocument.tokens)}</dd></div>
            <div><dt>Cost</dt><dd>{formatCost(selectedDocument.cost)}</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(selectedDocument.duration_ms)}</dd></div>
            <div><dt>Iterations</dt><dd>{selectedDocument.iterations}</dd></div>
            <div><dt>Completed</dt><dd>{formatDateFull(selectedDocument.completed_at)}</dd></div>
            <div><dt>Execution ID</dt><dd style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>{selectedDocument.id}</dd></div>
          </dl>

          {/* Task Input */}
          {selectedDocument.input && (
            <div className="docs-detail-section">
              <div className="docs-detail-section-header" onClick={() => setShowInput(!showInput)}>
                {showInput ? '\u25BC' : '\u25B6'} Task Input
              </div>
              {showInput && <div className="docs-detail-input">{selectedDocument.input}</div>}
            </div>
          )}

          {/* Full Output */}
          <div className="docs-detail-section">
            <div className="docs-detail-section-header">Output</div>
            <div className="docs-detail-content">
              {renderMarkdown(selectedDocument.output)}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
