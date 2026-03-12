import { useTerminalSession } from './useTerminalSession';
export type { TerminalSessionStatus as MasterSessionStatus, UseTerminalSessionReturn as UseMasterSessionReturn } from './useTerminalSession';

export function useMasterSession() {
  return useTerminalSession('/ws/master');
}
