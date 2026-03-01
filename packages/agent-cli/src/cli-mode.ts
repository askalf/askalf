import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as output from './util/output.js';
import type { AgentConfig } from './util/config.js';

interface RunResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

export async function runCliMode(prompt: string, config: AgentConfig): Promise<RunResult> {
  output.header('CLI Mode — Claude + MCP Computer Tools');
  output.info(`Model: ${config.model} | Max turns: ${config.maxTurns}`);
  output.info(`Budget: $${config.maxBudgetUsd.toFixed(2)}`);

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

  try {
    const result = await spawnClaude(prompt, config, mcpConfigPath);
    return result;
  } finally {
    try { await unlink(mcpConfigPath); } catch { /* ignore */ }
  }
}

function spawnClaude(prompt: string, config: AgentConfig, mcpConfigPath: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Write prompt to temp file to avoid shell escaping issues
    const promptPath = join(tmpdir(), `askalf-prompt-${randomBytes(4).toString('hex')}.txt`);

    writeFile(promptPath, prompt).then(() => {
      const args = [
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', String(config.maxTurns),
        '--mcp-config', mcpConfigPath,
        '--dangerously-skip-permissions',
        '--model', config.model,
      ];

      if (config.maxBudgetUsd > 0) {
        args.push('--max-budget-usd', String(config.maxBudgetUsd));
      }

      output.info(`Spawning: claude ${args.slice(0, 4).join(' ')} ...`);

      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Don't pass API key — CLI mode uses OAuth
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) {
          stderr += line + '\n';
          // Print progress lines
          if (line.includes('tool_use') || line.includes('screenshot') || line.includes('click')) {
            output.action('claude', line);
          }
        }
      });

      child.on('close', (code) => {
        // Clean up prompt file
        unlink(promptPath).catch(() => {});

        if (code !== 0 && !stdout) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve({
            text: parsed.result ?? '',
            inputTokens: parsed.usage?.input_tokens ?? 0,
            outputTokens: parsed.usage?.output_tokens ?? 0,
            costUsd: parsed.total_cost_usd ?? 0,
            turns: parsed.num_turns ?? 0,
          });
        } catch {
          // If JSON parse fails, return raw output
          resolve({
            text: stdout || stderr,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            turns: 0,
          });
        }
      });

      child.on('error', (err) => {
        unlink(promptPath).catch(() => {});
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            'Claude CLI not found. Install it with: npm i -g @anthropic-ai/claude-code\n' +
            'Then authenticate with: claude auth login'
          ));
        } else {
          reject(err);
        }
      });
    }).catch(reject);
  });
}
