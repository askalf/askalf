# Agent Forge API Server
FROM node:20-slim AS builder

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/forge ./apps/forge
COPY packages/email ./packages/email
COPY packages/core ./packages/core
COPY packages/observability ./packages/observability

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build workspace dependencies first, then forge
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/email build && \
    pnpm --filter @substrate/forge build

# Deploy to a self-contained directory
RUN pnpm deploy --filter @substrate/forge --prod /app/deploy

# Remove unnecessary files from deploy
RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Production stage
FROM node:20-alpine AS runner

# Install git for git_ops tool + procps for pgrep (process tree kill)
RUN apk add --no-cache git procps

# Install Claude Code CLI globally for agent execution
RUN npm install -g @anthropic-ai/claude-code

# Security: create non-root user
RUN addgroup -g 1001 substrate && \
    adduser -u 1001 -G substrate -s /bin/false -D substrate

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

# Pre-create CLI directories owned by substrate user
RUN mkdir -p /tmp/claude-home/.claude /tmp/agent-workspace && \
    chown -R substrate:substrate /tmp/claude-home /tmp/agent-workspace

ENV NODE_ENV=production
ENV PORT=3005
ENV HOME=/tmp/claude-home

USER substrate

EXPOSE 3005

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3005/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
