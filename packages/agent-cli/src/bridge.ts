/**
 * AskAlf Agent Bridge — WebSocket client
 * Connects to the Forge's /ws/agent-bridge endpoint.
 * Handles device registration, heartbeat, task dispatch, and execution.
 */

import WebSocket from 'ws';
import { execSync, spawn, type ChildProcess } from 'child_process';

export interface BridgeOptions {
  apiKey: string;
  url: string;
  deviceName: string;
  hostname: string;
  os: string;
  capabilities: Record<string, boolean>;
  reconnectInterval?: number;
  heartbeatInterval?: number;
}

interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface TaskPayload {
  executionId: string;
  agentId: string;
  agentName: string;
  input: string;
  maxTurns?: number;
  maxBudget?: number;
}

export class AgentBridge {
  private ws: WebSocket | null = null;
  private options: Required<BridgeOptions>;
  private deviceId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activeExecution: { id: string; process: ChildProcess } | null = null;
  private shouldReconnect = true;

  constructor(options: BridgeOptions) {
    this.options = {
      reconnectInterval: 5000,
      heartbeatInterval: 30000,
      ...options,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.options.url.replace(/^https?:\/\//, 'wss://').replace(/\/$/, '') + '/ws/agent-bridge';

      console.log(`  Connecting to ${wsUrl}...`);

      this.ws = new WebSocket(wsUrl, ['askalf-agent-bridge', this.options.apiKey], {
        headers: {
          'Authorization': `Bearer ${this.options.apiKey}`,
        },
        handshakeTimeout: 10_000,
      });

      this.ws.on('open', () => {
        console.log('  Connected. Registering device...');

        // Register or reconnect
        if (this.deviceId) {
          this.send('device:reconnect', { deviceId: this.deviceId });
        } else {
          this.send('device:register', {
            deviceName: this.options.deviceName,
            hostname: this.options.hostname,
            os: this.options.os,
            capabilities: this.options.capabilities,
          });
        }

        // Start heartbeat
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg: ServerMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          console.error('  Failed to parse server message:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`  Disconnected (${code}: ${reason.toString() || 'no reason'})`);
        this.stopHeartbeat();
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error(`  WebSocket error: ${err.message}`);
        // Don't reject if we're reconnecting
        if (!this.deviceId) {
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.activeExecution) {
      this.activeExecution.process.kill('SIGTERM');
      this.activeExecution = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  private send(type: string, payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'device:registered':
        this.deviceId = msg.payload['deviceId'] as string;
        console.log(`  Registered as device ${this.deviceId}`);
        console.log('  Waiting for tasks...\n');
        break;

      case 'task:dispatch':
        this.handleTask(msg.payload as unknown as TaskPayload);
        break;

      case 'task:cancel':
        this.handleCancel(msg.payload['executionId'] as string);
        break;

      case 'device:error':
        console.error(`  Server error: [${msg.payload['code']}] ${msg.payload['message']}`);
        if (msg.payload['code'] === 'AUTH_FAILED') {
          this.shouldReconnect = false;
        }
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  }

  private async handleTask(task: TaskPayload): Promise<void> {
    console.log(`  [${new Date().toISOString()}] Task received: ${task.agentName} (${task.executionId})`);
    console.log(`  Input: ${task.input.substring(0, 100)}${task.input.length > 100 ? '...' : ''}`);

    // Acknowledge receipt
    this.send('execution:accepted', { executionId: task.executionId });

    // Check if claude CLI is available
    const claudePath = this.findClaude();
    if (!claudePath) {
      console.error('  Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
      this.send('execution:failed', {
        executionId: task.executionId,
        error: 'Claude CLI not installed on device',
      });
      return;
    }

    // Build CLI args
    const args = [
      '--print',
      '--output-format', 'json',
    ];

    if (task.maxTurns) {
      args.push('--max-turns', String(task.maxTurns));
    }
    if (task.maxBudget) {
      args.push('--max-budget-usd', String(task.maxBudget));
    }

    args.push(task.input);

    try {
      const result = await this.runClaude(claudePath, args, task.executionId);

      this.send('execution:complete', {
        executionId: task.executionId,
        output: result.output,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        cost: result.cost,
      });

      console.log(`  Task completed: ${task.executionId} ($${result.cost.toFixed(4)})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.send('execution:failed', {
        executionId: task.executionId,
        error: errorMsg,
      });
      console.error(`  Task failed: ${task.executionId} — ${errorMsg}`);
    } finally {
      this.activeExecution = null;
    }
  }

  private handleCancel(executionId: string): void {
    if (this.activeExecution?.id === executionId) {
      console.log(`  Cancelling task ${executionId}`);
      this.activeExecution.process.kill('SIGTERM');
      this.activeExecution = null;
    }
  }

  private findClaude(): string | null {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    try {
      const result = execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return result.split('\n')[0] || null;
    } catch {
      return null;
    }
  }

  private runClaude(
    claudePath: string,
    args: string[],
    executionId: string,
  ): Promise<{ output: string; tokensIn: number; tokensOut: number; cost: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(claudePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600_000, // 10 min max
        env: { ...process.env },
      });

      this.activeExecution = { id: executionId, process: proc };

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        // Send progress update
        this.send('execution:progress', {
          executionId,
          progress: stdout.length,
        });
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === null || code !== 0) {
          // Try to parse JSON error from stdout
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) {
              return reject(new Error(parsed.error));
            }
          } catch { /* not JSON */ }
          return reject(new Error(stderr || `CLI exited with code ${code}`));
        }

        // Parse JSON output
        try {
          const lines = stdout.trim().split('\n');
          let output = '';
          let tokensIn = 0;
          let tokensOut = 0;
          let cost = 0;

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'result') {
                output = parsed.result || '';
                tokensIn = parsed.input_tokens || 0;
                tokensOut = parsed.output_tokens || 0;
                cost = parsed.total_cost_usd || parsed.cost || 0;
              } else if (parsed.type === 'assistant' && parsed.message) {
                // Streaming message — accumulate as output
                if (!output) output = '';
                const textBlocks = (parsed.message.content || [])
                  .filter((b: { type: string }) => b.type === 'text')
                  .map((b: { text: string }) => b.text);
                output += textBlocks.join('');
              }
            } catch { /* skip non-JSON lines */ }
          }

          resolve({ output: output || stdout, tokensIn, tokensOut, cost });
        } catch {
          resolve({ output: stdout, tokensIn: 0, tokensOut: 0, cost: 0 });
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('device:heartbeat', {
        load: 0,
        activeExecutions: this.activeExecution ? 1 : 0,
      });
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`  Reconnecting in ${this.options.reconnectInterval / 1000}s...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        console.error(`  Reconnect failed: ${err instanceof Error ? err.message : err}`);
        this.scheduleReconnect();
      }
    }, this.options.reconnectInterval);
  }
}
