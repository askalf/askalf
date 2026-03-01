import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type Platform = 'darwin' | 'linux' | 'win32';
export type DisplayServer = 'x11' | 'wayland' | 'quartz' | 'win32';

export function getPlatform(): Platform {
  return process.platform as Platform;
}

export function getDisplayServer(): DisplayServer {
  const platform = getPlatform();
  if (platform === 'darwin') return 'quartz';
  if (platform === 'win32') return 'win32';
  // Linux: check for Wayland
  if (process.env['WAYLAND_DISPLAY']) return 'wayland';
  return 'x11';
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const which = getPlatform() === 'win32' ? 'where' : 'which';
    await execFileAsync(which, [cmd]);
    return true;
  } catch {
    return false;
  }
}

export interface PlatformCheck {
  platform: Platform;
  displayServer: DisplayServer;
  screenshot: { available: boolean; tool: string };
  mouse: { available: boolean; tool: string };
  keyboard: { available: boolean; tool: string };
  claudeCli: boolean;
  missingDeps: string[];
  installHint: string;
}

export async function checkPlatform(): Promise<PlatformCheck> {
  const platform = getPlatform();
  const displayServer = getDisplayServer();
  const missing: string[] = [];

  let screenshotTool = '';
  let screenshotAvail = false;
  let mouseTool = '';
  let mouseAvail = false;
  let keyboardTool = '';
  let keyboardAvail = false;

  if (platform === 'darwin') {
    screenshotTool = 'screencapture';
    screenshotAvail = true; // built-in
    mouseTool = 'cliclick';
    mouseAvail = await commandExists('cliclick');
    keyboardTool = 'cliclick';
    keyboardAvail = mouseAvail;
    if (!mouseAvail) missing.push('cliclick');
  } else if (platform === 'linux') {
    if (displayServer === 'wayland') {
      screenshotTool = 'grim';
      screenshotAvail = await commandExists('grim');
      if (!screenshotAvail) missing.push('grim');
      mouseTool = 'ydotool';
      mouseAvail = await commandExists('ydotool');
      keyboardTool = 'ydotool';
      keyboardAvail = mouseAvail;
      if (!mouseAvail) missing.push('ydotool');
    } else {
      screenshotTool = 'scrot';
      screenshotAvail = await commandExists('scrot');
      if (!screenshotAvail) missing.push('scrot');
      mouseTool = 'xdotool';
      mouseAvail = await commandExists('xdotool');
      keyboardTool = 'xdotool';
      keyboardAvail = mouseAvail;
      if (!mouseAvail) missing.push('xdotool');
    }
  } else if (platform === 'win32') {
    screenshotTool = 'powershell';
    screenshotAvail = true; // PowerShell built-in
    mouseTool = 'powershell';
    mouseAvail = true;
    keyboardTool = 'powershell';
    keyboardAvail = true;
  }

  const claudeCli = await commandExists('claude');

  let installHint = '';
  if (missing.length > 0) {
    if (platform === 'darwin') {
      installHint = `brew install ${missing.join(' ')}`;
    } else if (platform === 'linux') {
      installHint = `sudo apt install ${missing.join(' ')}`;
    }
  }

  return {
    platform,
    displayServer,
    screenshot: { available: screenshotAvail, tool: screenshotTool },
    mouse: { available: mouseAvail, tool: mouseTool },
    keyboard: { available: keyboardAvail, tool: keyboardTool },
    claudeCli,
    missingDeps: missing,
    installHint,
  };
}
