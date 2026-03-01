import { loadConfig } from './util/config.js';
import { runSdkMode } from './sdk-mode.js';
import { runCliMode } from './cli-mode.js';
import { commandExists } from './platform/index.js';
import * as output from './util/output.js';

export interface RunOptions {
  voice?: boolean;
}

export async function run(prompt: string, options: RunOptions = {}): Promise<void> {
  const config = await loadConfig();

  // Auto-detect auth mode
  if (config.authMode === 'oauth') {
    const hasClaude = await commandExists('claude');
    if (!hasClaude) {
      if (config.apiKey) {
        output.warn('Claude CLI not found. Falling back to SDK mode (API key).');
        config.authMode = 'api_key';
      } else {
        output.error('Claude CLI not found. Install it: npm i -g @anthropic-ai/claude-code');
        output.info('Or switch to API key mode: askalf-agent auth');
        process.exit(1);
      }
    }
  }

  if (config.authMode === 'api_key' && !config.apiKey) {
    output.error('No API key configured. Run: askalf-agent auth');
    process.exit(1);
  }

  try {
    if (config.authMode === 'oauth') {
      // CLI mode handles its own interactive loop and output
      await runCliMode(prompt, config, { voice: options.voice });
    } else {
      const result = await runSdkMode(prompt, config);
      if (result.text) {
        output.header('Result');
        console.log(result.text);
      }
      output.cost(
        { input: result.inputTokens, output: result.outputTokens },
        result.costUsd,
        result.turns,
      );
    }
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
