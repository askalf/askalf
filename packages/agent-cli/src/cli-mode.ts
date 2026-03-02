import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
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

interface SessionMemory {
  history: Array<{
    task: string;
    result: string;
    turns: number;
    success: boolean;
  }>;
  lessons: string[];
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
  const sessionMemory: SessionMemory = { history: [], lessons: [] };

  try {
    // Interactive loop
    while (true) {
      output.info(`\n→ ${currentPrompt}\n`);

      const result = await spawnClaude(currentPrompt, config, mcpConfigPath, sessionMemory);
      totalTurns += result.turns;

      // Record what happened for future turns
      sessionMemory.history.push({
        task: currentPrompt,
        result: result.text.slice(0, 200),
        turns: result.turns,
        success: result.turns < config.maxTurns && !!result.text,
      });

      // If it took too many turns, record as a lesson
      if (result.turns > 10) {
        sessionMemory.lessons.push(
          `Task "${currentPrompt}" took ${result.turns} turns — look for a more direct approach next time.`,
        );
      }

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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function createSpinner(label: string) {
  let frame = 0;
  let currentLabel = label;
  let elapsed = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    elapsed = Math.floor((Date.now() - startTime) / 1000);
    const spinner = chalk.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
    const time = chalk.dim(`${elapsed}s`);
    process.stderr.write(`\r${spinner} ${chalk.white(currentLabel)} ${time}  `);
    frame++;
  }, 80);

  return {
    update(newLabel: string) {
      currentLabel = newLabel;
    },
    stop() {
      clearInterval(interval);
      process.stderr.write('\r' + ' '.repeat(80) + '\r'); // clear line
    },
  };
}

function buildSessionContext(memory: SessionMemory): string {
  const parts: string[] = [];

  if (memory.history.length > 0) {
    const recent = memory.history.slice(-5); // last 5 tasks
    parts.push('## Session History (previous tasks in this session)');
    for (const h of recent) {
      parts.push(`- Task: "${h.task}" → ${h.success ? 'SUCCESS' : 'FAILED'} (${h.turns} turns): ${h.result}`);
    }
  }

  if (memory.lessons.length > 0) {
    parts.push('');
    parts.push('## Lessons Learned This Session — DO NOT REPEAT PAST MISTAKES');
    for (const l of memory.lessons) {
      parts.push(`- ${l}`);
    }
  }

  return parts.join('\n');
}

function spawnClaude(prompt: string, config: AgentConfig, mcpConfigPath: string, memory: SessionMemory): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const sessionContext = buildSessionContext(memory);

    const systemPrompt = `You are a computer control agent with FULL access to this Windows machine. You can do ANYTHING — not just coding.

## CRITICAL: Self-Correction Rules
1. If a command fails, DO NOT retry the same command. Analyze why it failed and try a DIFFERENT approach.
2. If you get an error, read the error message carefully. It tells you exactly what went wrong.
3. NEVER repeat a failed approach more than once. After one failure, switch strategies entirely.
4. Check if a program exists before trying to run it: Get-Command "program" -ErrorAction SilentlyContinue
5. If a task takes more than 3 turns, STOP and reconsider your approach — you're probably overcomplicating it.

## CRITICAL: PowerShell-First Approach
ALWAYS prefer PowerShell commands over screenshot-based interaction. Screenshots are slow, unreliable, and waste turns. PowerShell gives you direct, deterministic control.

## Rules
1. NEVER take a screenshot to find where to click. Use PowerShell to accomplish the task directly.
2. ONLY use screenshots for tasks that truly require visual verification (e.g., "what color is the button?", "read text from an image").
3. When a task can be done via command line, ALWAYS use command line. No exceptions.
4. Combine multiple steps into single PowerShell commands when possible to minimize turns.

## Windows Gotchas — KNOWN ISSUES, DO NOT LEARN THESE THE HARD WAY

### Opening apps — CORRECT way
powershell -Command "Start-Process notepad"           # CORRECT — always use Start-Process
powershell -Command "Start-Process chrome 'https://google.com'"  # CORRECT
powershell -Command "Start-Process code"              # CORRECT — VS Code

### Opening apps — WRONG ways (DO NOT USE)
# notepad                    # WRONG in bash — may block or fail
# start notepad              # WRONG — "start" is cmd.exe, not bash
# open notepad               # WRONG — "open" is macOS only
# /c/Windows/notepad.exe     # WRONG — path mangling issues in Git Bash

### Typing into GUI apps — CORRECT pattern
powershell -Command "Start-Process notepad; Start-Sleep -Milliseconds 800; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('Hello World')"
# MUST wait for app to open (Start-Sleep) before sending keys
# MUST use single PowerShell command — separate commands lose window focus

### Common mistakes to avoid
- Git Bash mangles Windows paths: use "powershell -Command" wrapper for all Windows operations
- "Start-Process" returns immediately — the app opens async, so sleep before interacting
- SendKeys requires the target window to be focused — always Start-Process + Sleep first
- Use semicolons to chain PowerShell commands, not && (which is bash syntax)
- For multi-line PowerShell: wrap in powershell -Command "line1; line2; line3"

## PowerShell Patterns — USE THESE

### Open apps & URLs
powershell -Command "Start-Process chrome 'https://amazon.com'"
powershell -Command "Start-Process notepad"
powershell -Command "Start-Process code 'C:\\project'"
powershell -Command "Start-Process explorer 'C:\\Users'"
powershell -Command "Start-Process ms-settings:"

### File operations
powershell -Command "Get-ChildItem -Path C:\\Users -Recurse -Filter '*.pdf' | Select-Object FullName"
powershell -Command "New-Item -Path 'C:\\temp\\newfile.txt' -Value 'content here' -Force"
powershell -Command "Copy-Item 'source.txt' 'dest.txt'"
powershell -Command "Get-Content 'file.txt'"
powershell -Command "Set-Content 'file.txt' 'new content'"

### Window management
powershell -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"
powershell -Command "Stop-Process -Name 'notepad' -ErrorAction SilentlyContinue"
powershell -Command "Get-Process | Where-Object {\\$_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle"

### Clipboard
powershell -Command "Set-Clipboard 'text to copy'"
powershell -Command "Get-Clipboard"

### System info
powershell -Command "Get-ComputerInfo | Select-Object WindowsVersion, OsArchitecture"
powershell -Command "Get-Volume | Select-Object DriveLetter, SizeRemaining, Size"

### Install software
powershell -Command "winget install --id 'VideoLAN.VLC' --accept-package-agreements --accept-source-agreements"

### Git, npm, Docker — use directly (these work fine in bash)
git clone https://github.com/user/repo
npm install -g @package/name
docker ps

## Anti-patterns — NEVER DO THESE
- Do NOT screenshot to see if a window opened. Just open it.
- Do NOT screenshot to read a web page. Use Invoke-WebRequest or curl.
- Do NOT click through menus via coordinates. Use PowerShell or keyboard shortcuts.
- Do NOT take a screenshot after every action. Trust that commands worked (check exit codes instead).
- Do NOT use multiple turns for simple tasks. One PowerShell command should suffice.
- Do NOT run bare Windows commands in bash (notepad, start, etc.) — always wrap in powershell -Command.
- Do NOT retry the same failed command. If it failed once, it will fail again. Try something different.

## When Screenshots ARE Appropriate
- User explicitly asks "what's on my screen?"
- Task requires reading visual content (charts, images, UI layouts)
- Debugging why a GUI app looks wrong
- Reading text that only exists in a rendered application (not in files)

You are NOT limited to software engineering. Help the user with ANY computer task.
${sessionContext}`;

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

    const spinner = createSpinner('Thinking...');
    let stdout = '';
    let actionCount = 0;

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      for (const segment of line.split('\n')) {
        const s = segment.trim();
        if (!s) continue;

        // Detect tool use and update spinner with action context
        if (s.includes('tool_use') || s.includes('askalf-computer')) {
          actionCount++;
          if (s.includes('screenshot')) {
            spinner.update('Taking screenshot...');
          } else if (s.includes('Bash') || s.includes('bash') || s.includes('powershell')) {
            spinner.update('Running command...');
          } else {
            spinner.update(`Working... (action ${actionCount})`);
          }
        }

        // Show meaningful actions on their own line
        if (s.includes('screenshot') || s.includes('mouse') || s.includes('keyboard') ||
            s.includes('click') || s.includes('type') || s.includes('scroll') ||
            s.includes('tool_use') || s.includes('askalf-computer')) {
          spinner.stop();
          output.action('→', s.length > 120 ? s.slice(0, 120) + '...' : s);
          spinner.update(`Working... (action ${actionCount})`);
        }
      }
    });

    child.on('close', (code) => {
      spinner.stop();

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
      spinner.stop();
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
