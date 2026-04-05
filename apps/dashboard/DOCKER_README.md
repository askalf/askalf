# AskAlf Dashboard — Web UI & API Gateway

The web interface and API gateway for [AskAlf](https://askalf.org), the first self-healing AI workforce.

## What is this?

Dashboard provides the web UI for managing your autonomous AI fleet:

- **Fleet view** — real-time agent status, executions, costs
- **Organism tab** — neural network visualization of agent communication
- **Terminal** — Claude Code and Codex CLI access in-browser
- **Channels** — Slack, Discord, Telegram, WhatsApp, email integrations
- **API gateway** — proxies requests to Forge with session auth

## Quick Start

```bash
curl -fsSL https://get.askalf.org | bash
# Dashboard available at http://localhost:3001
```

## Docker Compose

```yaml
dashboard:
  image: askalf/dashboard:latest
  ports:
    - "3001:3001"
```

## Links

- **Website:** [askalf.org](https://askalf.org)
- **GitHub:** [github.com/askalf/askalf](https://github.com/askalf/askalf)
- **Discord:** [discord.gg/fENVZpdYcX](https://discord.gg/fENVZpdYcX)

MIT License
