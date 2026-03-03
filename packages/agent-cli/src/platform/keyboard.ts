import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatform, getDisplayServer } from './index.js';

const execFileAsync = promisify(execFile);

export async function keyboardType(text: string): Promise<void> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    // cliclick t: for typing text
    await execFileAsync('cliclick', [`t:${text}`]);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      await execFileAsync('ydotool', ['type', '--', text]);
    } else {
      await execFileAsync('xdotool', ['type', '--clearmodifiers', '--', text]);
    }
  } else if (platform === 'win32') {
    // Escape special SendKeys characters
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}');
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
    `;
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  }
}

// Key combo mapping: Claude sends keys like "ctrl+c", "Return", "space", etc.
const KEY_MAP_XDOTOOL: Record<string, string> = {
  return: 'Return', enter: 'Return',
  tab: 'Tab', escape: 'Escape', space: 'space',
  backspace: 'BackSpace', delete: 'Delete',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next',
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
  ctrl: 'ctrl', alt: 'alt', shift: 'shift', super: 'super', meta: 'super',
  cmd: 'super', command: 'super', win: 'super',
};

const KEY_MAP_CLICLICK: Record<string, string> = {
  return: 'return', enter: 'return',
  tab: 'tab', escape: 'escape', space: 'space',
  backspace: 'delete', delete: 'fwd-delete',
  up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right',
  home: 'home', end: 'end', pageup: 'page-up', pagedown: 'page-down',
  f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
  f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
};

const KEY_MAP_WIN: Record<string, string> = {
  return: '{ENTER}', enter: '{ENTER}',
  tab: '{TAB}', escape: '{ESC}', space: ' ',
  backspace: '{BACKSPACE}', delete: '{DELETE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  ctrl: '^', alt: '%', shift: '+',
};

export async function keyboardKey(combo: string): Promise<void> {
  const platform = getPlatform();
  const parts = combo.toLowerCase().split('+').map(p => p.trim());

  if (platform === 'darwin') {
    await keyPressMac(parts);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      await keyPressYdotool(parts);
    } else {
      await keyPressXdotool(parts);
    }
  } else if (platform === 'win32') {
    await keyPressWindows(parts);
  }
}

async function keyPressMac(parts: string[]): Promise<void> {
  // Build cliclick key press command
  const modifiers: string[] = [];
  let key = '';

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') modifiers.push('ctrl');
    else if (part === 'alt' || part === 'option') modifiers.push('alt');
    else if (part === 'shift') modifiers.push('shift');
    else if (part === 'cmd' || part === 'command' || part === 'meta' || part === 'super') modifiers.push('cmd');
    else key = KEY_MAP_CLICLICK[part] ?? part;
  }

  if (key) {
    const modStr = modifiers.length > 0 ? modifiers.join(',') + ' ' : '';
    // cliclick kp:modifier key
    await execFileAsync('cliclick', [`kp:${modStr}${key}`]);
  }
}

async function keyPressXdotool(parts: string[]): Promise<void> {
  const mapped = parts.map(p => KEY_MAP_XDOTOOL[p] ?? p);
  await execFileAsync('xdotool', ['key', mapped.join('+')]);
}

async function keyPressYdotool(parts: string[]): Promise<void> {
  // ydotool uses kernel keycodes — simplified approach using xdotool key names
  // For full ydotool support, would need keycode mapping
  const mapped = parts.map(p => KEY_MAP_XDOTOOL[p] ?? p);
  await execFileAsync('ydotool', ['key', mapped.join('+')]);
}

async function keyPressWindows(parts: string[]): Promise<void> {
  const hasWinKey = parts.some(p => ['super', 'meta', 'win', 'cmd', 'command'].includes(p));

  if (hasWinKey) {
    // SendKeys doesn't support Windows key — use WScript.Shell SendKeys via COM
    // or use C# interop with keybd_event
    const otherKeys = parts.filter(p => !['super', 'meta', 'win', 'cmd', 'command'].includes(p));
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class WinKey {
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
          public const byte VK_LWIN = 0x5B;
          public const uint KEYEVENTF_KEYUP = 0x0002;
        }
"@
      [WinKey]::keybd_event([WinKey]::VK_LWIN, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 100
      ${otherKeys.length > 0 ? `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${otherKeys.map(k => KEY_MAP_WIN[k] ?? k).join('').replace(/'/g, "''")}')
      ` : ''}
      [WinKey]::keybd_event([WinKey]::VK_LWIN, 0, [WinKey]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    `;
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
    return;
  }

  let sendKeys = '';
  let mainKey = '';

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') sendKeys += '^';
    else if (part === 'alt') sendKeys += '%';
    else if (part === 'shift') sendKeys += '+';
    else mainKey = KEY_MAP_WIN[part] ?? part;
  }

  sendKeys += mainKey.length === 1 ? mainKey : (KEY_MAP_WIN[parts[parts.length - 1]!] ?? `{${parts[parts.length - 1]!.toUpperCase()}}`);

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${sendKeys.replace(/'/g, "''")}')
  `;
  await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
}
