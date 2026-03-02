import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { getWhisperPaths, getModelPath } from './setup.js';

const execAsync = promisify(execFile);

export interface TranscribeResult {
  text: string;
  durationMs: number;
}

export async function transcribe(
  wavBuffer: Buffer,
  modelSize: 'tiny' | 'base' | 'small' | 'medium' = 'base',
): Promise<TranscribeResult> {
  const paths = getWhisperPaths();
  const modelPath = getModelPath(modelSize);

  // Write WAV to temp file with restricted permissions (owner-only) and strong randomness
  const tempWav = join(tmpdir(), `askalf-voice-${randomBytes(16).toString('hex')}.wav`);

  try {
    await writeFile(tempWav, wavBuffer, { mode: 0o600 });

    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(paths.binary, [
      '-m', modelPath,
      '-f', tempWav,
      '--no-timestamps',
      '--language', 'en',
      '--no-prints',        // suppress model info
    ], {
      timeout: 30000, // 30s timeout for transcription
      killSignal: 'SIGKILL', // ensure process is killed on timeout (not just SIGTERM)
    });

    const durationMs = Date.now() - startTime;

    // Check stderr for errors — don't silently use it as transcript
    if (!stdout && stderr) {
      const stderrTrimmed = stderr.trim();
      if (stderrTrimmed) {
        throw new Error(`Whisper transcription failed: ${stderrTrimmed.slice(0, 200)}`);
      }
    }

    // Parse output — whisper prints transcript lines to stdout
    const text = stdout
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => {
        // Skip empty lines and whisper metadata
        if (!line) return false;
        if (line.startsWith('whisper_')) return false;
        if (line.startsWith('main:')) return false;
        if (line.startsWith('system_info:')) return false;
        if (line.startsWith('log_mel_spectrogram')) return false;
        if (line.startsWith('energy:')) return false;
        return true;
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return { text, durationMs };
  } finally {
    try { await unlink(tempWav); } catch { /* ignore */ }
  }
}
