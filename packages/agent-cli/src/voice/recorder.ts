import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { randomBytes } from 'node:crypto';
import * as output from '../util/output.js';

export interface RecordingResult {
  buffer: Buffer;
  durationMs: number;
}

interface RecorderOptions {
  silenceThresholdDb: number;  // dB below which is "silence" (e.g. -40)
  silenceDurationMs: number;   // how long silence must last to stop (e.g. 1500)
  maxDurationMs: number;       // safety cap (e.g. 60000)
  sampleRate: number;          // 16000 Hz
}

const DEFAULT_OPTIONS: RecorderOptions = {
  silenceThresholdDb: -40,
  silenceDurationMs: 1500,
  maxDurationMs: 60000,
  sampleRate: 16000,
};

// Allowlist of commands we check for — prevents injection via hasCommand
const ALLOWED_COMMANDS = new Set(['ffmpeg', 'sox', 'rec', 'arecord']);

/**
 * Calculate RMS energy of a PCM16 mono buffer chunk, return dB.
 */
function pcmToDb(chunk: Buffer): number {
  let sumSquares = 0;
  const samples = chunk.length / 2; // 16-bit = 2 bytes per sample
  if (samples === 0) return -Infinity;

  for (let i = 0; i < chunk.length - 1; i += 2) {
    const sample = chunk.readInt16LE(i);
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / samples);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms / 32768); // normalize to 16-bit max
}

/**
 * Build a WAV header for PCM16 mono audio.
 */
function buildWavHeader(dataLength: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);       // PCM format chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Check if a command exists on this system.
 * Only checks allowlisted command names — prevents injection.
 */
function hasCommand(cmd: string): boolean {
  if (!ALLOWED_COMMANDS.has(cmd)) return false;

  try {
    if (platform() === 'win32') {
      // Use execFileSync to avoid shell interpretation
      execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        `Get-Command '${cmd}' -ErrorAction Stop`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate sample rate is a safe integer for interpolation.
 */
function validateSampleRate(sampleRate: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 192000) {
    throw new Error(`Invalid sample rate: ${sampleRate}. Must be a positive integer <= 192000.`);
  }
}

/**
 * Generate a PowerShell script that records audio using Windows waveIn API.
 * Writes raw PCM16 mono to stdout. No external dependencies needed.
 */
function createWindowsRecordScript(sampleRate: number): string {
  validateSampleRate(sampleRate);

  // Use 16 bytes of randomness and exclusive file creation to prevent TOCTOU
  const scriptPath = join(tmpdir(), `askalf-record-${randomBytes(16).toString('hex')}.ps1`);
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public class WaveRec {
    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr phwi, uint uDeviceID, ref WAVEFORMATEX lpFormat, IntPtr dwCallback, IntPtr dwInstance, uint fdwOpen);
    [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr hwi, ref WAVEHDR lpWaveHdr, uint uSize);
    [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr hwi, ref WAVEHDR lpWaveHdr, uint uSize);
    [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr hwi, ref WAVEHDR lpWaveHdr, uint uSize);
    [DllImport("winmm.dll")] static extern int waveInStart(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int waveInStop(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int waveInReset(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int waveInClose(IntPtr hwi);

    const uint WAVE_MAPPER = 0xFFFFFFFF;
    const uint WHDR_DONE = 1;

    public static void Record(int sampleRate) {
        var fmt = new WAVEFORMATEX {
            wFormatTag = 1, nChannels = 1,
            nSamplesPerSec = (uint)sampleRate,
            nAvgBytesPerSec = (uint)(sampleRate * 2),
            nBlockAlign = 2, wBitsPerSample = 16, cbSize = 0
        };

        IntPtr hwi;
        int r = waveInOpen(out hwi, WAVE_MAPPER, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
        if (r != 0) { Console.Error.WriteLine("waveInOpen failed: " + r); return; }

        // Double-buffering: 2 buffers of 0.5s each
        int bufSize = sampleRate; // 0.5s at 16-bit mono = sampleRate bytes
        var bufs = new byte[2][];
        var handles = new GCHandle[2];
        var hdrs = new WAVEHDR[2];

        for (int i = 0; i < 2; i++) {
            bufs[i] = new byte[bufSize];
            handles[i] = GCHandle.Alloc(bufs[i], GCHandleType.Pinned);
            hdrs[i] = new WAVEHDR {
                lpData = handles[i].AddrOfPinnedObject(),
                dwBufferLength = (uint)bufSize
            };
            waveInPrepareHeader(hwi, ref hdrs[i], (uint)Marshal.SizeOf(typeof(WAVEHDR)));
            waveInAddBuffer(hwi, ref hdrs[i], (uint)Marshal.SizeOf(typeof(WAVEHDR)));
        }

        waveInStart(hwi);
        var stdout = Console.OpenStandardOutput();
        int maxChunks = 120; // 60s at 0.5s per chunk

        for (int c = 0; c < maxChunks; c++) {
            int idx = c % 2;
            // Wait for buffer to be filled
            while ((hdrs[idx].dwFlags & WHDR_DONE) == 0) Thread.Sleep(10);

            int recorded = (int)hdrs[idx].dwBytesRecorded;
            if (recorded > 0) {
                stdout.Write(bufs[idx], 0, recorded);
                stdout.Flush();
            }

            // Re-queue buffer
            hdrs[idx].dwFlags = 0;
            hdrs[idx].dwBytesRecorded = 0;
            waveInAddBuffer(hwi, ref hdrs[idx], (uint)Marshal.SizeOf(typeof(WAVEHDR)));
        }

        waveInStop(hwi);
        waveInReset(hwi);
        for (int i = 0; i < 2; i++) {
            waveInUnprepareHeader(hwi, ref hdrs[i], (uint)Marshal.SizeOf(typeof(WAVEHDR)));
            handles[i].Free();
        }
        waveInClose(hwi);
    }
}
'@
[WaveRec]::Record(${sampleRate})
`;

  // Exclusive file creation (wx flag) — prevents symlink/overwrite attacks
  const fd = openSync(scriptPath, 'wx', 0o600);
  try {
    writeFileSync(fd, script, 'utf-8');
  } finally {
    closeSync(fd);
  }
  return scriptPath;
}

/**
 * Get the microphone recording command for the current platform.
 * Returns [command, args] that outputs raw PCM16 mono to stdout.
 * On Windows, uses native waveIn API via PowerShell (no SoX needed).
 */
function getMicCommand(sampleRate: number): [string, string[]] {
  validateSampleRate(sampleRate);
  const os = platform();

  if (os === 'win32') {
    // Prefer ffmpeg if available, else sox, else native PowerShell waveIn
    if (hasCommand('ffmpeg')) {
      return ['ffmpeg', [
        '-f', 'dshow', '-i', 'audio=@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave:{00000000-0000-0000-0000-000000000000}',
        '-ar', String(sampleRate), '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
      ]];
    }
    if (hasCommand('sox')) {
      return ['sox', ['-d', '-t', 'raw', '-r', String(sampleRate), '-e', 'signed-integer', '-b', '16', '-c', '1', '-']];
    }
    // Native Windows: PowerShell + winmm.dll waveIn API
    const scriptPath = createWindowsRecordScript(sampleRate);
    return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]];
  } else if (os === 'darwin') {
    // SoX on macOS
    return ['rec', [
      '-t', 'raw',
      '-r', String(sampleRate),
      '-e', 'signed-integer',
      '-b', '16',
      '-c', '1',
      '-',                    // stdout
      'trim', '0', '60',     // max 60s
    ]];
  } else {
    // arecord on Linux (ALSA)
    return ['arecord', [
      '-f', 'S16_LE',
      '-r', String(sampleRate),
      '-c', '1',
      '-t', 'raw',
      '-q',                   // quiet
    ]];
  }
}

export class MicRecorder {
  private process: ChildProcess | null = null;
  private options: RecorderOptions;
  private stopped = false;

  constructor(options: Partial<RecorderOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Record from microphone until silence is detected or Enter is pressed.
   */
  async record(): Promise<RecordingResult> {
    const { sampleRate, silenceThresholdDb, silenceDurationMs, maxDurationMs } = this.options;
    this.stopped = false;

    const [cmd, args] = getMicCommand(sampleRate);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = sampleRate * 2 * (maxDurationMs / 1000) * 1.1; // 10% headroom
    const startTime = Date.now();
    let silenceStart: number | null = null;

    // Track cleanup state to prevent stdin raw mode leak
    let cleanedUp = false;

    const onKeypress = (data: Buffer) => {
      if (data.toString().includes('\n') || data.toString().includes('\r')) {
        this.stop();
        cleanup();
      }
    };

    const setupStdin = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onKeypress);
      }
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (process.stdin.isTTY) {
        process.stdin.removeListener('data', onKeypress);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    };

    return new Promise<RecordingResult>((resolve, reject) => {
      this.process = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'ignore'], // stderr ignored — prevents child deadlock
      });

      this.process.on('error', (err) => {
        cleanup(); // Ensure stdin raw mode is restored on error
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          const hint = platform() === 'darwin'
            ? 'Install SoX: brew install sox'
            : platform() === 'win32'
              ? 'PowerShell failed to start. Ensure PowerShell is available.'
              : 'arecord should be pre-installed (ALSA). Try: sudo apt install alsa-utils';
          reject(new Error(`Microphone capture failed (${cmd}). ${hint}`));
        } else {
          reject(err);
        }
      });

      this.process.stdout!.on('data', (data: Buffer) => {
        if (this.stopped) return;
        chunks.push(data);
        totalBytes += data.length;

        // Check for silence
        const db = pcmToDb(data);

        if (db < silenceThresholdDb) {
          if (silenceStart === null) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart >= silenceDurationMs) {
            output.info('Silence detected, stopping...');
            this.stop();
          }
        } else {
          silenceStart = null; // reset on non-silence
        }

        // Safety caps — time and bytes
        if (Date.now() - startTime >= maxDurationMs) {
          output.warn('Max recording duration reached (60s)');
          this.stop();
        }
        if (totalBytes > maxBytes) {
          output.warn('Max recording size reached');
          this.stop();
        }
      });

      setupStdin();

      this.process.on('close', () => {
        cleanup();
        // Clean up temp PowerShell script if used
        if (cmd === 'powershell.exe' && args.includes('-File')) {
          const scriptIdx = args.indexOf('-File');
          if (scriptIdx >= 0 && args[scriptIdx + 1]) {
            try { unlinkSync(args[scriptIdx + 1]!); } catch { /* ignore */ }
          }
        }
        const pcmData = Buffer.concat(chunks);
        const durationMs = Date.now() - startTime;

        if (pcmData.length === 0) {
          resolve({ buffer: Buffer.alloc(0), durationMs: 0 });
          return;
        }

        // Wrap raw PCM in WAV header
        const wavHeader = buildWavHeader(pcmData.length, sampleRate);
        const wavBuffer = Buffer.concat([wavHeader, pcmData]);

        resolve({ buffer: wavBuffer, durationMs });
      });
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.process && !this.process.killed) {
      const proc = this.process;
      this.process = null;
      proc.kill('SIGTERM');
    }
  }
}
