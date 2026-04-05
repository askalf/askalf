# AskAlf — Project Rules

## Standards
- Never take shortcuts. Every file, every line, every config must be production quality.
- Never skip anything. If you find a problem, fix it immediately or create a tracked TODO with the exact file, line, and issue.
- Never band-aid. If something is broken, fix the root cause. Don't patch symptoms.
- Never commit broken code. Build and verify locally before every push.
- Never commit on main without testing. Feature branches for anything non-trivial.
- Never leave dead code. If it's not imported and used, delete it.
- Never reference old brand names. No substrate, orcastr8r, sprayberry, amnesia, sigil, openclaw — anywhere, ever.
- Never expose secrets, credentials, tokens, or internal company information in any repo, commit, or file.
- Never add AI attribution to commits. No co-authored-by, no claude references.
- Never commit images, binaries, or build artifacts to the public repo. They go in askalf/landing (private).
- Never commit then fix then fix-the-fix. Think through the full impact before committing.

## Code Quality
- Every TypeScript file must compile cleanly with strict mode.
- Every import must resolve to a real, existing file.
- Every database query must reference columns that exist.
- Every API endpoint must return valid JSON with proper status codes.
- Every Docker build must pass before merging.
- Every CI workflow must pass before merging.
- Remove dead code aggressively. 0 tolerance for unused files, components, routes, stores, or imports.

## Git
- Clean, descriptive commit messages. No "fix", "update", "stuff".
- One concern per commit.
- Never force push unless explicitly asked.
- Never amend published commits unless explicitly asked.

## Product
- This is a sellable product. Every public-facing surface (GitHub, npm, landing page, demo, Discord) must look like it was built by a funded startup, not a side project.
- README must be accurate. If it says a feature works, it must actually work.
- npx create-askalf must work end to end for a first-time user with zero context.
- The demo must convert visitors. If someone tries the demo and it doesn't work, that's a critical bug.
- Documentation reflects current state, not aspirational state.

## Architecture
- Public repos: askalf/askalf (platform), askalf/agent (CLI)
- Private repos: askalf/landing, askalf/demo, askalf/demo-worker, askalf/webhost, askalf/amnesia
- No internal infrastructure, company docs, or personal configs in public repos.
- Database changes require migrations. No manual ALTER TABLE.
- Agent prompts live in the database, not in code files.

## Fleet
- Every active agent must have a detailed system prompt with specific instructions.
- No one-liner prompts. If an agent doesn't have real work to do, pause it.
- Fleet Chief runs on Sonnet. It's the brain.
- Monitor fleet health after every change. Check for failed executions.
- Resolve tickets and interventions promptly. Don't let them pile up.

## AI Providers
- Universal provider chain: Anthropic → OpenAI → Google → Ollama
- No provider is hardcoded. Every AI call goes through the universal provider.
- Model IDs use short form only: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6
- Never use dated model IDs (claude-haiku-4-5-20251001 etc.)
- Agents use MCP tools for web access. WebFetch and WebSearch are DENIED in agent settings.

## Infrastructure
- Cloudflare handles DNS, CDN, WAF, and Pages deploys for landing/demo
- Demo traffic goes through CF Worker (demo-api.askalf.org), NOT the backend
- Docker images are multi-arch (amd64 + arm64) on Docker Hub
- Browser bridge container provides headless Chromium via CDP
- OAuth credentials need to be copied into the forge container after every restart

## Current State (April 2026)
- Version: 2.9.9 (approaching v3.0)
- npm: create-askalf@3.0.6, @askalf/agent@2.9.10
- 14 fleet agents (9 active, 5 paused)
- 50 templates across 10 categories
- Code scanning: 0 open alerts
- CI, Docker, Desktop builds: all green
- Landing page: askalf.org (CF Pages)
- Demo: demo.askalf.org → demo-api.askalf.org (CF Worker)
- Twitter: OAuth credits depleted, browser login WIP (rate limited but approach proven)

## How Thomas Works
- Moves fast. Expects the same.
- Hates unnecessary commits and messy git history.
- Wants everything production-quality or not at all.
- Tests by using the product, not by reading code.
- Cares deeply about the user experience — if it confuses someone, it's broken.
- Will call out mistakes directly. Learn from them, don't repeat them.
- "Keep building" means don't stop and ask — just do the next thing.
