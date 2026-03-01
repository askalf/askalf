import Anthropic from '@anthropic-ai/sdk';
import { getScreenSize } from './platform/screen-info.js';
import { takeScreenshot } from './platform/screenshot.js';
import { mouseClick, mouseMove, mouseDoubleClick, mouseScroll } from './platform/mouse.js';
import { keyboardType, keyboardKey } from './platform/keyboard.js';
import * as output from './util/output.js';
import type { AgentConfig } from './util/config.js';

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

export async function runSdkMode(prompt: string, config: AgentConfig): Promise<RunResult> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { width, height } = await getScreenSize();
  const model = config.model;

  output.header('SDK Mode — Computer Use');
  output.info(`Model: ${model} | Screen: ${width}x${height}`);
  output.info(`Budget: $${config.maxBudgetUsd.toFixed(2)} | Max turns: ${config.maxTurns}`);

  // Take initial screenshot
  output.action('screenshot', 'Capturing initial screen...');
  const initialSs = await takeScreenshot();

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
      type: 'text_editor_20250124' as unknown as 'text_editor_20241022',
      name: 'str_replace_based_edit_tool',
    } as unknown as Anthropic.Beta.BetaTool,
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: initialSs },
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
      betas: ['computer-use-2025-01-24'],
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
        const result = await executeComputerAction(block.name, block.input as Record<string, unknown>);
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
): Promise<Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>> {
  const action = input['action'] as string | undefined;

  if (toolName === 'computer' && action) {
    output.action('computer', action);

    switch (action) {
      case 'screenshot': {
        const ss = await takeScreenshot();
        return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } }];
      }
      case 'left_click': {
        const [x, y] = input['coordinate'] as [number, number];
        await mouseClick(x!, y!, 'left');
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Clicked at (${x}, ${y})` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      case 'right_click': {
        const [x, y] = input['coordinate'] as [number, number];
        await mouseClick(x!, y!, 'right');
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Right-clicked at (${x}, ${y})` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      case 'double_click': {
        const [x, y] = input['coordinate'] as [number, number];
        await mouseDoubleClick(x!, y!);
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Double-clicked at (${x}, ${y})` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      case 'mouse_move': {
        const [x, y] = input['coordinate'] as [number, number];
        await mouseMove(x!, y!);
        return [{ type: 'text', text: `Moved mouse to (${x}, ${y})` }];
      }
      case 'type': {
        const text = input['text'] as string;
        await keyboardType(text);
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Typed: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      case 'key': {
        const key = input['text'] as string;
        await keyboardKey(key);
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Pressed: ${key}` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      case 'scroll': {
        const [x, y] = input['coordinate'] as [number, number];
        const direction = (input['direction'] as string) === 'up' ? 'up' : 'down' as const;
        const amount = (input['amount'] as number) ?? 3;
        await mouseScroll(x!, y!, direction, amount);
        const ss = await takeScreenshot();
        return [
          { type: 'text', text: `Scrolled ${direction} at (${x}, ${y})` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: ss } },
        ];
      }
      default:
        return [{ type: 'text', text: `Unknown computer action: ${action}` }];
    }
  } else if (toolName === 'bash') {
    const command = input['command'] as string;
    output.action('bash', command);
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
