import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatform, getDisplayServer } from './index.js';

const execFileAsync = promisify(execFile);

export interface ScreenSize {
  width: number;
  height: number;
}

export async function getScreenSize(): Promise<ScreenSize> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    return getScreenSizeMac();
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    return ds === 'wayland' ? getScreenSizeWayland() : getScreenSizeX11();
  } else if (platform === 'win32') {
    return getScreenSizeWindows();
  }

  return { width: 1920, height: 1080 }; // fallback
}

async function getScreenSizeMac(): Promise<ScreenSize> {
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPDisplaysDataType', '-json']);
    const data = JSON.parse(stdout);
    const displays = data?.SPDisplaysDataType?.[0]?.spdisplays_ndrvs;
    if (displays?.[0]) {
      const res = displays[0]._spdisplays_resolution as string;
      const match = res?.match(/(\d+)\s*x\s*(\d+)/);
      if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
    }
  } catch { /* fallback */ }
  return { width: 1920, height: 1080 };
}

async function getScreenSizeX11(): Promise<ScreenSize> {
  try {
    const { stdout } = await execFileAsync('xrandr', ['--current']);
    const match = stdout.match(/current\s+(\d+)\s*x\s*(\d+)/);
    if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  } catch { /* fallback */ }
  return { width: 1920, height: 1080 };
}

async function getScreenSizeWayland(): Promise<ScreenSize> {
  try {
    // Try wlr-randr first
    const { stdout } = await execFileAsync('wlr-randr');
    const match = stdout.match(/(\d+)x(\d+)/);
    if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  } catch { /* fallback */ }
  return { width: 1920, height: 1080 };
}

async function getScreenSizeWindows(): Promise<ScreenSize> {
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      "$($s.Width)x$($s.Height)"
    `;
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
    const match = stdout.trim().match(/(\d+)x(\d+)/);
    if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  } catch { /* fallback */ }
  return { width: 1920, height: 1080 };
}
