import Anthropic from '@anthropic-ai/sdk';
import { getScreenSize } from './platform/screen-info.js';
import { takeScreenshot } from './platform/screenshot.js';
import { mouseClick, mouseMove, mouseDoubleClick, mouseScroll } from './platform/mouse.js';
import { keyboardType, keyboardKey } from './platform/keyboard.js';
import * as output from './util/output.js';
import type { AgentConfig } from './util/config.js';
import { checkCommand, GUARDRAIL_PROMPT } from './util/guardrails.js';

interface RunResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

// Pricing per million tokens (claude-sonnet-4-6)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

// Screenshot resize target (must match screenshot.ts resize logic)
const SCREENSHOT_MAX_WIDTH = 1280;

const SYSTEM_PROMPT = `You are a computer control agent. CRITICAL: Use the bash tool with PowerShell commands instead of screenshot-click loops whenever possible.

## Self-Correction
1. If a command fails, DO NOT retry it. Analyze the error and try a DIFFERENT approach.
2. NEVER repeat a failed approach more than once.
3. If a task takes more than 3 turns, STOP and reconsider — you're overcomplicating it.
4. Check if programs exist first: powershell -Command "Get-Command 'program' -ErrorAction SilentlyContinue"

## Rules
1. Prefer bash tool (PowerShell) over computer tool for ALL tasks that can be done via command line.
2. Only use the computer tool (screenshot/click) when the task genuinely requires visual interaction.
3. Minimize screenshot frequency — don't screenshot after every action. Trust command output and exit codes.
4. Combine multiple steps into single PowerShell commands to reduce turns and cost.

## Windows Gotchas
- ALWAYS wrap Windows commands in: powershell -Command "..."
- NEVER use bare app names for Windows built-ins (notepad, paint, calc) — triggers Store redirect dialog
- CORRECT: powershell -Command "Start-Process 'C:\\Windows\\System32\\notepad.exe'"
- WRONG: powershell -Command "Start-Process notepad" — opens Store dialog, app never launches
- For typing into apps: powershell -Command "Start-Process 'C:\\Windows\\System32\\notepad.exe'; Start-Sleep -Seconds 2; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('text')"
- Start-Process is async — MUST sleep 2 seconds before interacting with the opened window
- Use semicolons to chain PowerShell, not && (bash syntax)
- If a command "succeeded" but nothing happened, app is stuck at a Store/UAC dialog — use full .exe path

## PowerShell patterns
- Open apps: powershell -Command "Start-Process chrome 'https://url.com'" or "Start-Process 'C:\\Windows\\System32\\notepad.exe'"
- File ops: powershell -Command "Get-Content 'file.txt'" / "Set-Content 'file.txt' 'content'"
- Window management: powershell -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"
- Clipboard: powershell -Command "Set-Clipboard 'text'"
- Install software: powershell -Command "winget install --id 'App.Name' --accept-package-agreements"
- Git/npm/docker: run directly in bash (these work fine without powershell wrapper)

## Anti-patterns
- Do NOT screenshot to verify a window opened. Just open it.
- Do NOT click through UI menus when a PowerShell command exists.
- Do NOT take screenshots after every single action.
- Do NOT use multiple turns for simple one-command tasks.
- Do NOT retry the same failed command — try something different.
${GUARDRAIL_PROMPT}`;

export async function runSdkMode(prompt: string, config: AgentConfig): Promise<RunResult> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { width: realWidth, height: realHeight } = await getScreenSize();
  const model = config.model;

  // Calculate the display dimensions we tell Claude (matches screenshot size)
  const scaleFactor = Math.min(1.0, SCREENSHOT_MAX_WIDTH / realWidth);
  const width = Math.round(realWidth * scaleFactor);
  const height = Math.round(realHeight * scaleFactor);

  output.header('SDK Mode — Computer Use');
  output.info(`Model: ${model} | Screen: ${realWidth}x${realHeight} → ${width}x${height}`);
  output.info(`Budget: $${config.maxBudgetUsd.toFixed(2)} | Max turns: ${config.maxTurns}`);

  // Take initial screenshot
  output.action('screenshot', 'Capturing initial screen...');
  const initialSs = await takeScreenshot();
  const ssMediaType = initialSs.mediaType;

  const tools: Anthropic.Beta.BetaTool[] = [
    {
      type: 'computer_20251124' as unknown as 'computer_20241022',
      name: 'computer',
      display_width_px: width,
      display_height_px: height,
      display_number: 1,
    } as unknown as Anthropic.Beta.BetaTool,
    {
      type: 'bash_20250124' as unknown as 'bash_20241022',
      name: 'bash',
    } as unknown as Anthropic.Beta.BetaTool,
    {
      type: 'text_editor_20250728' as unknown as 'text_editor_20241022',
      name: 'str_replace_based_edit_tool',
    } as unknown as Anthropic.Beta.BetaTool,
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: ssMediaType, data: initialSs.data },
        },
        { type: 'text', text: prompt },
      ],
    },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let turns = 0;
  let finalText = '';

  while (turns < config.maxTurns) {
    turns++;
    const pricing = PRICING[model] ?? PRICING['claude-sonnet-4-6']!;
    const currentCost = (totalInput * pricing.input + totalOutput * pricing.output) / 1_000_000;

    if (currentCost >= config.maxBudgetUsd) {
      output.warn(`Budget limit reached ($${currentCost.toFixed(4)} / $${config.maxBudgetUsd.toFixed(2)})`);
      break;
    }

    output.step(turns, config.maxTurns, `Turn ${turns}...`);

    const response = await client.beta.messages.create({
      model,
      max_tokens: 4096,
      tools,
      messages,
      system: SYSTEM_PROMPT,
      betas: ['computer-use-2025-11-24'],
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    // Process response content blocks
    const toolResults: Anthropic.Beta.BetaMessageParam[] = [];
    let hasToolUse = false;

    for (const block of response.content) {
      if (block.type === 'text') {
        finalText = block.text;
        output.info(block.text.length > 200 ? block.text.slice(0, 200) + '...' : block.text);
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        let result: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
        try {
          result = await executeComputerAction(block.name, block.input as Record<string, unknown>, scaleFactor);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          output.warn(`Action failed: ${errMsg}`);
          result = [{ type: 'text', text: `Error executing action: ${errMsg}` }];
        }
        toolResults.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            } as unknown as Anthropic.Beta.BetaContentBlockParam,
          ],
        });
      }
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: response.content });

    if (!hasToolUse || response.stop_reason === 'end_turn') {
      break;
    }

    // Add tool results
    for (const tr of toolResults) {
      messages.push(tr);
    }

    // Trim old screenshots to save context (keep last 5)
    trimScreenshots(messages, 5);
  }

  const pricing = PRICING[model] ?? PRICING['claude-sonnet-4-6']!;
  const costUsd = (totalInput * pricing.input + totalOutput * pricing.output) / 1_000_000;

  return { text: finalText, inputTokens: totalInput, outputTokens: totalOutput, costUsd, turns };
}

async function executeComputerAction(
  toolName: string,
  input: Record<string, unknown>,
  scaleFactor: number,
): Promise<Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>> {
  const action = input['action'] as string | undefined;

  // Scale coordinates from screenshot space back to real screen space
  const scaleCoord = (coord: [number, number]): [number, number] =>
    [Math.round(coord[0] / scaleFactor), Math.round(coord[1] / scaleFactor)];

  if (toolName === 'computer' && action) {
    output.action('computer', action);

    switch (action) {
      case 'screenshot': {
        const ss = await takeScreenshot();
        return [{ type: 'image', source: { type: 'base64', media_type: ss.mediaType, data: ss.data } }];
      }
      case 'left_click': {
        const raw = input['coordinate'] as [number, number];
        const [x, y] = scaleCoord(raw);
        await mouseClick(x, y, 'left');
        return [
          { type: 'text', text: `Clicked at (${raw[0]}, ${raw[1]}) → screen (${x}, ${y}). Use screenshot action to verify if needed.` },
        ];
      }
      case 'right_click': {
        const raw = input['coordinate'] as [number, number];
        const [x, y] = scaleCoord(raw);
        await mouseClick(x, y, 'right');
        return [
          { type: 'text', text: `Right-clicked at (${raw[0]}, ${raw[1]}) → screen (${x}, ${y}). Use screenshot action to verify if needed.` },
        ];
      }
      case 'double_click': {
        const raw = input['coordinate'] as [number, number];
        const [x, y] = scaleCoord(raw);
        await mouseDoubleClick(x, y);
        return [
          { type: 'text', text: `Double-clicked at (${raw[0]}, ${raw[1]}) → screen (${x}, ${y}). Use screenshot action to verify if needed.` },
        ];
      }
      case 'mouse_move': {
        const raw = input['coordinate'] as [number, number];
        const [x, y] = scaleCoord(raw);
        await mouseMove(x, y);
        return [{ type: 'text', text: `Moved mouse to (${raw[0]}, ${raw[1]}) → screen (${x}, ${y})` }];
      }
      case 'type': {
        const text = input['text'] as string;
        await keyboardType(text);
        return [
          { type: 'text', text: `Typed: "${text.length > 50 ? text.slice(0, 50) + '...' : text}". Use screenshot action to verify if needed.` },
        ];
      }
      case 'key': {
        const key = input['text'] as string;
        await keyboardKey(key);
        return [
          { type: 'text', text: `Pressed: ${key}. Use screenshot action to verify if needed.` },
        ];
      }
      case 'scroll': {
        const raw = input['coordinate'] as [number, number];
        const [x, y] = scaleCoord(raw);
        const direction = (input['scroll_direction'] as string) === 'up' ? 'up' : 'down' as const;
        const amount = (input['scroll_amount'] as number) ?? 3;
        await mouseScroll(x, y, direction, amount);
        return [
          { type: 'text', text: `Scrolled ${direction} at (${raw[0]}, ${raw[1]}) → screen (${x}, ${y}). Use screenshot action to verify if needed.` },
        ];
      }
      default:
        return [{ type: 'text', text: `Unknown computer action: ${action}` }];
    }
  } else if (toolName === 'bash') {
    const command = input['command'] as string;
    output.action('bash', command);

    // Guardrail check — block dangerous commands
    const guard = checkCommand(command);
    if (guard.blocked) {
      return [{ type: 'text', text: `GUARDRAIL BLOCKED: ${guard.reason}. This command is not allowed. Use a safer approach.` }];
    }

    const { execSync } = await import('node:child_process');
    try {
      const result = execSync(command, { timeout: 30000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      return [{ type: 'text', text: result }];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [{ type: 'text', text: `Error: ${msg}` }];
    }
  } else if (toolName === 'str_replace_based_edit_tool') {
    output.action('text_editor', input['command'] as string);
    // Delegate to bash for file operations
    const { execSync } = await import('node:child_process');
    try {
      if (input['command'] === 'view') {
        const result = execSync(`cat "${input['path']}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return [{ type: 'text', text: result }];
      }
      return [{ type: 'text', text: 'Text editor operations handled via bash' }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }];
    }
  }

  return [{ type: 'text', text: `Unknown tool: ${toolName}` }];
}

function trimScreenshots(messages: Anthropic.Beta.BetaMessageParam[], keepLast: number): void {
  let screenshotCount = 0;

  // Count screenshots from the end
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && 'type' in block && block.type === 'image') {
          screenshotCount++;
          if (screenshotCount > keepLast) {
            // Replace with placeholder
            const mutable = block as unknown as Record<string, unknown>;
            mutable['type'] = 'text';
            mutable['text'] = '[screenshot omitted]';
            delete mutable['source'];
          }
        }
      }
    }
  }
}
