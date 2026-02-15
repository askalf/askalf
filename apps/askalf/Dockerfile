# Ask Alf — Universal Chat Service
FROM node:20-slim AS builder

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/askalf ./apps/askalf

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build askalf
RUN pnpm --filter @substrate/askalf build

# Deploy to a self-contained directory
RUN pnpm deploy --filter @substrate/askalf --prod /app/deploy

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
    useradd -u 1001 -g substrate -s /bin/false -m substrate

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3007

USER substrate

EXPOSE 3007

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3007/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
