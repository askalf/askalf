# @substrate/sdk

Developer SDK that exposes the Metabolic Learning primitives without the Docker stack. It packages the procedural memory store, metabolic engine cycles, AI helpers, the secure sandbox runtime, and SIGIL utilities behind a single entry point.

## Quick Start

```bash
pnpm add @substrate/sdk
```

```ts
import { createMetabolicSDK } from '@substrate/sdk';

const sdk = createMetabolicSDK({
  db: { connectionString: process.env.DATABASE_URL },
  // or dbPool: existingPgPool,
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  },
  sandbox: { memoryLimitMb: 64 },
});

// Create a procedural shard (DB-backed)
const shard = await sdk.memory.procedural.createShard({
  name: 'calculate-tip',
  version: 1,
  logic: "function execute(input){ const m=input.match(/(\d+)% tip on \$(\d+(?:\.\d+)?)/); if(!m) return ''; const pct=Number(m[1]); const amt=Number(m[2]); return `$${(pct*amt/100).toFixed(2)}`; }",
  inputSchema: {},
  outputSchema: {},
  patterns: ['tip on'],
  patternHash: 'tip',
  intentTemplate: 'calculate {percent}% tip on ${amount}',
  confidence: 0.7,
  lifecycle: 'candidate',
  synthesisMethod: 'manual',
  synthesisConfidence: 1,
  sourceTraceIds: [],
}, { visibility: 'public' });

// Execute the shard in the sandbox
const exec = await sdk.sandbox.execute(shard.logic, '15% tip on $40');

// Run a metabolic cycle (e.g., decay)
await sdk.engine.decay();

// Parse a SIGIL command
const sigil = sdk.sigil.parseHumanCommand('/remember #critical rotate keys monthly');

// Use the in-memory store for demos/tests
const memoryStore = sdk.stores.createInMemoryProceduralStore();
const demoShard = await memoryStore.createShard({
  name: 'demo',
  version: 1,
  logic: 'function execute(input){ return input; }',
  inputSchema: {},
  outputSchema: {},
  patterns: [],
  confidence: 0.5,
  synthesisMethod: 'manual',
  synthesisConfidence: 1,
  sourceTraceIds: [],
  lifecycle: 'promoted',
});
```

## API surface
- `createMetabolicSDK(options)` ? returns `{ ids, memory, engine, ai, sandbox, sigil, stores }` wired to the provided db/ai/sandbox configs.
- `memory.procedural` ? create/find/match shards (pgvector-backed by default).
- `engine` ? crystallize/evolve/promote/decay/lessons/reseed cycles as pure jobs.
- `ai` ? embeddings, intent extraction, synthesis/evolution helpers (provider-pluggable via config).
- `sandbox` ? secure V8 execution with configurable limits.
- `sigil` ? parse/validate/format SIGIL + bridge client and trace extraction helpers.
- `stores.createInMemoryProceduralStore` ? no-DB store for demos/tests. Optional `dbPool` injection to reuse an existing pg Pool.
- All core types re-exported: `ProceduralShard`, `ShardLifecycle`, `ReasoningTrace`, `KnowledgeFact`, `Episode`, `WorkingContext`, plus `ids` helpers.

## Configuration
Pass any subset of the following to `createMetabolicSDK`:
- `db`: `DatabaseConfig` (e.g., `connectionString` or host/user/password). Requires Postgres with pgvector if you use the provided stores. You can also provide `dbPool` to reuse an existing pool.
- `ai`: `AIConfig` (Anthropic/OpenAI keys).
- `sandbox`: partial `SandboxConfig` (memory/timeout/isolates).

If you prefer manual wiring, you can import the pieces directly instead of using `createMetabolicSDK`.

## Notes
- Docker-free: wire to your own Postgres/Redis stack or swap in custom stores; in-memory store is for local/demo only.
- For pure client-side usage, provide your own store implementations that match the procedural/semantic interfaces.
- Keep secrets in your environment; pass them in via `createMetabolicSDK` options or your own initialization code.
