import { useEffect, useCallback } from 'react';

type TabKey = string;

interface KeyboardShortcutsOptions {
  visibleKeys: TabKey[];
  activeTab: TabKey;
  setActiveTab: (key: TabKey) => void;
  onRefresh: () => void;
  onToggleHelp: () => void;
  helpOpen: boolean;
  onTogglePalette?: () => void;
  paletteOpen?: boolean;
}

/** Returns true if the event target is an editable element (skip shortcuts when typing). */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

export function useKeyboardShortcuts({
  visibleKeys,
  activeTab,
  setActiveTab,
  onRefresh,
  onToggleHelp,
  helpOpen,
  onTogglePalette,
  paletteOpen,
}: KeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K → toggle command palette (always, even while typing)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onTogglePalette?.();
        return;
      }

      // Always allow Escape (close overlays)
      if (e.key === 'Escape') {
        if (paletteOpen) {
          // palette handles its own escape
          return;
        }
        if (helpOpen) {
          e.preventDefault();
          onToggleHelp();
        }
        return;
      }

      // Skip all other shortcuts when user is typing in an input
      if (isTyping(e)) return;

      // Skip if modifier keys are held (avoid clashing with browser/OS shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 1-9 → switch to nth visible tab (1-indexed)
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < visibleKeys.length) {
          e.preventDefault();
          setActiveTab(visibleKeys[idx]);
        }
        return;
      }

      switch (e.key) {
        case '?': {
          e.preventDefault();
          onToggleHelp();
          break;
        }
        case 'r':
        case 'R': {
          e.preventDefault();
          onRefresh();
          break;
        }
        case '/': {
          e.preventDefault();
          // Focus first search or text input in the active tab panel
          const panel = document.querySelector('[role="tabpanel"]');
          const input = panel?.querySelector<HTMLElement>(
            'input[type="search"], input[type="text"], input:not([type])'
          );
          if (input) {
            input.focus();
          }
          break;
        }
      }
    },
    [visibleKeys, activeTab, setActiveTab, onRefresh, onToggleHelp, helpOpen, onTogglePalette, paletteOpen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
