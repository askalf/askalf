# SUBSTRATE MCP Server - Optimized production build
# Uses Debian slim for isolated-vm (glibc) compatibility
FROM node:20-slim AS builder

# Install build dependencies for native modules (isolated-vm)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy package manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy workspace packages
COPY packages ./packages

# Copy MCP app
COPY apps/mcp ./apps/mcp

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build dependencies first
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/auth build && \
    pnpm --filter @substrate/ai build && \
    pnpm --filter @substrate/memory build && \
    pnpm --filter @substrate/sandbox build

# Build MCP
RUN pnpm --filter @substrate/mcp build:http

# Deploy with production dependencies only
RUN pnpm deploy --filter @substrate/mcp --prod /app/deploy

# Remove unnecessary files
RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Production stage - minimal Debian slim for glibc
FROM node:20-slim AS runner

# Security: create non-root user
RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /bin/false substrate

WORKDIR /app

# Copy deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3002

USER substrate

EXPOSE 3002

# Healthcheck using Node (no wget in slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/http.js"]
