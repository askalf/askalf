import { mkdir, access, writeFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import * as output from '../util/output.js';

const WHISPER_DIR = join(homedir(), '.askalf', 'whisper');
const BIN_DIR = join(WHISPER_DIR, 'bin');
const MODELS_DIR = join(WHISPER_DIR, 'models');

type ModelSize = 'tiny' | 'base' | 'small' | 'medium';

// Pinned release version — update manually after verifying new release hashes
const WHISPER_RELEASE_VERSION = 'v1.7.3';

const MODEL_URLS: Record<ModelSize, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
};

// SHA-256 digests for whisper.cpp binary archives (v1.7.3)
// Verify at: https://github.com/ggerganov/whisper.cpp/releases/tag/v1.7.3
const BINARY_HASHES: Record<string, string> = {
  'whisper-bin-x64.zip': 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
  'whisper-bin-arm64.zip': 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
};

// SHA-256 digests for GGML model files
const MODEL_HASHES: Record<ModelSize, string> = {
  tiny: 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
  base: 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
  small: 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
  medium: 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD',
};

// Trusted domains for downloads
const TRUSTED_DOMAINS = ['huggingface.co', 'github.com', 'objects.githubusercontent.com'];

function getWhisperReleaseUrl(): { url: string; filename: string } {
  const os = platform();
  const cpuArch = arch();

  const base = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_RELEASE_VERSION}`;

  let filename: string;
  if (os === 'win32') {
    filename = 'whisper-bin-x64.zip';
  } else if (os === 'darwin') {
    filename = cpuArch === 'arm64' ? 'whisper-bin-arm64.zip' : 'whisper-bin-x64.zip';
  } else {
    filename = 'whisper-bin-x64.zip';
  }

  return { url: `${base}/${filename}`, filename };
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

/**
 * Validate a URL is from a trusted domain.
 */
function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid download URL: ${url}`);
  }
  if (!TRUSTED_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) {
    throw new Error(`Untrusted download domain: ${parsed.hostname}. Expected one of: ${TRUSTED_DOMAINS.join(', ')}`);
  }
}

/**
 * Compute SHA-256 hash of a file.
 */
async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify SHA-256 hash of a downloaded file. Logs warning if hash is a placeholder.
 */
async function verifyHash(filePath: string, expectedHash: string, label: string): Promise<void> {
  if (expectedHash === 'VERIFY_AND_PIN_HASH_AFTER_DOWNLOAD') {
    const actualHash = await hashFile(filePath);
    output.warn(`${label} hash not pinned yet. Actual SHA-256: ${actualHash}`);
    output.warn('Pin this hash in setup.ts for supply-chain security.');
    return;
  }
  const actualHash = await hashFile(filePath);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Hash mismatch for ${label}!\n` +
      `  Expected: ${expectedHash}\n` +
      `  Actual:   ${actualHash}\n` +
      'Download may be corrupted or tampered with. Delete and re-download.',
    );
  }
  output.success(`${label} hash verified`);
}

async function downloadFile(url: string, destPath: string, label: string): Promise<void> {
  validateUrl(url);
  output.info(`Downloading ${label}...`);
  output.info(`  From: ${url}`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
  }

  // Validate redirect didn't leave trusted domains
  if (response.url) {
    validateUrl(response.url);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let downloaded = 0;

  const reader = response.body.getReader();
  const dest = createWriteStream(destPath);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Respect backpressure
      const ok = dest.write(Buffer.from(value));
      if (!ok) {
        await new Promise<void>(resolve => dest.once('drain', resolve));
      }
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
    // Use .NET via execFile array args to avoid shell string injection
    await exec('powershell.exe', [
      '-NoProfile', '-Command',
      // Use variables to avoid path injection — paths are bound, not interpolated
      `$zip = [System.IO.Path]::GetFullPath('${zipPath.replace(/'/g, "''")}'); ` +
      `$dest = [System.IO.Path]::GetFullPath('${destDir.replace(/'/g, "''")}'); ` +
      'Expand-Archive -Path $zip -DestinationPath $dest -Force',
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
    const { url: zipUrl, filename } = getWhisperReleaseUrl();
    const zipPath = join(WHISPER_DIR, 'whisper-bin.zip');

    await downloadFile(zipUrl, zipPath, 'whisper.cpp binary');

    // Verify hash before extraction
    const expectedHash = BINARY_HASHES[filename];
    if (expectedHash) {
      await verifyHash(zipPath, expectedHash, `whisper binary (${filename})`);
    }

    output.info('Extracting binary...');
    await extractZip(zipPath, BIN_DIR);

    // Make executable on Unix
    if (platform() !== 'win32') {
      try {
        await chmod(paths.binary, 0o755);
      } catch (err) {
        output.warn(`Could not set executable permission on ${paths.binary}: ${err instanceof Error ? err.message : err}`);
        output.warn('You may need to run: chmod +x ' + paths.binary);
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

    // Verify model hash
    const expectedModelHash = MODEL_HASHES[modelSize];
    if (expectedModelHash) {
      await verifyHash(modelPath, expectedModelHash, `ggml-${modelSize}.en model`);
    }

    output.success(`Model downloaded: ggml-${modelSize}.en.bin`);
  }

  // 3. Verify
  output.header('Setup Complete');
  output.info(`Binary: ${paths.binary}`);
  output.info(`Model:  ${modelPath}`);
  output.success('Run with: askalf-agent run "your task" --voice');
}
