# Self AI Service
FROM node:20-slim AS builder

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/self ./apps/self
COPY packages/observability ./packages/observability

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build self
RUN pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/self build

# Deploy to a self-contained directory
RUN pnpm deploy --filter @substrate/self --prod /app/deploy

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

# Install procps for pgrep (process tree kill on CLI timeout)
RUN apk add --no-cache procps

# Install Claude Code CLI globally for conversation execution
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
ENV PORT=3006
ENV HOME=/tmp/claude-home

USER substrate

EXPOSE 3006

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3006/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
