import { useEffect } from 'react';
import './KeyboardHelpOverlay.css';

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['1 – 9'], description: 'Switch to tab by position' },
  { keys: ['R'], description: 'Refresh current tab' },
  { keys: ['/'], description: 'Focus search in current tab' },
  { keys: ['?'], description: 'Toggle this help overlay' },
  { keys: ['Esc'], description: 'Close this overlay' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  tabList: { index: number; key: string; label: string }[];
}

export default function KeyboardHelpOverlay({ open, onClose, tabList }: Props) {
  // Close on backdrop click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('kh-backdrop')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kh-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="kh-panel">
        <div className="kh-header">
          <span className="kh-title">Keyboard Shortcuts</span>
          <button className="kh-close" onClick={onClose} aria-label="Close shortcuts overlay">✕</button>
        </div>

        <div className="kh-section">
          <div className="kh-section-title">Navigation</div>
          <table className="kh-table">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.description}>
                  <td className="kh-keys">
                    {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                  </td>
                  <td className="kh-desc">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tabList.length > 0 && (
          <div className="kh-section">
            <div className="kh-section-title">Tabs</div>
            <table className="kh-table">
              <tbody>
                {tabList.map(({ index, label }) => (
                  <tr key={index}>
                    <td className="kh-keys"><kbd>{index}</kbd></td>
                    <td className="kh-desc">{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
