# @askalf/agent

**Connect any device to your AskAlf workforce.**

WebSocket bridge that registers your machine as a device in the AskAlf platform. Once connected, Alf's specialist workers can dispatch tasks to your device — executed via Claude CLI with full codebase access. Auto-installs as an OS service so it runs on boot.

Part of [AskAlf](https://askalf.org) — the self-hosted autonomous AI workforce with 109 worker templates, persistent memory, 16 communication channels, and a community skills library.

## Install

```bash
npm install -g @askalf/agent
```

Don't have AskAlf yet? Deploy the full platform first:

```bash
curl -fsSL https://get.askalf.org | bash
```

## Quick Start

**One command to connect + install as service:**

```bash
askalf-agent connect <your-api-key> --url ws://your-server:3005 --name my-device --install
```

That's it. Config saved, service installed, runs on boot. Close the terminal — it keeps running.

**Or step by step:**

```bash
# Connect this device to your team (interactive)
askalf-agent connect <your-api-key> --url ws://your-server:3005

# Install as OS service (auto-start on boot)
askalf-agent install-service

# Run as background daemon instead
askalf-agent daemon

# Check connection + service status
askalf-agent status

# Run capabilities scan (no server needed)
askalf-agent scan

# Stop the agent
askalf-agent disconnect

# Remove OS service
askalf-agent uninstall-service
```

## What It Does

When connected, your device:

1. **Registers** with the AskAlf platform via WebSocket
2. **Scans capabilities** — CPU, RAM, 18 tools checked (git, docker, kubectl, python, etc.), Claude CLI detection
3. **Receives tasks** dispatched by the Forge orchestrator or unified dispatcher
4. **Executes via Claude CLI** — `claude --print --output-format json`
5. **Reports results** back to the platform with token counts, cost, and duration
6. **Streams progress** — the dashboard sees output in real-time via the event bus

The dashboard shows your device in the Devices tab and can route tasks to it based on capabilities.

## Service Installation

`install-service` auto-detects your OS and creates the right service:

| OS | Service Type | Auto-start |
|----|-------------|------------|
| **Linux** | systemd unit | On boot |
| **macOS** | launchd plist | On login |
| **Windows** | Scheduled Task (or nssm) | On login |

```bash
# Install (reads config from ~/.askalf/agent.json)
askalf-agent install-service

# Or combine connect + install in one command
askalf-agent connect <key> --url ws://server:3005 --name prod-box --install

# Check status
askalf-agent status

# Remove
askalf-agent uninstall-service
```

## How It Works

```
Your Machine                    AskAlf Platform
┌──────────────┐    WSS     ┌──────────────────────┐
│ askalf-agent  │◄──────────►│  Forge Orchestrator   │
│              │            │  Unified Dispatcher   │
│ Claude CLI   │            │  Event Bus (Redis)    │
│ Your Code    │            │  Memory System        │
│              │            │  44 Forge + 26 MCP    │
└──────────────┘            └──────────────────────┘
                                    │
                            ┌───────┴───────┐
                            │  Dashboard    │
                            │  Devices Tab  │
                            │  Team View    │
                            └───────────────┘
```

- **Heartbeat** every 30 seconds to maintain presence
- **Auto-reconnect** with exponential backoff (2s → 4s → 8s → max 60s)
- **Capabilities scan** — responds to server requests with full system info
- **Task cancellation** via SIGTERM
- **10 minute timeout** per execution (configurable)
- **Progress streaming** — the dashboard sees output in real-time
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
  "url": "ws://your-server:3005",
  "deviceName": "my-laptop"
}
```

Get your API key from the AskAlf dashboard at Settings > API Keys, or use the `FORGE_API_KEY` from your `.env` file.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Server WebSocket URL | `wss://askalf.org` |
| `--name <name>` | Device display name | System hostname |
| `--install` | Install as service after connecting | |
| `--version` | Show version | |
| `--help` | Show help | |

## Commands

| Command | Description |
|---------|-------------|
| `connect <key>` | Connect to fleet (interactive) |
| `install-service` | Install as OS service (auto-start on boot) |
| `uninstall-service` | Remove OS service |
| `daemon` | Run as background daemon |
| `status` | Check connection + service status |
| `scan` | Run local capabilities scan |
| `disconnect` | Stop running daemon |

## Programmatic Usage

```typescript
import { AgentBridge, scanCapabilities } from '@askalf/agent';

// Scan system capabilities
const caps = scanCapabilities();
console.log(caps); // { cpu_cores: 8, tools: ['shell', 'git', 'docker', ...], ... }

// Connect programmatically
const bridge = new AgentBridge({
  apiKey: 'your-api-key',
  url: 'ws://your-server:3005',
  deviceName: 'my-server',
  hostname: 'prod-01',
  os: 'Linux 6.1',
  capabilities: caps,
});

await bridge.connect();
```

## Supported Platforms

Runs anywhere Node.js runs — Linux, macOS, Windows, Raspberry Pi, cloud VMs, CI runners.

## Related

- [AskAlf Platform](https://github.com/askalf/askalf) — the full platform
- [Wiki](https://github.com/askalf/askalf/wiki) — installation, configuration, FAQ
- [Discord](https://discord.gg/fENVZpdYcX) — community support

## License

MIT — [askalf.org](https://askalf.org)
