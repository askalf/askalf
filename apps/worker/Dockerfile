# SUBSTRATE Worker - Optimized production build
# Uses Debian slim for isolated-vm (glibc) compatibility via @substrate/metabolic
FROM node:20-slim AS builder

# Install build dependencies for native modules (isolated-vm)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Build all packages and worker
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/events build && \
    pnpm --filter @substrate/ai build && \
    pnpm --filter @substrate/sandbox build && \
    pnpm --filter @substrate/memory build && \
    pnpm --filter @substrate/metabolic build && \
    pnpm --filter @substrate/worker build

# Deploy to a self-contained directory with all dependencies
RUN pnpm deploy --filter @substrate/worker --prod /app/deploy

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

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production

USER substrate

CMD ["node", "dist/index.js"]
