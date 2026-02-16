# JUST PUSH — Optimized production build
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ linux-headers

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/just-push ./apps/just-push

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Build required workspace packages
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/auth build

# Build Just Push server (TypeScript)
RUN pnpm --filter @substrate/just-push build

# Build React client
WORKDIR /app/apps/just-push/client
RUN npm install && npm run build

WORKDIR /app

# Deploy to a self-contained directory with all dependencies
RUN pnpm deploy --filter @substrate/just-push --prod /app/deploy

# Clean deploy: remove source, client, and dev artifacts (dist/ and public/ already included by pnpm deploy)
RUN rm -rf /app/deploy/client /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Production stage - minimal Alpine
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -g 1001 -S substrate && \
    adduser -S -u 1001 -G substrate substrate

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3008

USER substrate

EXPOSE 3008

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3008/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
