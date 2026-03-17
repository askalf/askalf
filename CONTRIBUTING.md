# Contributing to AskAlf

This guide covers everything you need to contribute to the AskAlf substrate monorepo.

## 1. Getting Started

### Prerequisites

| Tool   | Minimum Version | Notes                                    |
|--------|-----------------|------------------------------------------|
| Node   | 20.0.0+         | See `engines` in root `package.json`     |
| pnpm   | 9.0.0+          | Pinned at 9.15.0 via `packageManager`    |
| Docker | 24+             | Required for PostgreSQL (pgvector), Redis |

### Clone and install

```bash
git clone https://github.com/AskAlf/substrate.git
cd substrate
pnpm install
```

### Initial setup

The repository ships a setup script that generates secrets and writes your `.env` file:

```bash
./setup.sh
```

Review the generated `.env` and adjust values as needed. Never commit `.env` files.

### Start the platform

```bash
docker compose -f docker-compose.selfhosted.yml up -d
```

The dashboard is available at `http://localhost:3001` once all containers are healthy.

## 2. Development Workflow

### Running the full stack via Docker Compose

```bash
# Start everything (database, forge, dashboard, mcp-tools)
docker compose -f docker-compose.selfhosted.yml up -d

# Follow logs for a specific service
docker compose -f docker-compose.selfhosted.yml logs -f forge

# Restart a single service after code changes
docker compose -f docker-compose.selfhosted.yml up -d --build forge
```

### Running services locally (outside Docker)

If you prefer faster iteration on a single service:

```bash
# Build shared packages first (order matters)
pnpm --filter @askalf/core build
pnpm --filter @askalf/db build
pnpm --filter @askalf/observability build

# Then build and run the target app
pnpm --filter forge build
pnpm --filter forge dev
```

### Useful root scripts

| Command               | Description                              |
|-----------------------|------------------------------------------|
| `pnpm build`          | Build all packages and apps              |
| `pnpm dev`            | Start all apps in dev/watch mode         |
| `pnpm lint`           | Run ESLint across the monorepo           |
| `pnpm typecheck`      | Run `tsc --noEmit` across the monorepo   |
| `pnpm test`           | Run all package-level tests              |
| `pnpm test:integration` | Run integration tests (requires running services) |
| `pnpm db:migrate`     | Run database migrations via the database package |
| `pnpm db:generate`    | Generate database types                  |
| `pnpm clean`          | Remove build artifacts                   |

## 3. Project Structure

```
substrate/
  apps/
    forge/            # Agent runtime and API server (Fastify)
    dashboard/        # React SPA with Express server
    mcp-tools/        # MCP tool server for agent capabilities (port 3010)
    admin-console/    # Admin management interface
  packages/
    core/             # Shared types, constants, and utilities
    database/         # PostgreSQL client, migrations, and generated types
    db/               # Lightweight connection pool (@askalf/db)
    auth/             # Authentication utilities
    email/            # Email provider integrations
    observability/    # Logging, metrics (Prometheus), health checks
    agent-cli/        # @askalf/agent npm package
  infrastructure/     # PostgreSQL config, deployment scripts
  scripts/            # Build and operational scripts
  tests/              # Integration and unit test suites
  docs/               # Project documentation
```

The workspace is defined in `pnpm-workspace.yaml` and includes `packages/*` and `apps/*`.

## 4. Code Style

### TypeScript

All new code must be TypeScript. The project uses strict mode with additional strictness flags defined in `tsconfig.base.json`:

- `strict: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noPropertyAccessFromIndexSignature: true`

Target is ES2022 with NodeNext module resolution.

### General rules

- No `any` types in public APIs. Use `unknown` and narrow with type guards.
- Parameterized SQL queries only. Never concatenate user input into SQL strings.
- Use the existing logging infrastructure from `@askalf/observability`. Do not use bare `console.log` in production code.
- No emojis in source code or commit messages.
- Use bracket notation for indexed access (enforced by `noPropertyAccessFromIndexSignature`):
  ```typescript
  // Correct
  const val = process.env['PORT'];
  // Incorrect
  const val = process.env.PORT;
  ```

### Linting and formatting

```bash
pnpm lint        # ESLint
# Prettier is available as a dev dependency for formatting
```

## 5. Database Migrations

Forge migrations live in `apps/forge/migrations/` and run automatically on startup in sequential order.

### Current state

Migrations are numbered sequentially from `001` through `055`. Check the directory for the latest number before adding a new one.

### Adding a new migration

1. Determine the next number by checking the highest existing file:
   ```bash
   ls apps/forge/migrations/ | tail -5
   ```

2. Create a new file following the naming convention:
   ```
   056_descriptive_name.sql
   ```
   Use a zero-padded three-digit prefix, an underscore, and a lowercase snake_case description.

3. Write idempotent SQL. Always use `IF NOT EXISTS` / `IF EXISTS` guards:
   ```sql
   CREATE TABLE IF NOT EXISTS my_table (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   CREATE INDEX IF NOT EXISTS idx_my_table_created
     ON my_table (created_at);
   ```

4. Test on a fresh database before submitting:
   ```bash
   docker compose -f docker-compose.selfhosted.yml down -v
   docker compose -f docker-compose.selfhosted.yml up -d
   ```

There is also a separate migration path at `packages/database/src/migrations/` which seeds initial schema via Docker's `initdb.d`. If your change affects the core schema package, add migrations there and run `pnpm db:migrate`.

## 6. Adding a Channel Provider

Channel providers live in `apps/forge/src/channels/`. Every provider implements the `ChannelProvider` interface.

### Step by step

1. **Create the provider file** at `apps/forge/src/channels/my-channel.ts`:

   ```typescript
   import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

   export class MyChannelProvider implements ChannelProvider {
     type = 'my_channel' as const;

     verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
       // Verify inbound webhook signature
       return { valid: true };
     }

     parseMessage(body: unknown): ChannelInboundMessage | null {
       // Extract text, external IDs from the inbound payload
       return null;
     }

     async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
       // Send a response back through the channel's API
     }

     // Optional: handle platform verification challenges
     handleChallenge?(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult | null {
       return null;
     }
   }
   ```

2. **Add the type to `types.ts`**. Append your channel to the `ChannelType` union and the `CHANNEL_TYPES` array:

   ```typescript
   export type ChannelType = '...' | 'my_channel';
   export const CHANNEL_TYPES: ChannelType[] = [..., 'my_channel'];
   ```

3. **Register the provider in `index.ts`**. Import and add it to the providers map:

   ```typescript
   import { MyChannelProvider } from './my-channel.js';
   providers.set('my_channel', new MyChannelProvider());
   ```

4. **Add a database migration** if the `channel_type` column has a CHECK constraint or enum. Create a new migration (see section 5) that adds your type to the allowed values.

5. **Write tests** covering webhook verification, message parsing, and reply sending.

## 7. Adding an MCP Tool

MCP tools are defined in `apps/mcp-tools/src/`. The server (`server.ts`) registers tools from multiple modules, each of which exports a `TOOLS` array and a `handleTool` function.

### Adding a tool to an existing module

1. Open the relevant module (e.g., `workflow.ts`, `data.ts`, `infra.ts`, `agent-tools.ts`, `forge-tools.ts`).

2. Add a tool definition to the `TOOLS` array:
   ```typescript
   export const TOOLS = [
     // ... existing tools
     {
       name: 'my_tool',
       description: 'What this tool does. Actions: action_a, action_b.',
       inputSchema: {
         type: 'object' as const,
         properties: {
           action: { type: 'string', enum: ['action_a', 'action_b'] },
           // ... parameters
         },
         required: ['action'],
       },
     },
   ];
   ```

3. Handle the tool in the module's `handleTool` function, matching on `name`.

### Adding a new tool module

1. Create `apps/mcp-tools/src/my-module.ts` exporting `TOOLS` and `handleTool`.

2. Import and register it in `server.ts` alongside the existing modules:
   ```typescript
   import { TOOLS as MY_TOOLS, handleTool as handleMyTool } from './my-module.js';
   ```

3. Add the tools to the `ListToolsRequest` handler and route calls in the `CallToolRequest` handler, following the existing pattern in `server.ts`.

## 8. Adding a Marketplace Package

Marketplace packages are managed through the API. A package manifest typically includes:

- `name` -- unique package identifier
- `version` -- semver string
- `description` -- what the package does
- `author` -- author or organization name
- `category` -- classification for discovery
- `configuration` -- schema for user-configurable options

The marketplace schema is defined in migration `054_marketplace.sql`. Publishing is done via the Forge API. Refer to the API documentation or the admin console for the exact endpoints and payload format.

## 9. Testing

### Test configuration

The project has two Vitest configurations:

| Config                    | Includes                               | Timeout |
|---------------------------|----------------------------------------|---------|
| `vitest.config.ts`        | `tests/**/*.test.ts` (integration)     | 60s     |
| `vitest.unit.config.ts`   | `tests/unit/**/*.test.ts`, `tests/core/**/*.test.ts` | 30s |

### Running tests

```bash
# All integration tests (requires running services)
pnpm test:integration

# Unit tests only
pnpm exec vitest run --config vitest.unit.config.ts

# Watch mode for integration tests
pnpm test:integration:watch

# All package-level tests
pnpm test

# Single test file
pnpm exec vitest run tests/unit/my-feature.test.ts
```

### What to test

- **Channel providers**: webhook verification, message parsing, reply sending.
- **MCP tools**: tool handler logic, input validation, error cases.
- **Database migrations**: run against a fresh database to verify idempotency.
- **API endpoints**: request/response contracts, authentication, error handling.
- **Shared packages**: exported functions and types in `packages/`.

## 10. Pull Request Process

### Branch naming

Use a descriptive branch name with a prefix:

- `feat/short-description` -- new feature
- `fix/short-description` -- bug fix
- `refactor/short-description` -- code restructuring
- `docs/short-description` -- documentation only
- `infra/short-description` -- infrastructure or DevOps

### Commit messages

Write clear, imperative commit messages. No emojis. Examples:

- `Add WebSocket channel provider`
- `Fix memory search returning stale results`
- `Refactor channel registry to use lazy initialization`

### PR template

The repository includes a PR template at `.github/PULL_REQUEST_TEMPLATE.md`. Fill out every section:

- **What does this PR do** -- brief description
- **Type of change** -- bug fix, feature, refactor, docs, infra
- **Component(s) affected** -- dashboard, forge, MCP tools, agent execution, etc.
- **Testing** -- how you tested, whether existing tests pass, whether new tests were added
- **Checklist** -- code style, no secrets, no console.log, migrations included, docs updated

### Review expectations

- Keep PRs focused. One feature or fix per PR.
- All CI checks must pass (lint, typecheck, tests).
- At least one approval is required before merging.
- Do not commit `.env` files, credentials, or secrets.
- Include database migrations if the schema changed.
- Update documentation if user-facing behavior changed.

## 11. Release Process

### Docker builds

Each app has its own Dockerfile. Production images are built via:

```bash
docker compose -f docker-compose.prod.yml build
```

The compose files available are:

| File                           | Purpose                          |
|--------------------------------|----------------------------------|
| `docker-compose.selfhosted.yml` | Local development and self-hosting |
| `docker-compose.prod.yml`       | Production deployment            |
| `docker-compose.webhost.yml`    | Web-hosted deployment            |
| `docker-compose.vpn.yml`        | VPN-secured deployment           |

### Versioning

The monorepo version is tracked in the root `package.json` (currently `1.0.0`). Individual packages may have their own versions. Bump versions in the relevant `package.json` files before release.

### Release checklist

1. Ensure all tests pass on the target branch.
2. Verify migrations run cleanly on a fresh database.
3. Update version numbers as needed.
4. Build production Docker images and verify they start correctly.
5. Tag the release commit.

## Questions?

Email [support@askalf.org](mailto:support@askalf.org) or open a GitHub discussion.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
