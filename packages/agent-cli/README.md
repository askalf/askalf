# @askalf/agent

Connect local devices to your [AskAlf](https://askalf.org) fleet via WebSocket bridge.

## Install

```bash
npm install -g @askalf/agent
```

## Usage

```bash
# Connect this device to your fleet
askalf-agent connect <api-key>

# Connect to a specific server
askalf-agent connect <api-key> --url wss://your-server.com

# Name this device
askalf-agent connect <api-key> --name "build-server"

# Run as background daemon
askalf-agent daemon

# Check connection status
askalf-agent status

# Stop the agent
askalf-agent disconnect
```

## How It Works

1. Your device connects to the AskAlf forge via WebSocket
2. The device registers its capabilities (shell, git, docker, node, python)
3. When the fleet dispatches a task to your device, the agent runs it using Claude CLI
4. Results are streamed back to the platform in real time

## Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- An AskAlf API key (generate in Settings > API Keys)

## Configuration

Config is stored in `~/.askalf/agent.json`. The daemon PID file is at `~/.askalf/agent.pid`.

## License

MIT
