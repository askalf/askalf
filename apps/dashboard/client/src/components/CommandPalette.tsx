import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { hubApi } from '../hooks/useHubApi';
import type { Agent, Ticket } from '../hooks/useHubApi';
import './CommandPalette.css';

// ── Types ──────────────────────────────────────────────────────────────────

type PaletteItemKind = 'tab' | 'agent' | 'ticket' | 'action';

interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  label: string;
  detail?: string;
  badge?: string;
  badgeClass?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
}

// ── Fuzzy match ────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Exact prefix match scores highest
  if (t.startsWith(q)) return 100;
  // Exact substring
  if (t.includes(q)) return 80;
  // Sequential chars
  return 40;
}

// ── Static items ───────────────────────────────────────────────────────────

const TAB_ITEMS = (onNavigate: (tab: string) => void, onClose: () => void): PaletteItem[] => [
  { id: 'tab:home',      kind: 'tab', label: 'Ask Alf',   detail: 'Chat with Alf + mission control', badge: 'Tab', action: () => { onNavigate('home');      onClose(); } },
  { id: 'tab:fleet',     kind: 'tab', label: 'Team',      detail: 'Team management',                 badge: 'Tab', action: () => { onNavigate('fleet');     onClose(); } },
  { id: 'tab:ops',       kind: 'tab', label: 'Ops',       detail: 'Tickets, interventions, costs',   badge: 'Tab', action: () => { onNavigate('ops');       onClose(); } },
  { id: 'tab:brain',     kind: 'tab', label: 'Memory',    detail: 'Search, teach, and browse memories', badge: 'Tab', action: () => { onNavigate('brain');     onClose(); } },
  { id: 'tab:code',      kind: 'tab', label: 'Workspace', detail: 'Terminal & code workspace',       badge: 'Tab', action: () => { onNavigate('code');      onClose(); } },
  { id: 'tab:settings',  kind: 'tab', label: 'Settings',  detail: 'System configuration',            badge: 'Tab', action: () => { onNavigate('settings');  onClose(); } },
];

const ACTION_ITEMS = (onNavigate: (tab: string) => void, onClose: () => void): PaletteItem[] => [
  {
    id: 'action:deploy',
    kind: 'action',
    label: 'Open Push Panel',
    detail: 'Review and deploy git branches',
    badge: 'Action',
    action: () => { window.open('/forge/push', '_blank'); onClose(); },
  },
  {
    id: 'action:fleet',
    kind: 'action',
    label: 'Go to Fleet Hub',
    detail: 'View all agents and their status',
    badge: 'Action',
    action: () => { onNavigate('fleet'); onClose(); },
  },
  {
    id: 'action:tickets',
    kind: 'action',
    label: 'Open Ticket Board',
    detail: 'View and manage work tickets',
    badge: 'Action',
    action: () => { onNavigate('ops'); onClose(); },
  },
  {
    id: 'action:memory',
    kind: 'action',
    label: 'Browse Memory',
    detail: 'Search cognitive memory store',
    badge: 'Action',
    action: () => { onNavigate('brain'); onClose(); },
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch agents & tickets once when palette opens
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();

    hubApi.agents.list().then(r => setAgents(r.agents ?? [])).catch(() => {});
    hubApi.tickets.list({ filter: 'open', limit: 50 }).then(r => setTickets(r.tickets ?? [])).catch(() => {});
  }, [open]);

  const agentItems = useMemo<PaletteItem[]>(() =>
    agents.map(a => ({
      id: `agent:${a.id}`,
      kind: 'agent' as PaletteItemKind,
      label: a.name,
      detail: a.current_task ?? a.description ?? '',
      badge: a.status,
      badgeClass: `cp-badge--${a.status}`,
      action: () => { onNavigate('fleet'); onClose(); },
    })),
    [agents, onNavigate, onClose]
  );

  const ticketItems = useMemo<PaletteItem[]>(() =>
    tickets.slice(0, 30).map(t => ({
      id: `ticket:${t.id}`,
      kind: 'ticket' as PaletteItemKind,
      label: t.title,
      detail: t.assigned_to ?? '',
      badge: t.priority,
      badgeClass: `cp-badge--${t.priority}`,
      action: () => { onNavigate('ops'); onClose(); },
    })),
    [tickets, onNavigate, onClose]
  );

  const tabItems = useMemo(() => TAB_ITEMS(onNavigate, onClose), [onNavigate, onClose]);
  const actionItems = useMemo(() => ACTION_ITEMS(onNavigate, onClose), [onNavigate, onClose]);

  const allItems = useMemo(() => [
    ...tabItems,
    ...agentItems,
    ...ticketItems,
    ...actionItems,
  ], [tabItems, agentItems, ticketItems, actionItems]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    return allItems
      .filter(item => fuzzyMatch(query, item.label) || fuzzyMatch(query, item.detail ?? '') || fuzzyMatch(query, item.kind))
      .sort((a, b) => fuzzyScore(query, b.label) - fuzzyScore(query, a.label));
  }, [allItems, query]);

  // Group filtered results
  const grouped = useMemo(() => {
    const groups: { title: string; items: PaletteItem[] }[] = [];
    const byKind: Record<string, PaletteItem[]> = {};
    for (const item of filtered) {
      (byKind[item.kind] ??= []).push(item);
    }
    const order: [PaletteItemKind, string][] = [
      ['tab', 'Tabs'],
      ['agent', 'Agents'],
      ['ticket', 'Tickets'],
      ['action', 'Actions'],
    ];
    for (const [kind, title] of order) {
      if (byKind[kind]?.length) groups.push({ title, items: byKind[kind] });
    }
    return groups;
  }, [filtered]);

  // Flat index map for selection
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  // Clamp selected index when list changes
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, flatItems.length - 1));
  }, [flatItems.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        e.preventDefault();
        const item = flatItems[selectedIndex];
        if (item) item.action();
        break;
      }
    }
  }, [flatItems, selectedIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('cp-backdrop')) onClose();
  }, [onClose]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div className="cp-backdrop" onMouseDown={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cp-panel">
        <div className="cp-input-row">
          <span className="cp-icon">⌘</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Search tabs, agents, tickets, actions…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc-hint">esc</kbd>
        </div>

        <div className="cp-results" ref={listRef}>
          {grouped.length === 0 && (
            <div className="cp-empty">No results for "{query}"</div>
          )}
          {grouped.map(group => (
            <div key={group.title} className="cp-group">
              <div className="cp-group-title">{group.title}</div>
              {group.items.map(item => {
                const idx = flatIdx++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    className={`cp-item${isSelected ? ' cp-item--selected' : ''}`}
                    data-index={idx}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => item.action()}
                  >
                    <span className="cp-item-kind-dot" data-kind={item.kind} />
                    <span className="cp-item-label">{item.label}</span>
                    {item.detail && <span className="cp-item-detail">{item.detail}</span>}
                    {item.badge && (
                      <span className={`cp-badge ${item.badgeClass ?? ''}`}>{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          <span><kbd>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
