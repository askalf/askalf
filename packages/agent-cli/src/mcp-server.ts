import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { takeScreenshot } from './platform/screenshot.js';
import { mouseClick, mouseMove, mouseDoubleClick, mouseScroll } from './platform/mouse.js';
import { keyboardType, keyboardKey } from './platform/keyboard.js';

const TOOLS = [
  {
    name: 'screenshot',
    description: 'Capture the current screen. Returns a base64-encoded PNG image of the entire screen.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'mouse_click',
    description: 'Move the mouse to coordinates (x, y) and click. Supports left, right, and double click.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        double: { type: 'boolean', description: 'Double click (default: false)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_move',
    description: 'Move the mouse cursor to coordinates (x, y) without clicking.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'keyboard_type',
    description: 'Type a string of text as if using the keyboard. Use this for entering text into fields, editors, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'keyboard_key',
    description: 'Press a key or key combination. Use "+" to combine modifiers. Examples: "ctrl+c", "Return", "alt+tab", "ctrl+shift+s".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        combo: { type: 'string', description: 'Key or key combination (e.g. "ctrl+c", "Return", "space")' },
      },
      required: ['combo'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the mouse wheel at the given position.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        clicks: { type: 'number', description: 'Number of scroll clicks (default: 3)' },
      },
      required: ['x', 'y', 'direction'],
    },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  switch (name) {
    case 'screenshot': {
      const base64 = await takeScreenshot();
      return {
        content: [
          { type: 'image', data: base64, mimeType: 'image/png' },
        ],
      };
    }

    case 'mouse_click': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const button = (args['button'] as string) ?? 'left';
      const double = args['double'] as boolean;

      if (double) {
        await mouseDoubleClick(x, y);
      } else {
        await mouseClick(x, y, button as 'left' | 'right' | 'middle');
      }
      // Return screenshot after action
      const ss = await takeScreenshot();
      return {
        content: [
          { type: 'text', text: `Clicked ${button} at (${x}, ${y})${double ? ' (double)' : ''}` },
          { type: 'image', data: ss, mimeType: 'image/png' },
        ],
      };
    }

    case 'mouse_move': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      await mouseMove(x, y);
      return {
        content: [
          { type: 'text', text: `Moved mouse to (${x}, ${y})` },
        ],
      };
    }

    case 'keyboard_type': {
      const text = args['text'] as string;
      await keyboardType(text);
      const ss = await takeScreenshot();
      return {
        content: [
          { type: 'text', text: `Typed: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"` },
          { type: 'image', data: ss, mimeType: 'image/png' },
        ],
      };
    }

    case 'keyboard_key': {
      const combo = args['combo'] as string;
      await keyboardKey(combo);
      const ss = await takeScreenshot();
      return {
        content: [
          { type: 'text', text: `Pressed: ${combo}` },
          { type: 'image', data: ss, mimeType: 'image/png' },
        ],
      };
    }

    case 'scroll': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const direction = args['direction'] as 'up' | 'down';
      const clicks = (args['clicks'] as number) ?? 3;
      await mouseScroll(x, y, direction, clicks);
      const ss = await takeScreenshot();
      return {
        content: [
          { type: 'text', text: `Scrolled ${direction} ${clicks} clicks at (${x}, ${y})` },
          { type: 'image', data: ss, mimeType: 'image/png' },
        ],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

export function createMCPServer(): Server {
  const server = new Server(
    { name: 'askalf-computer', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await handleToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow running directly: node mcp-server.js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  startStdioServer().catch(console.error);
}
