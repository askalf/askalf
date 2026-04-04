# create-askalf

One command. No Docker.

```bash
npx create-askalf
```

Sets up AskAlf — a self-healing AI workforce with a nervous system, immune system, and collective memory. Runs in a single Node.js process with PGlite (in-process PostgreSQL) and in-memory cache.

## Quick Start

```bash
npx create-askalf
```

Interactive setup asks for your AI provider key, then downloads, builds, and starts the platform.

## Quick Mode

```bash
ANTHROPIC_API_KEY=sk-ant-... npx create-askalf --quick
```

Skips prompts, uses defaults.

## What You Get

- API server at `http://localhost:3000`
- PGlite database (no PostgreSQL needed)
- In-memory cache (no Redis needed)
- 109 agent templates
- 70 MCP tools

## Production

For production deployments with PostgreSQL, Redis, and Docker:

```bash
curl -fsSL https://get.askalf.org | bash
```

## Links

- [askalf.org](https://askalf.org)
- [Demo](https://demo.askalf.org)
- [GitHub](https://github.com/askalf/askalf)
- [Discord](https://discord.gg/fENVZpdYcX)

MIT
