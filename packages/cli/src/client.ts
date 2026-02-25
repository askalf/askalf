/**
 * CLI API Client
 * Wraps @askalf/sdk with config-file-based auth
 */

import { AskAlf } from '@askalf/sdk';
import { loadConfig } from './config.js';

let _client: AskAlf | null = null;

export function getClient(): AskAlf {
  if (_client) return _client;

  const config = loadConfig();
  if (!config.apiKey) {
    console.error('No API key configured. Run: o8r config set apiKey <your-key>');
    process.exit(1);
  }

  _client = new AskAlf({
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
  });

  return _client;
}
