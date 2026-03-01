import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentConfig {
  authMode: 'api_key' | 'oauth';
  apiKey?: string | undefined;
  model: string;
  maxBudgetUsd: number;
  maxTurns: number;
}

const CONFIG_DIR = join(homedir(), '.askalf');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AgentConfig = {
  authMode: 'api_key',
  model: 'claude-sonnet-4-6',
  maxBudgetUsd: 1.0,
  maxTurns: 50,
};

export async function loadConfig(): Promise<AgentConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
  const current = await loadConfig();
  const merged = { ...current, ...config };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
