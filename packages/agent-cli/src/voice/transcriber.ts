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

  // Write WAV to temp file (whisper.cpp reads from file)
  const tempWav = join(tmpdir(), `askalf-voice-${randomBytes(4).toString('hex')}.wav`);

  try {
    await writeFile(tempWav, wavBuffer);

    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(paths.binary, [
      '-m', modelPath,
      '-f', tempWav,
      '--no-timestamps',
      '--language', 'en',
      '--no-prints',        // suppress model info
    ], {
      timeout: 30000, // 30s timeout for transcription
    });

    const durationMs = Date.now() - startTime;

    // Parse output — whisper prints transcript lines to stdout
    // Each line may have leading whitespace and brackets
    const text = (stdout || stderr)
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => {
        // Skip empty lines and whisper metadata
        if (!line) return false;
        if (line.startsWith('whisper_')) return false;
        if (line.startsWith('main:')) return false;
        if (line.startsWith('system_info:')) return false;
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
