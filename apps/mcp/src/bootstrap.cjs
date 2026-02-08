#!/usr/bin/env node
// Bootstrap script to silence logging before loading ES modules
// MCP uses stdio for JSON-RPC, so we cannot have any stdout output
process.env.LOG_LEVEL = 'silent';
process.env.PINO_LOG_LEVEL = 'silent';

// Dynamic import to load ESM after env is set
(async () => {
  await import('./index.js');
})();
