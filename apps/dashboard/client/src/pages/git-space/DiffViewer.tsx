/**
 * DiffViewer — Renders unified git diff with:
 * - Line numbers (old + new)
 * - Collapsible file sections
 * - File type icons
 * - Hunk navigation
 * No external libraries. Parses diff format directly.
 */

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
  fileType: string;
}

function getFileType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    ts: 'TypeScript', tsx: 'React TSX', js: 'JavaScript', jsx: 'React JSX',
    css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON',
    md: 'Markdown', sql: 'SQL', yml: 'YAML', yaml: 'YAML',
    sh: 'Shell', dockerfile: 'Docker', py: 'Python', go: 'Go',
  };
  return typeMap[ext] || ext.toUpperCase() || 'File';
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

    let additions = 0;
    let deletions = 0;
    const lines: ParsedLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (let i = 1; i < rawLines.length; i++) {
      const line = rawLines[i]!;
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('Binary')) {
        continue;
      }

      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -old,count +new,count @@
        const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          oldLine = parseInt(hunkMatch[1]!, 10);
          newLine = parseInt(hunkMatch[2]!, 10);
        }
        lines.push({ type: 'hunk', content: line, oldLineNum: null, newLineNum: null });
        continue;
      }

      if (line.startsWith('+')) {
        additions++;
        lines.push({ type: 'add', content: line.substring(1), oldLineNum: null, newLineNum: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        deletions++;
        lines.push({ type: 'del', content: line.substring(1), oldLineNum: oldLine, newLineNum: null });
        oldLine++;
      } else {
        // Context line (starts with space or is empty)
        const content = line.startsWith(' ') ? line.substring(1) : line;
        lines.push({ type: 'context', content, oldLineNum: oldLine, newLineNum: newLine });
        oldLine++;
        newLine++;
      }
    }

    files.push({ path, additions, deletions, lines, fileType: getFileType(path) });
  }

  return files;
}

function DiffLine({ line }: { line: ParsedLine }) {
  const className = `cr-diff-line cr-diff-line--${line.type}`;

  return (
    <div className={className}>
      <span className="cr-diff-linenum cr-diff-linenum--old">
        {line.oldLineNum ?? ''}
      </span>
      <span className="cr-diff-linenum cr-diff-linenum--new">
        {line.newLineNum ?? ''}
      </span>
      <span className="cr-diff-line-marker">
        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
      </span>
      <span className="cr-diff-line-content">{line.content || ' '}</span>
    </div>
  );
}

function HunkLine({ line }: { line: ParsedLine }) {
  return (
    <div className="cr-diff-line cr-diff-line--hunk">
      <span className="cr-diff-linenum cr-diff-linenum--old" />
      <span className="cr-diff-linenum cr-diff-linenum--new" />
      <span className="cr-diff-line-marker" />
      <span className="cr-diff-line-content">{line.content}</span>
    </div>
  );
}

function DiffFileSection({ file, defaultOpen }: { file: ParsedFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const changeBar = useMemo(() => {
    const total = file.additions + file.deletions;
    if (total === 0) return null;
    const maxDots = 5;
    const addDots = Math.round((file.additions / total) * maxDots);
    const delDots = maxDots - addDots;
    return (
      <span className="cr-diff-change-dots">
        {'+'  .repeat(addDots).split('').map((_, i) => <span key={`a${i}`} className="cr-dot cr-dot--add" />)}
        {'-'.repeat(delDots).split('').map((_, i) => <span key={`d${i}`} className="cr-dot cr-dot--del" />)}
      </span>
    );
  }, [file.additions, file.deletions]);

  return (
    <div className="cr-diff-file" id={`diff-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`}>
      <button className="cr-diff-header" onClick={() => setOpen(!open)}>
        <div className="cr-diff-header-left">
          <span className="cr-diff-file-icon">{getFileIcon(file.path)}</span>
          <span className="cr-diff-path">{file.path}</span>
        </div>
        <div className="cr-diff-header-right">
          {changeBar}
          <span className="cr-diff-file-stats">
            {file.additions > 0 && <span className="cr-diff-stat--add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="cr-diff-stat--del">-{file.deletions}</span>}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`cr-diff-chevron ${open ? 'cr-diff-chevron--open' : ''}`}>
            <path d="M3 1l4 4-4 4" />
          </svg>
        </div>
      </button>
      {open && (
        <pre className="cr-diff-content">
          {file.lines.map((line, i) =>
            line.type === 'hunk'
              ? <HunkLine key={i} line={line} />
              : <DiffLine key={i} line={line} />,
          )}
        </pre>
      )}
    </div>
  );
}

export default function DiffViewer({ diff, truncated }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  const [expandAll, setExpandAll] = useState(true);
  const toggleKey = useMemo(() => Date.now(), [expandAll]); // Force re-render on toggle

  if (files.length === 0) {
    return <div className="cr-diff-empty">No changes to display</div>;
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="cr-diff-viewer">
      {/* File navigation + expand controls */}
      {files.length > 1 && (
        <div className="cr-diff-nav">
          <div className="cr-diff-nav-summary">
            {files.length} files changed
            <span className="cr-diff-stat--add">+{totalAdditions}</span>
            <span className="cr-diff-stat--del">-{totalDeletions}</span>
          </div>
          <button
            className="cr-diff-nav-toggle"
            onClick={() => setExpandAll(!expandAll)}
          >
            {expandAll ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      )}

      {files.map((file) => (
        <DiffFileSection key={`${file.path}-${toggleKey}`} file={file} defaultOpen={expandAll} />
      ))}
      {truncated && (
        <div className="cr-diff-truncated">
          Diff truncated — full diff exceeds 100KB limit
        </div>
      )}
    </div>
  );
}
