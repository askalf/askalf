# Contributing to AskAlf

Thanks for your interest in contributing to AskAlf.

## Getting Started

1. Fork the repo
2. Clone your fork
3. Run `./setup.sh` to generate secrets
4. Run `docker compose -f docker-compose.selfhosted.yml up -d`
5. Open `http://localhost:3001`

## Development

The project is a pnpm monorepo:

```
apps/
  forge/          # Agent runtime, API server (Fastify)
  dashboard/      # React SPA + Express server
  mcp-tools/      # MCP tool server for agents
packages/
  core/           # Shared types and utilities
  database/       # PostgreSQL client
  db/             # Lightweight connection pool
  auth/           # Authentication utilities
  email/          # Email provider integrations
  observability/  # Logging, metrics, health checks
  agent-cli/      # @askalf/agent npm package
```

### Build locally

```bash
pnpm install
pnpm --filter @askalf/core build
pnpm --filter @askalf/observability build
pnpm --filter forge build
```

### Run tests

```bash
pnpm exec vitest run
```

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality
- Update docs if behavior changed
- Don't commit `.env` files or secrets

## Database Migrations

Forge migrations live in `apps/forge/migrations/`. They run automatically on startup.

- Name files with sequential numbers: `053_your_migration.sql`
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Test on a fresh database before submitting

## Code Style

- TypeScript for all new code
- No `any` types in public APIs
- Parameterized SQL queries only (no string concatenation)
- Use the existing logging infrastructure (`@askalf/observability`)

## Reporting Issues

- Use the GitHub issue templates
- Include logs, OS, and version info
- Check existing issues first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Email [support@askalf.org](mailto:support@askalf.org) or open a discussion.
