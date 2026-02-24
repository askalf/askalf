# SUBSTRATE Dashboard - Optimized production build
FROM node:22-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ linux-headers

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Build required packages
RUN pnpm --filter @substrate/core build && \
    pnpm --filter @substrate/observability build && \
    pnpm --filter @substrate/database build && \
    pnpm --filter @substrate/auth build && \
    pnpm --filter @substrate/email build

# Build React client
WORKDIR /app/apps/dashboard/client
RUN npm install && npm run build

WORKDIR /app

# Deploy to a self-contained directory with all dependencies
RUN pnpm deploy --filter @substrate/dashboard --prod /app/deploy

# Remove unnecessary files from deploy
RUN rm -rf /app/deploy/client && \
    rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Copy source files and static assets
# Vite outputs to public/app/ (including client/public/* assets like favicon.png, og-image.png)
# docs.html lives in public/ root (served separately by server.js)
RUN cp -r /app/apps/dashboard/src /app/deploy/src && \
    mkdir -p /app/deploy/public && \
    cp -r /app/apps/dashboard/public/app /app/deploy/public/app && \
    cp /app/apps/dashboard/public/docs.html /app/deploy/public/docs.html

# Claude Code CLI stage - install in isolation, extract only the binary
FROM node:22-alpine AS claude-installer

RUN apk add --no-cache bash curl python3 make g++ && \
    npm install -g @anthropic-ai/claude-code && \
    claude install --force && \
    npm uninstall -g @anthropic-ai/claude-code && \
    apk del python3 make g++

# Production stage - minimal Alpine
FROM node:22-alpine AS runner

# Runtime deps only: bash (node-pty), git (claude), curl (healthchecks)
RUN apk add --no-cache bash git curl

# Copy Claude binary from installer stage
COPY --from=claude-installer /root/.local/bin/claude /usr/local/bin/claude

# Security: run as non-root
RUN addgroup -g 1001 -S substrate && \
    adduser -S -u 1001 -G substrate substrate && \
    mkdir -p /home/substrate/.local/bin && \
    cp /usr/local/bin/claude /home/substrate/.local/bin/claude && \
    chown -R substrate:substrate /home/substrate/.local

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3001

USER substrate

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
