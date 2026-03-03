import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { takeScreenshot } from './platform/screenshot.js';

const TOOLS = [
  {
    name: 'screenshot',
    description: 'Capture the current screen. Returns a JPEG image. Use this when you need to visually verify what is on screen. For all other computer control, use the built-in bash tool with PowerShell commands.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export function createMCPServer(): Server {
  const server = new Server(
    { name: 'askalf-computer', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'screenshot') {
      const ss = await takeScreenshot();
      return {
        content: [
          { type: 'image', data: ss.data, mimeType: ss.mediaType },
        ],
      };
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  startStdioServer().catch(console.error);
}
