import TerminalSession from './TerminalSession';
import type { ProjectInfo } from './TerminalSession';

const CODEX_CONFIG = {
  wsPath: '/ws/codex',
  cursorColor: '#10b981',
  selectionBackground: 'rgba(16, 185, 129, 0.3)',
  extraClassName: 'ud-codex-session',
  ariaLabel: 'Codex terminal',
  restartLabel: 'Restart Codex session',
} as const;

export default function CodexSession({ projects, onSetCwd }: { projects?: ProjectInfo[]; onSetCwd?: (cwd: string) => void }) {
  return <TerminalSession config={CODEX_CONFIG} projects={projects} onSetCwd={onSetCwd} />;
}
