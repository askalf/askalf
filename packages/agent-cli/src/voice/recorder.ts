import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
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
 * Get the microphone recording command for the current platform.
 * Returns [command, args] that outputs raw PCM16 mono to stdout.
 */
function getMicCommand(sampleRate: number): [string, string[]] {
  const os = platform();

  if (os === 'win32') {
    // SoX (sox / rec) on Windows
    return ['sox', [
      '-d',                    // default input device
      '-t', 'raw',            // raw output
      '-r', String(sampleRate),
      '-e', 'signed-integer',
      '-b', '16',             // 16-bit
      '-c', '1',              // mono
      '-',                    // stdout
    ]];
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
    const startTime = Date.now();
    let silenceStart: number | null = null;

    return new Promise<RecordingResult>((resolve, reject) => {
      this.process = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          const hint = platform() === 'darwin'
            ? 'Install SoX: brew install sox'
            : platform() === 'win32'
              ? 'Install SoX: download from https://sox.sourceforge.net/'
              : 'arecord should be pre-installed (ALSA). Try: sudo apt install alsa-utils';
          reject(new Error(`Microphone capture tool not found (${cmd}). ${hint}`));
        } else {
          reject(err);
        }
      });

      this.process.stdout!.on('data', (data: Buffer) => {
        if (this.stopped) return;
        chunks.push(data);

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

        // Safety cap
        if (Date.now() - startTime >= maxDurationMs) {
          output.warn('Max recording duration reached (60s)');
          this.stop();
        }
      });

      // Also listen for Enter key to stop
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
        if (process.stdin.isTTY) {
          process.stdin.removeListener('data', onKeypress);
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }
      };

      setupStdin();

      this.process.on('close', () => {
        cleanup();
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
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}
