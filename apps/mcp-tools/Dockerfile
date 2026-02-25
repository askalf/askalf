# Unified MCP Tools Server
# Consolidates mcp-workflow + mcp-data + mcp-infra into one container.
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/observability ./packages/observability
COPY apps/mcp-tools ./apps/mcp-tools

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first, then mcp-tools
RUN pnpm --filter @askalf/db build || true
RUN pnpm --filter @askalf/observability build && \
    pnpm --filter @askalf/mcp-tools build

# Deploy to a self-contained directory
RUN pnpm deploy --filter @askalf/mcp-tools --prod /app/deploy

# Remove unnecessary files from deploy
RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Production stage
FROM node:22-alpine AS runner

# Security: create non-root user
RUN addgroup -g 1001 substrate && \
    adduser -u 1001 -G substrate -s /bin/false -D substrate

WORKDIR /app

COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3010

USER substrate

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
