/**
 * CLI API Client
 * Wraps @substrate/sdk with config-file-based auth
 */

import { Orcastr8r } from '@substrate/sdk';
import { loadConfig } from './config.js';

let _client: Orcastr8r | null = null;

export function getClient(): Orcastr8r {
  if (_client) return _client;

  const config = loadConfig();
  if (!config.apiKey) {
    console.error('No API key configured. Run: o8r config set apiKey <your-key>');
    process.exit(1);
  }

  _client = new Orcastr8r({
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
  });

  return _client;
}
