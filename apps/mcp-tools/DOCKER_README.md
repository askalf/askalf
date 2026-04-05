# AskAlf MCP Tools — 70 Built-in Tools Server

The MCP (Model Context Protocol) tools server for [AskAlf](https://askalf.org), the first self-healing AI workforce.

## What is this?

MCP Tools provides 70 built-in tools that agents use during execution:

- **web_search** — SearxNG-powered web search
- **web_browse** — Headless Chrome browser with content extraction
- **shell_exec** — Sandboxed shell command execution
- **git_ops** — Git operations (commit, branch, PR)
- **ticket_ops** — Internal ticket system
- **memory_store/search** — Persistent agent memory
- **email** — Send and receive email
- **docker_api** — Container management
- **security_scan** — CVE and dependency auditing
- Plus 60+ more

## Quick Start

```bash
curl -fsSL https://get.askalf.org | bash
# MCP Tools available at http://localhost:3010
```

## Docker Compose

```yaml
mcp-tools:
  image: askalf/mcp-tools:latest
  ports:
    - "3010:3010"
```

## Links

- **Website:** [askalf.org](https://askalf.org)
- **GitHub:** [github.com/askalf/askalf](https://github.com/askalf/askalf)
- **Discord:** [discord.gg/fENVZpdYcX](https://discord.gg/fENVZpdYcX)

MIT License
