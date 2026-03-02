import * as output from './output.js';

export interface GuardrailResult {
  blocked: boolean;
  reason?: string;
}

// Patterns that should NEVER be executed — catastrophic/irreversible
const HARD_BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Filesystem destruction
  { pattern: /rm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?(\/|C:\\)($|\s)/i, reason: 'Recursive delete of root filesystem' },
  { pattern: /rm\s+(-[a-z]*r[a-z]*\s+)?(-[a-z]*f[a-z]*\s+)?(\/|C:\\)($|\s)/i, reason: 'Recursive delete of root filesystem' },
  { pattern: /Remove-Item\s+.*(-Recurse|-r)\s.*[\/\\]\s*$/i, reason: 'Recursive delete of root filesystem' },
  { pattern: /format\s+[a-zA-Z]:/i, reason: 'Format disk drive' },
  { pattern: /diskpart/i, reason: 'Direct disk partition manipulation' },

  // Registry destruction
  { pattern: /reg\s+delete\s+HK(LM|CR|CU)\\.*\/f/i, reason: 'Force-delete registry keys' },
  { pattern: /Remove-ItemProperty.*HKLM:/i, reason: 'Delete system registry properties' },

  // System destruction
  { pattern: /bcdedit\s+\/delete/i, reason: 'Delete boot configuration' },
  { pattern: /bcdedit\s+\/set.*safeboot/i, reason: 'Modify boot configuration' },
  { pattern: /shutdown\s+.*\/[srf]/i, reason: 'System shutdown/restart' },
  { pattern: /Restart-Computer/i, reason: 'System restart' },
  { pattern: /Stop-Computer/i, reason: 'System shutdown' },

  // Credential/security
  { pattern: /net\s+user\s+.*\/add/i, reason: 'Create new user account' },
  { pattern: /net\s+localgroup\s+administrators/i, reason: 'Modify administrator group' },
  { pattern: /Set-ExecutionPolicy\s+Unrestricted.*-Force/i, reason: 'Disable PowerShell execution policy' },

  // Network - dangerous
  { pattern: /netsh\s+advfirewall\s+set.*state\s+off/i, reason: 'Disable Windows firewall' },
  { pattern: /netsh\s+firewall\s+set.*disable/i, reason: 'Disable Windows firewall' },

  // Crypto/ransomware patterns
  { pattern: /Cipher\s+\/[wW]/i, reason: 'Wipe deleted file data' },
  { pattern: /ConvertTo-SecureString.*AES/i, reason: 'Bulk file encryption' },
];

// Patterns that should warn but allow (user can see in output)
const WARN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Remove-Item.*-Recurse/i, reason: 'Recursive file deletion' },
  { pattern: /rm\s+-r/i, reason: 'Recursive file deletion' },
  { pattern: /del\s+\/[sS]/i, reason: 'Recursive file deletion' },
  { pattern: /Stop-Process/i, reason: 'Killing a process' },
  { pattern: /taskkill/i, reason: 'Killing a process' },
  { pattern: /Invoke-WebRequest.*\|\s*(iex|Invoke-Expression)/i, reason: 'Downloading and executing remote code' },
  { pattern: /curl.*\|\s*(bash|sh|powershell)/i, reason: 'Downloading and executing remote code' },
  { pattern: /Set-MpPreference.*-DisableRealtimeMonitoring/i, reason: 'Disabling Windows Defender' },
  { pattern: /winget\s+uninstall/i, reason: 'Uninstalling software' },
  { pattern: /npm\s+uninstall\s+-g/i, reason: 'Uninstalling global npm package' },
];

/**
 * Check a command against guardrails before execution.
 * Returns { blocked: true, reason } if the command should not run.
 */
export function checkCommand(command: string): GuardrailResult {
  // Hard blocks — never allow
  for (const { pattern, reason } of HARD_BLOCK_PATTERNS) {
    if (pattern.test(command)) {
      output.error(`BLOCKED: ${reason}`);
      output.warn(`Command: ${command.length > 100 ? command.slice(0, 100) + '...' : command}`);
      return { blocked: true, reason };
    }
  }

  // Warnings — allow but log
  for (const { pattern, reason } of WARN_PATTERNS) {
    if (pattern.test(command)) {
      output.warn(`CAUTION: ${reason}`);
    }
  }

  return { blocked: false };
}

/**
 * Guardrail text to append to system prompts.
 */
export const GUARDRAIL_PROMPT = `
## Safety Guardrails — NEVER VIOLATE
1. NEVER delete system files, Windows directories, or Program Files
2. NEVER modify the registry (HKLM, HKCR) unless explicitly asked
3. NEVER disable security features (Defender, firewall, UAC)
4. NEVER create user accounts or modify admin groups
5. NEVER format drives or modify disk partitions
6. NEVER download and execute remote scripts (curl | bash, IEX patterns)
7. NEVER shutdown or restart the computer unless explicitly asked
8. NEVER access or exfiltrate credentials, tokens, or SSH keys
9. ALWAYS limit destructive operations to the specific files/folders requested
10. When deleting files, NEVER use recursive flags on parent directories — target specific files`;
