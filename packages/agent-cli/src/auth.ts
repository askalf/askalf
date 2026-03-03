import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, saveConfig } from './util/config.js';
import { commandExists } from './platform/index.js';
import * as output from './util/output.js';

const execFileAsync = promisify(execFile);

export async function authInteractive(): Promise<void> {
  // Dynamic import for inquirer (ESM)
  const { default: inquirer } = await import('inquirer');

  const config = await loadConfig();

  output.header('AskAlf Agent — Authentication');

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'How do you want to authenticate?',
    choices: [
      { name: 'Claude Login — use your Claude subscription (recommended, no extra cost)', value: 'oauth' },
      { name: 'API Key — paste your Anthropic API key (pay per use)', value: 'api_key' },
    ],
    default: config.authMode ?? 'oauth',
  }]);

  if (mode === 'api_key') {
    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: 'Anthropic API key:',
      mask: '*',
      validate: (input: string) => {
        if (!input.startsWith('sk-ant-')) return 'API key must start with sk-ant-';
        if (input.length < 20) return 'API key seems too short';
        return true;
      },
    }]);

    await saveConfig({ authMode: 'api_key', apiKey });
    output.success('API key saved. You\'re ready to go!');
    output.info('Run: askalf-agent run "your task here"');
  } else {
    // Check if claude CLI is installed
    const hasClaude = await commandExists('claude');
    if (!hasClaude) {
      output.error('Claude CLI not found.');
      output.info('Install it with: npm i -g @anthropic-ai/claude-code');
      process.exit(1);
    }

    // Check if already logged in
    const loggedIn = await checkClaudeAuth();
    if (loggedIn) {
      output.success('Claude CLI is already authenticated.');
    } else {
      output.info('Opening browser for Claude login...');
      try {
        await execFileAsync('claude', ['auth', 'login']);
        output.success('Claude authentication complete.');
      } catch (err) {
        output.error('Claude auth failed: ' + (err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    }

    await saveConfig({ authMode: 'oauth', apiKey: undefined });
    output.success('OAuth mode configured. You\'re ready to go!');
    output.info('Run: askalf-agent run "your task here"');
  }
}

export async function checkClaudeAuth(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('claude', ['auth', 'status']);
    return stdout.toLowerCase().includes('logged in') || stdout.toLowerCase().includes('authenticated');
  } catch {
    return false;
  }
}

export async function showAuthStatus(): Promise<void> {
  const config = await loadConfig();

  output.header('Authentication Status');

  if (config.authMode === 'api_key') {
    if (config.apiKey) {
      const masked = config.apiKey.slice(0, 7) + '...' + config.apiKey.slice(-4);
      output.success(`Mode: API Key (${masked})`);
    } else {
      output.warn('Mode: API Key — but no key configured');
    }
  } else if (config.authMode === 'oauth') {
    const hasClaude = await commandExists('claude');
    if (!hasClaude) {
      output.warn('Mode: OAuth — but Claude CLI not installed');
    } else {
      const loggedIn = await checkClaudeAuth();
      if (loggedIn) {
        output.success('Mode: Claude OAuth (authenticated)');
      } else {
        output.warn('Mode: Claude OAuth — not logged in. Run: claude auth login');
      }
    }
  } else {
    output.warn('Not configured. Run: askalf-agent auth');
  }

  output.info(`Model: ${config.model}`);
  output.info(`Budget: $${config.maxBudgetUsd.toFixed(2)} / Max turns: ${config.maxTurns}`);
}
