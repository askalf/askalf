import { useState, useMemo } from 'react';
import type { DiffFile } from '../../stores/git-space';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: DiffFile;
  additions: number;
  deletions: number;
}

function buildTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), additions: 0, deletions: 0 };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          additions: 0,
          deletions: 0,
        });
      }

      const node = current.children.get(part)!;
      node.additions += file.additions;
      node.deletions += file.deletions;

      if (isFile) {
        node.file = file;
      }

      current = node;
    }

    // Accumulate to root
    root.additions += file.additions;
    root.deletions += file.deletions;
  }

  return root;
}

// Collapse single-child directories into "a/b/c" style paths
function collapseTree(node: TreeNode): TreeNode {
  const collapsed: Map<string, TreeNode> = new Map();

  for (const [key, child] of node.children) {
    let current = child;
    let collapsedName = key;

    while (current.children.size === 1 && !current.file) {
      const [nextKey, nextChild] = [...current.children.entries()][0]!;
      collapsedName += '/' + nextKey;
      current = nextChild;
    }

    const collapsedNode: TreeNode = {
      ...current,
      name: collapsedName,
    };

    if (current.children.size > 0) {
      const recursed = collapseTree(current);
      collapsedNode.children = recursed.children;
    }

    collapsed.set(collapsedName, collapsedNode);
  }

  return { ...node, children: collapsed };
}

function TreeDirectory({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);

  const dirs = useMemo(() =>
    [...node.children.values()].filter(n => !n.file).sort((a, b) => a.name.localeCompare(b.name)),
    [node.children],
  );
  const files = useMemo(() =>
    [...node.children.values()].filter(n => n.file).sort((a, b) => a.name.localeCompare(b.name)),
    [node.children],
  );

  return (
    <div className="cr-ftv-dir">
      <button
        className="cr-ftv-row cr-ftv-row--dir"
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`cr-ftv-chevron ${open ? 'cr-ftv-chevron--open' : ''}`}>
          <path d="M3 1l4 4-4 4" />
        </svg>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cr-ftv-icon">
          {open
            ? <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            : <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          }
        </svg>
        <span className="cr-ftv-name">{node.name}</span>
        <span className="cr-ftv-stats">
          {node.additions > 0 && <span className="cr-diff-stat--add">+{node.additions}</span>}
          {node.deletions > 0 && <span className="cr-diff-stat--del">-{node.deletions}</span>}
        </span>
      </button>
      {open && (
        <>
          {dirs.map(d => <TreeDirectory key={d.name} node={d} depth={depth + 1} />)}
          {files.map(f => <TreeFile key={f.name} node={f} depth={depth + 1} />)}
        </>
      )}
    </div>
  );
}

function TreeFile({ node, depth }: { node: TreeNode; depth: number }) {
  const anchorId = `#diff-${node.file!.path.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <a
      className="cr-ftv-row cr-ftv-row--file"
      href={anchorId}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cr-ftv-icon">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span className="cr-ftv-name">{node.name}</span>
      <span className="cr-ftv-stats">
        {node.additions > 0 && <span className="cr-diff-stat--add">+{node.additions}</span>}
        {node.deletions > 0 && <span className="cr-diff-stat--del">-{node.deletions}</span>}
      </span>
    </a>
  );
}

interface FileTreeViewerProps {
  files: DiffFile[];
}

export default function FileTreeViewer({ files }: FileTreeViewerProps) {
  const tree = useMemo(() => collapseTree(buildTree(files)), [files]);

  if (files.length === 0) return null;

  const dirs = [...tree.children.values()].filter(n => !n.file).sort((a, b) => a.name.localeCompare(b.name));
  const rootFiles = [...tree.children.values()].filter(n => n.file).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="cr-ftv">
      <div className="cr-ftv-header">
        <span className="cr-ftv-title">Files</span>
        <span className="cr-ftv-count">{files.length}</span>
      </div>
      <div className="cr-ftv-tree">
        {dirs.map(d => <TreeDirectory key={d.name} node={d} depth={0} />)}
        {rootFiles.map(f => <TreeFile key={f.name} node={f} depth={0} />)}
      </div>
    </div>
  );
}
