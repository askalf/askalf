# Persistent Agent Container
# Each agent gets its own container running Claude Code CLI
# with custom CLAUDE.md and MCP configuration.

FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install git (agents need git access)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g agent -m -s /bin/bash agent

WORKDIR /app

# Copy agent daemon
COPY apps/agent-container/src/agent-daemon.ts /app/agent-daemon.ts
COPY apps/agent-container/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

# Install daemon dependencies
RUN npm install ioredis tsx

# Agent config files are mounted as volumes:
# /app/CLAUDE.md    — agent system prompt + knowledge
# /app/mcp.json     — MCP server configuration

ENV NODE_ENV=production
ENV AGENT_ID=""
ENV AGENT_NAME=""
# ANTHROPIC_API_KEY intentionally not set — agents use OAuth via ~/.claude/.credentials.json
# Set ANTHROPIC_API_KEY in docker-compose to override with API key billing
ENV REDIS_URL=""
ENV MAX_BUDGET_USD="0.50"

USER agent

ENTRYPOINT ["/app/entrypoint.sh"]
