# MCP Workflow Server - Production build
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy package manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy workspace packages needed
COPY packages/db ./packages/db

# Copy this app
COPY apps/mcp-workflow ./apps/mcp-workflow

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Build shared package first, then app
RUN pnpm --filter @substrate/db build && \
    pnpm --filter @substrate/mcp-workflow build

# Deploy with production dependencies only
RUN pnpm deploy --filter @substrate/mcp-workflow --prod /app/deploy

# Remove unnecessary files
RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true

# Production stage
FROM node:20-slim AS runner

RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /bin/false substrate

WORKDIR /app

COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3010

USER substrate

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
