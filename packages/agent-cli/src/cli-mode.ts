import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import * as output from './util/output.js';
import type { AgentConfig } from './util/config.js';
import { VoiceInput } from './voice/index.js';

interface RunResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

export interface CliModeOptions {
  voice?: boolean | undefined;
}

export async function runCliMode(prompt: string, config: AgentConfig, options: CliModeOptions = {}): Promise<RunResult> {
  output.header('AskAlf Agent — Computer Control');
  output.info('Using Claude subscription (no per-token costs)');
  if (options.voice) {
    output.info('Voice mode enabled — speak your commands');
  }
  output.info('Type "exit" or Ctrl+C to quit\n');

  const voiceInput = options.voice ? new VoiceInput(config.voice) : null;

  // Write MCP config pointing to our stdio server
  const mcpConfigPath = join(tmpdir(), `askalf-mcp-${randomBytes(4).toString('hex')}.json`);
  const mcpServerPath = resolve(import.meta.dirname, 'mcp-server.js');

  const mcpConfig = {
    mcpServers: {
      'askalf-computer': {
        command: 'node',
        args: [mcpServerPath],
      },
    },
  };

  await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let totalTurns = 0;
  let currentPrompt = prompt;

  try {
    // Interactive loop
    while (true) {
      output.info(`\n→ ${currentPrompt}\n`);

      const result = await spawnClaude(currentPrompt, config, mcpConfigPath);
      totalTurns += result.turns;

      if (result.text) {
        output.success(result.text.length > 500 ? result.text.slice(0, 500) + '...' : result.text);
      }

      output.info(`(${result.turns} turns)\n`);

      // Prompt for next task
      let next: string;
      if (voiceInput) {
        console.log('\x1b[36m❯ What next?\x1b[0m');
        try {
          next = await voiceInput.listen();
        } catch {
          output.warn('Voice input failed, falling back to keyboard');
          next = await new Promise<string>((res) => {
            rl.question('\x1b[36m❯ What next? (keyboard)\x1b[0m ', (answer) => {
              res(answer.trim());
            });
          });
        }
      } else {
        next = await new Promise<string>((res) => {
          rl.question('\x1b[36m❯ What next?\x1b[0m ', (answer) => {
            res(answer.trim());
          });
        });
      }

      if (!next || next.toLowerCase() === 'exit' || next.toLowerCase() === 'quit') {
        output.info('Session ended.');
        break;
      }

      currentPrompt = next;
    }
  } catch (err) {
    // Handle Ctrl+C gracefully
    if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      output.info('\nSession ended.');
    } else {
      throw err;
    }
  } finally {
    rl.close();
    try { await unlink(mcpConfigPath); } catch { /* ignore */ }
  }

  return {
    text: 'Session ended',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    turns: totalTurns,
  };
}

function spawnClaude(prompt: string, config: AgentConfig, mcpConfigPath: string): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const systemPrompt = [
      'You are a computer control agent with FULL access to this machine.',
      'You can do ANYTHING on this computer — not just coding.',
      'You have PowerShell, CMD, and a screenshot MCP tool.',
      'Use PowerShell commands to: open apps, browse the web, manage files, automate tasks, interact with any application.',
      'Use the screenshot tool when you need to visually verify what is on screen.',
      'Examples: "Start-Process chrome https://amazon.com", "Start-Process notepad", "[System.Windows.Forms.SendKeys]::SendWait(\'text\')".',
      'You are NOT limited to software engineering. Help the user with ANY computer task they ask for.',
    ].join(' ');

    const args = [
      '-p', prompt,
      '--append-system-prompt', systemPrompt,
      '--output-format', 'json',
      '--max-turns', String(config.maxTurns),
      '--mcp-config', mcpConfigPath,
      '--dangerously-skip-permissions',
    ];

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDECODE: '',
      },
    });

    let stdout = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      for (const segment of line.split('\n')) {
        const s = segment.trim();
        if (!s) continue;
        if (s.includes('screenshot') || s.includes('mouse') || s.includes('keyboard') ||
            s.includes('click') || s.includes('type') || s.includes('scroll') ||
            s.includes('tool_use') || s.includes('askalf-computer')) {
          output.action('→', s.length > 120 ? s.slice(0, 120) + '...' : s);
        }
      }
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`Claude exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolvePromise({
          text: parsed.result ?? parsed.content ?? '',
          inputTokens: parsed.usage?.input_tokens ?? parsed.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? parsed.output_tokens ?? 0,
          costUsd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
          turns: parsed.num_turns ?? 0,
        });
      } catch {
        resolvePromise({
          text: stdout.slice(0, 500) || 'Done',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          turns: 0,
        });
      }
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code\n' +
          'Then authenticate: claude auth login'
        ));
      } else {
        reject(err);
      }
    });
  });
}
