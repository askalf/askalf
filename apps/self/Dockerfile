# SELF AI Server
FROM node:20-slim AS builder

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/self ./apps/self
COPY apps/self-ui ./apps/self-ui

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build frontend (outputs to apps/self/public/app/)
RUN pnpm --filter @substrate/self-ui build

# Build packages in dependency order then self
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/events build && \
    pnpm --filter @substrate/ai build && \
    pnpm --filter @substrate/auth build && \
    pnpm --filter @substrate/memory build && \
    pnpm --filter @substrate/self-core build && \
    pnpm --filter @substrate/self build

# Copy SQL migrations into dist/ (tsc doesn't copy non-ts files)
RUN cp -r /app/apps/self/src/migrations /app/apps/self/dist/migrations 2>/dev/null || true

# Deploy to a self-contained directory
RUN pnpm deploy --filter @substrate/self --prod /app/deploy

# Copy built frontend assets into deploy
RUN cp -r /app/apps/self/public /app/deploy/public 2>/dev/null || true

# Remove unnecessary files from deploy
RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Production stage
FROM node:20-slim AS runner

# Security: create non-root user
RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /bin/false substrate

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3006

USER substrate

EXPOSE 3006

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3006/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
