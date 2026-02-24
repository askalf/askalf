/**
 * CLI Configuration
 * Reads from ~/.o8r/config.yaml or environment variables
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

export interface CliConfig {
  apiUrl: string;
  apiKey: string;
}

const CONFIG_DIR = join(homedir(), '.o8r');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  // Environment variables take precedence
  const envUrl = process.env['O8R_API_URL'];
  const envKey = process.env['O8R_API_KEY'];

  let fileConfig: Partial<CliConfig> = {};

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = parse(raw) as Partial<CliConfig>;
    } catch {
      // Ignore parse errors
    }
  }

  return {
    apiUrl: envUrl ?? fileConfig.apiUrl ?? 'https://orcastr8r.com',
    apiKey: envKey ?? fileConfig.apiKey ?? '',
  };
}

export function saveConfig(updates: Partial<CliConfig>): void {
  ensureDir();
  const current = loadConfig();
  const merged = { ...current, ...updates };
  writeFileSync(CONFIG_FILE, stringify(merged), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
