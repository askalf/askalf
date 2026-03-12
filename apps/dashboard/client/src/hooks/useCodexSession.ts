import { useTerminalSession } from './useTerminalSession';
export type { TerminalSessionStatus as CodexSessionStatus, UseTerminalSessionReturn as UseCodexSessionReturn } from './useTerminalSession';

export function useCodexSession() {
  return useTerminalSession('/ws/codex');
}
