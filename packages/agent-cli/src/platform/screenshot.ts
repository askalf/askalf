import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getPlatform, getDisplayServer } from './index.js';

const execFileAsync = promisify(execFile);

export interface ScreenshotResult {
  data: string;
  mediaType: 'image/png' | 'image/jpeg';
}

export async function takeScreenshot(): Promise<ScreenshotResult> {
  const platform = getPlatform();
  const id = randomBytes(4).toString('hex');
  const tmpPath = join(tmpdir(), `askalf-ss-${id}.png`);

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
      // Capture screenshot as JPEG (resized to 1280px wide) to stay under API 5MB limit
      const jpgPath = join(tmpdir(), `askalf-ss-${id}.jpg`);
      const scriptPath = join(tmpdir(), `askalf-cap-${id}.ps1`);
      const script = [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -AssemblyName System.Drawing',
        '[void][System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")',
        '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
        '$bmp = New-Object Drawing.Bitmap $b.Width,$b.Height',
        '$g = [Drawing.Graphics]::FromImage($bmp)',
        '$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size)',
        '$g.Dispose()',
        '$ratio = [Math]::Min(1.0, 1280.0 / $b.Width)',
        '$nw = [int]($b.Width * $ratio); $nh = [int]($b.Height * $ratio)',
        '$dst = New-Object Drawing.Bitmap $bmp,$nw,$nh',
        '$bmp.Dispose()',
        '$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"',
        '$ep = New-Object Drawing.Imaging.EncoderParameters 1',
        '$ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality, [long]80)',
        `$dst.Save("${jpgPath.replace(/\\/g, '\\\\')}", $codec, $ep)`,
        '$dst.Dispose()',
      ].join('\r\n');
      await writeFile(scriptPath, script, 'utf-8');
      try {
        await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { timeout: 15000 });
        const buffer = await readFile(jpgPath);
        return { data: buffer.toString('base64'), mediaType: 'image/jpeg' };
      } finally {
        try { await unlink(scriptPath); } catch { /* ignore */ }
        try { await unlink(jpgPath); } catch { /* ignore */ }
      }
    }

    const buffer = await readFile(tmpPath);
    return { data: buffer.toString('base64'), mediaType: 'image/png' };
  } finally {
    try { await unlink(tmpPath); } catch { /* ignore */ }
  }
}
