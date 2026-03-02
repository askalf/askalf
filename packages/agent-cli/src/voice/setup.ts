import { mkdir, access, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as output from '../util/output.js';

const WHISPER_DIR = join(homedir(), '.askalf', 'whisper');
const BIN_DIR = join(WHISPER_DIR, 'bin');
const MODELS_DIR = join(WHISPER_DIR, 'models');

type ModelSize = 'tiny' | 'base' | 'small' | 'medium';

const MODEL_URLS: Record<ModelSize, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
};

function getWhisperReleaseUrl(): string {
  const os = platform();
  const cpuArch = arch();

  // whisper.cpp GitHub releases — pre-built binaries
  const base = 'https://github.com/ggerganov/whisper.cpp/releases/latest/download';

  if (os === 'win32') {
    return `${base}/whisper-bin-x64.zip`;
  } else if (os === 'darwin') {
    return cpuArch === 'arm64'
      ? `${base}/whisper-bin-arm64.zip`
      : `${base}/whisper-bin-x64.zip`;
  } else {
    // Linux
    return `${base}/whisper-bin-x64.zip`;
  }
}

function getWhisperBinaryName(): string {
  return platform() === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

export function getWhisperPaths() {
  const modelSize = 'base'; // default
  // whisper.cpp zip extracts into a Release/ subfolder on Windows
  const binSubdir = platform() === 'win32' ? join(BIN_DIR, 'Release') : BIN_DIR;
  return {
    binDir: BIN_DIR,
    modelsDir: MODELS_DIR,
    binary: join(binSubdir, getWhisperBinaryName()),
    model: join(MODELS_DIR, `ggml-${modelSize}.en.bin`),
  };
}

export function getModelPath(modelSize: ModelSize = 'base'): string {
  return join(MODELS_DIR, `ggml-${modelSize}.en.bin`);
}

export async function isWhisperInstalled(): Promise<boolean> {
  const paths = getWhisperPaths();
  try {
    await access(paths.binary);
    await access(paths.model);
    return true;
  } catch {
    return false;
  }
}

export async function isModelDownloaded(modelSize: ModelSize = 'base'): Promise<boolean> {
  try {
    await access(getModelPath(modelSize));
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url: string, destPath: string, label: string): Promise<void> {
  output.info(`Downloading ${label}...`);
  output.info(`  From: ${url}`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let downloaded = 0;

  // Create a transform to track progress
  const reader = response.body.getReader();
  const dest = createWriteStream(destPath);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      dest.write(Buffer.from(value));
      downloaded += value.byteLength;

      if (totalBytes > 0) {
        const pct = Math.round((downloaded / totalBytes) * 100);
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r  Progress: ${mb}MB / ${totalMb}MB (${pct}%)`);
      }
    }
    console.log(); // newline after progress
  } finally {
    dest.end();
    await new Promise<void>((resolve, reject) => {
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  const os = platform();

  if (os === 'win32') {
    // Use PowerShell to extract
    await exec('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ]);
  } else {
    await exec('unzip', ['-o', zipPath, '-d', destDir]);
  }
}

export async function setupWhisper(modelSize: ModelSize = 'base'): Promise<void> {
  output.header('Voice Setup — whisper.cpp');

  // Create directories
  await mkdir(BIN_DIR, { recursive: true });
  await mkdir(MODELS_DIR, { recursive: true });

  const paths = getWhisperPaths();

  // 1. Download whisper binary
  let hasBinary = false;
  try {
    await access(paths.binary);
    hasBinary = true;
    output.success(`Whisper binary already exists: ${paths.binary}`);
  } catch {
    // Need to download
  }

  if (!hasBinary) {
    const zipUrl = getWhisperReleaseUrl();
    const zipPath = join(WHISPER_DIR, 'whisper-bin.zip');

    await downloadFile(zipUrl, zipPath, 'whisper.cpp binary');
    output.info('Extracting binary...');
    await extractZip(zipPath, BIN_DIR);

    // Make executable on Unix
    if (platform() !== 'win32') {
      try {
        await chmod(paths.binary, 0o755);
      } catch {
        // May not exist at expected path — user may need to find it
      }
    }

    // Clean up zip
    const { unlink } = await import('node:fs/promises');
    try { await unlink(zipPath); } catch { /* ignore */ }

    output.success('Whisper binary installed');
  }

  // 2. Download model
  const modelPath = getModelPath(modelSize);
  const hasModel = await isModelDownloaded(modelSize);

  if (hasModel) {
    output.success(`Model already exists: ggml-${modelSize}.en.bin`);
  } else {
    const modelUrl = MODEL_URLS[modelSize];
    if (!modelUrl) {
      throw new Error(`Unknown model size: ${modelSize}. Choose: tiny, base, small, medium`);
    }
    await downloadFile(modelUrl, modelPath, `ggml-${modelSize}.en model`);
    output.success(`Model downloaded: ggml-${modelSize}.en.bin`);
  }

  // 3. Verify
  output.header('Setup Complete');
  output.info(`Binary: ${paths.binary}`);
  output.info(`Model:  ${modelPath}`);
  output.success('Run with: askalf-agent run "your task" --voice');
}
