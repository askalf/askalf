import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getPlatform, getDisplayServer } from './index.js';

const execFileAsync = promisify(execFile);

export async function takeScreenshot(): Promise<string> {
  const platform = getPlatform();
  const tmpPath = join(tmpdir(), `askalf-ss-${randomBytes(4).toString('hex')}.png`);

  try {
    if (platform === 'darwin') {
      await execFileAsync('screencapture', ['-x', tmpPath]);
    } else if (platform === 'linux') {
      const ds = getDisplayServer();
      if (ds === 'wayland') {
        await execFileAsync('grim', [tmpPath]);
      } else {
        await execFileAsync('scrot', [tmpPath]);
      }
    } else if (platform === 'win32') {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
        $bmp.Save('${tmpPath.replace(/\\/g, '\\\\')}')
        $g.Dispose()
        $bmp.Dispose()
      `;
      await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
    }

    const buffer = await readFile(tmpPath);
    return buffer.toString('base64');
  } finally {
    try { await unlink(tmpPath); } catch { /* ignore */ }
  }
}
