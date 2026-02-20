import { useState, useMemo } from 'react';

interface DiffViewerProps {
  diff: string;
  truncated?: boolean;
}

interface ParsedLine {
  type: 'add' | 'del' | 'context' | 'hunk';
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface ParsedFile {
  path: string;
  additions: number;
  deletions: number;
  lines: ParsedLine[];
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (['ts', 'tsx'].includes(ext)) return 'TS';
  if (['js', 'jsx'].includes(ext)) return 'JS';
  if (['css', 'scss'].includes(ext)) return 'CSS';
  if (['json'].includes(ext)) return '{ }';
  if (['sql'].includes(ext)) return 'SQL';
  if (['md'].includes(ext)) return 'MD';
  if (['yml', 'yaml'].includes(ext)) return 'YML';
  return ext.substring(0, 3).toUpperCase() || '...';
}

function parseDiff(raw: string): ParsedFile[] {
  if (!raw.trim()) return [];
  const files: ParsedFile[] = [];
  const sections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of sections) {
    const rawLines = section.split('\n');
    const headerMatch = rawLines[0]?.match(/a\/(.+?)\s+b\/(.+)/);
    const path = headerMatch ? headerMatch[2]! : rawLines[0]?.split(' ')[0] || 'unknown';

    let additions = 0, deletions = 0;
    const lines: ParsedLine[] = [];
    let oldLine = 0, newLine = 0;

    for (let i = 1; i < rawLines.length; i++) {
      const line = rawLines[i]!;
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('Binary')) continue;

      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) { oldLine = parseInt(hunkMatch[1]!, 10); newLine = parseInt(hunkMatch[2]!, 10); }
        lines.push({ type: 'hunk', content: line, oldLineNum: null, newLineNum: null });
        continue;
      }

      if (line.startsWith('+')) {
        additions++;
        lines.push({ type: 'add', content: line.substring(1), oldLineNum: null, newLineNum: newLine++ });
      } else if (line.startsWith('-')) {
        deletions++;
        lines.push({ type: 'del', content: line.substring(1), oldLineNum: oldLine++, newLineNum: null });
      } else {
        const content = line.startsWith(' ') ? line.substring(1) : line;
        lines.push({ type: 'context', content, oldLineNum: oldLine++, newLineNum: newLine++ });
      }
    }

    files.push({ path, additions, deletions, lines });
  }
  return files;
}

function DiffFileSection({ file, defaultOpen }: { file: ParsedFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="jp-diff-file">
      <button className="jp-diff-file-header" onClick={() => setOpen(!open)}>
        <div className="jp-diff-file-left">
          <span className="jp-diff-file-icon">{getFileIcon(file.path)}</span>
          <span className="jp-diff-file-path">{file.path}</span>
        </div>
        <div className="jp-diff-file-right">
          {file.additions > 0 && <span className="jp-diff-stat--add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="jp-diff-stat--del">-{file.deletions}</span>}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`jp-diff-chevron ${open ? 'jp-diff-chevron--open' : ''}`}>
            <path d="M3 1l4 4-4 4" />
          </svg>
        </div>
      </button>
      {open && (
        <pre className="jp-diff-content">
          {file.lines.map((line, i) => (
            <div key={i} className={`jp-diff-line jp-diff-line--${line.type}`}>
              <span className="jp-diff-ln jp-diff-ln--old">{line.oldLineNum ?? ''}</span>
              <span className="jp-diff-ln jp-diff-ln--new">{line.newLineNum ?? ''}</span>
              <span className="jp-diff-marker">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
              <span className="jp-diff-text">{line.content || ' '}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export default function DiffViewer({ diff, truncated }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [expandAll, setExpandAll] = useState(true);
  const toggleKey = useMemo(() => Date.now(), [expandAll]); // eslint-disable-line

  if (files.length === 0) return <div className="jp-muted">No changes to display</div>;

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="jp-diff-viewer">
      {files.length > 1 && (
        <div className="jp-diff-nav">
          <span className="jp-diff-nav-summary">
            {files.length} files · <span className="jp-diff-stat--add">+{totalAdd}</span> <span className="jp-diff-stat--del">-{totalDel}</span>
          </span>
          <button className="jp-diff-nav-toggle" onClick={() => setExpandAll(!expandAll)}>
            {expandAll ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      )}
      {files.map((file) => (
        <DiffFileSection key={`${file.path}-${toggleKey}`} file={file} defaultOpen={expandAll} />
      ))}
      {truncated && <div className="jp-diff-truncated">Diff truncated — exceeds 100KB limit</div>}
    </div>
  );
}
