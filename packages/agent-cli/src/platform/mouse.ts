import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatform, getDisplayServer } from './index.js';

const execFileAsync = promisify(execFile);

export type ClickButton = 'left' | 'right' | 'middle';

export async function mouseMove(x: number, y: number): Promise<void> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    await execFileAsync('cliclick', [`m:${x},${y}`]);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      await execFileAsync('ydotool', ['mousemove', '--absolute', '-x', String(x), '-y', String(y)]);
    } else {
      await execFileAsync('xdotool', ['mousemove', String(x), String(y)]);
    }
  } else if (platform === 'win32') {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
    `;
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  }
}

export async function mouseClick(x: number, y: number, button: ClickButton = 'left'): Promise<void> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    const clickMap: Record<ClickButton, string> = { left: 'c', right: 'rc', middle: 'mc' };
    await execFileAsync('cliclick', [`${clickMap[button]}:${x},${y}`]);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      const btnMap: Record<ClickButton, string> = { left: '0xC0', right: '0xC1', middle: '0xC2' };
      await execFileAsync('ydotool', ['mousemove', '--absolute', '-x', String(x), '-y', String(y)]);
      await execFileAsync('ydotool', ['click', btnMap[button]!]);
    } else {
      const btnMap: Record<ClickButton, string> = { left: '1', right: '3', middle: '2' };
      await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', btnMap[button]!]);
    }
  } else if (platform === 'win32') {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseOps {
          [DllImport("user32.dll")] public static extern void SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
        }
"@
      [MouseOps]::SetCursorPos(${x}, ${y})
      Start-Sleep -Milliseconds 50
      ${button === 'left' ? '[MouseOps]::mouse_event(0x02, 0, 0, 0, 0); [MouseOps]::mouse_event(0x04, 0, 0, 0, 0)' :
        button === 'right' ? '[MouseOps]::mouse_event(0x08, 0, 0, 0, 0); [MouseOps]::mouse_event(0x10, 0, 0, 0, 0)' :
        '[MouseOps]::mouse_event(0x20, 0, 0, 0, 0); [MouseOps]::mouse_event(0x40, 0, 0, 0, 0)'}
    `;
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  }
}

export async function mouseDoubleClick(x: number, y: number): Promise<void> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    await execFileAsync('cliclick', [`dc:${x},${y}`]);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      await execFileAsync('ydotool', ['mousemove', '--absolute', '-x', String(x), '-y', String(y)]);
      await execFileAsync('ydotool', ['click', '0xC0', '0xC0']);
    } else {
      await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', '--repeat', '2', '1']);
    }
  } else if (platform === 'win32') {
    await mouseClick(x, y, 'left');
    await new Promise(r => setTimeout(r, 50));
    await mouseClick(x, y, 'left');
  }
}

export async function mouseScroll(x: number, y: number, direction: 'up' | 'down', clicks: number = 3): Promise<void> {
  const platform = getPlatform();

  if (platform === 'darwin') {
    // cliclick doesn't support scroll well, use AppleScript
    const delta = direction === 'up' ? clicks : -clicks;
    await execFileAsync('osascript', ['-e', `
      tell application "System Events"
        set position of mouse to {${x}, ${y}}
        repeat ${Math.abs(delta)} times
          scroll ${direction === 'up' ? 'up' : 'down'}
        end repeat
      end tell
    `]);
  } else if (platform === 'linux') {
    const ds = getDisplayServer();
    if (ds === 'wayland') {
      await execFileAsync('ydotool', ['mousemove', '--absolute', '-x', String(x), '-y', String(y)]);
      const wheelBtn = direction === 'up' ? '0x0F' : '0x10';
      for (let i = 0; i < clicks; i++) {
        await execFileAsync('ydotool', ['click', wheelBtn]);
      }
    } else {
      await execFileAsync('xdotool', ['mousemove', String(x), String(y)]);
      const btn = direction === 'up' ? '4' : '5';
      for (let i = 0; i < clicks; i++) {
        await execFileAsync('xdotool', ['click', btn]);
      }
    }
  } else if (platform === 'win32') {
    const delta = direction === 'up' ? 120 * clicks : -(120 * clicks);
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseScroll {
          [DllImport("user32.dll")] public static extern void SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
        }
"@
      [MouseScroll]::SetCursorPos(${x}, ${y})
      [MouseScroll]::mouse_event(0x0800, 0, 0, ${delta}, 0)
    `;
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  }
}
