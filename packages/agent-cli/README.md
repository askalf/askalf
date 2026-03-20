# @askalf/agent

**Connect any device to your AskAlf fleet.**

WebSocket bridge that registers your machine as a device in the AskAlf platform. Once connected, the fleet's 7 core agents (Backend Dev, Frontend Dev, QA, Infra, Security, Watchdog, Writer) can dispatch tasks to your device — executed via Claude CLI with full codebase access.

Part of [AskAlf](https://askalf.org) — the self-hosted autonomous AI agent fleet platform with multi-agent orchestration, persistent memory, 16 communication channels, and a 28-package marketplace.

## Install

```bash
npm install -g @askalf/agent
```

Don't have AskAlf yet? Deploy the full platform first:

```bash
curl -fsSL https://get.askalf.org | bash
```

## Quick Start

```bash
# Connect this device to your fleet
askalf-agent connect <your-api-key>

# Connect to a self-hosted instance
askalf-agent connect <your-api-key> --url wss://your-server.com

# Run as a background daemon
askalf-agent daemon

# Check connection status
askalf-agent status

# Disconnect
askalf-agent disconnect
```

## What It Does

When connected, your device:

1. **Registers** with the AskAlf fleet via WebSocket
2. **Reports capabilities** — shell, git, docker, node, python, filesystem (auto-detected)
3. **Receives tasks** dispatched by the Forge orchestrator or unified dispatcher
4. **Executes via Claude CLI** — `claude --print --output-format json`
5. **Reports results** back to the fleet with token counts, cost, and duration
6. **Streams progress** — the fleet sees output in real-time via the event bus

The fleet sees your device in the Devices tab and can route tasks to it based on capabilities. The autonomous brain can also dispatch investigation tickets to devices when fleet agents identify issues.

## How It Works

```
Your Machine                    AskAlf Fleet
┌──────────────┐    WSS     ┌──────────────────────┐
│ askalf-agent  │◄──────────►│  Forge Orchestrator   │
│              │            │  Unified Dispatcher   │
│ Claude CLI   │            │  Event Bus (Redis)    │
│ Your Code    │            │  Brain + Memory       │
│              │            │  26 MCP Tools         │
└──────────────┘            └──────────────────────┘
                                    │
                            ┌───────┴───────┐
                            │  Dashboard    │
                            │  Devices Tab  │
                            │  Fleet View   │
                            └───────────────┘
```

- **Heartbeat** every 30 seconds to maintain presence
- **Auto-reconnect** on disconnect (5 second backoff)
- **Task cancellation** via SIGTERM
- **10 minute timeout** per execution (configurable)
- **Progress streaming** — the fleet sees output in real-time
- **API key auth** — Bearer token on WebSocket handshake

## Requirements

- Node.js 22+ (18+ may work but 22 is recommended)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- An AskAlf instance running (deploy with `curl -fsSL https://get.askalf.org | bash`)

## Configuration

Config stored in `~/.askalf/agent.json`:

```json
{
  "apiKey": "your-forge-api-key",
  "url": "wss://your-server.com",
  "deviceName": "my-laptop"
}
```

Get your API key from the AskAlf dashboard at Settings > API Keys, or use the `FORGE_API_KEY` from your `.env` file.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Server WebSocket URL | `wss://askalf.org` |
| `--name <name>` | Device display name | System hostname |
| `--version` | Show version | |
| `--help` | Show help | |

## Programmatic Usage

```typescript
import { AgentBridge } from '@askalf/agent';

const bridge = new AgentBridge({
  apiKey: 'your-api-key',
  url: 'wss://your-server.com',
  deviceName: 'my-server',
  hostname: 'prod-01',
  os: 'Linux 6.1',
  capabilities: { shell: true, docker: true, git: true, node: true, python: true, filesystem: true },
});

await bridge.connect();

// The bridge will now:
// - Register with the fleet
// - Accept dispatched tasks
// - Execute via Claude CLI
// - Report results back
// - Maintain heartbeat
// - Auto-reconnect on failure
```

## Supported Platforms

Runs anywhere Node.js runs — Linux, macOS, Windows, Raspberry Pi, cloud VMs, CI runners.

## Related

- [AskAlf Platform](https://github.com/askalf/askalf) — the full platform
- [Wiki](https://github.com/askalf/askalf/wiki) — installation, configuration, FAQ
- [Architecture Docs](https://github.com/askalf/askalf/blob/main/docs/ARCHITECTURE.md) — system internals
- [Discord](https://discord.gg/fENVZpdYcX) — community support

## License

MIT — [askalf.org](https://askalf.org)
