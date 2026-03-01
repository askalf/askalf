import { loadConfig } from './util/config.js';
import { runSdkMode } from './sdk-mode.js';
import { runCliMode } from './cli-mode.js';
import * as output from './util/output.js';

export async function run(prompt: string): Promise<void> {
  const config = await loadConfig();

  if (!config.authMode) {
    output.error('Not authenticated. Run: askalf-agent auth');
    process.exit(1);
  }

  if (config.authMode === 'api_key' && !config.apiKey) {
    output.error('No API key configured. Run: askalf-agent auth');
    process.exit(1);
  }

  try {
    let result;

    if (config.authMode === 'api_key') {
      result = await runSdkMode(prompt, config);
    } else {
      result = await runCliMode(prompt, config);
    }

    // Print final output
    if (result.text) {
      output.header('Result');
      console.log(result.text);
    }

    output.cost(
      { input: result.inputTokens, output: result.outputTokens },
      result.costUsd,
      result.turns,
    );
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
