import TerminalSession from './TerminalSession';
import type { ProjectInfo } from './TerminalSession';

export type { ProjectInfo };

const MASTER_CONFIG = {
  wsPath: '/ws/master',
  cursorColor: '#a78bfa',
  selectionBackground: 'rgba(167, 139, 250, 0.3)',
  ariaLabel: 'Claude Code terminal',
  restartLabel: 'Restart Claude Code session',
} as const;

export default function MasterSession({ projects, onSetCwd }: { projects?: ProjectInfo[]; onSetCwd?: (cwd: string) => void }) {
  return <TerminalSession config={MASTER_CONFIG} projects={projects} onSetCwd={onSetCwd} />;
}
