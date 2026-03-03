import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface VoiceOptions {
  whisperModel: 'tiny' | 'base' | 'small' | 'medium';
  silenceThresholdDb: number;
  silenceDurationMs: number;
}

export interface AgentConfig {
  authMode: 'api_key' | 'oauth';
  apiKey?: string | undefined;
  model: string;
  maxBudgetUsd: number;
  maxTurns: number;
  voice?: VoiceOptions;
  /** Platform WebSocket URL for bridge connection */
  platformUrl?: string;
  /** Device token (API key) for authenticating with the platform */
  deviceToken?: string;
  /** Persistent device ID assigned by the platform on first registration */
  deviceId?: string;
}

const CONFIG_DIR = join(homedir(), '.askalf');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AgentConfig = {
  authMode: 'oauth',
  model: 'claude-sonnet-4-6',
  maxBudgetUsd: 5.0,
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
