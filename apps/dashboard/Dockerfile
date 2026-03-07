# AskAlf Dashboard - Optimized production build
# Base image pinned to SHA-256 digest for reproducible builds
FROM node:22-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34 AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ linux-headers

# Install pnpm (pinned version)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# --- Layer-cache-friendly dependency install ---
# Copy only lockfile, workspace config, and package.json files first
# so pnpm install layer is only invalidated when deps change, not source
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy all workspace package.json files (pnpm needs them for resolution)
COPY packages/core/package.json ./packages/core/package.json
COPY packages/observability/package.json ./packages/observability/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/agent-cli/package.json ./packages/agent-cli/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

# Install all dependencies (cached unless package.json/lockfile change)
RUN pnpm install --frozen-lockfile

# Now copy full source for build
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard

# Build required packages
RUN pnpm --filter @askalf/core build && \
    pnpm --filter @askalf/observability build && \
    pnpm --filter @askalf/database build && \
    pnpm --filter @askalf/auth build && \
    pnpm --filter @askalf/email build

# Build React client
ARG SELFHOSTED=false
ENV SELFHOSTED=${SELFHOSTED}
WORKDIR /app/apps/dashboard/client
RUN npm install && npm run build

WORKDIR /app

# Deploy to a self-contained directory with all dependencies
RUN pnpm deploy --filter @askalf/dashboard --prod /app/deploy

# Remove unnecessary files from deploy
RUN rm -rf /app/deploy/client && \
    rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.md" -delete 2>/dev/null || true && \
    find /app/deploy -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find /app/deploy -name "LICENSE*" -delete 2>/dev/null || true && \
    rm -rf /app/deploy/node_modules/.cache 2>/dev/null || true

# Copy only compiled JS server files and static assets
# (src/ contains .js files only — no .ts source)
# Vite outputs to public/app/ (including client/public/* assets like favicon.png, og-image.png)
# docs.html lives in public/ root (served separately by server.js)
RUN cp -r /app/apps/dashboard/src /app/deploy/src && \
    mkdir -p /app/deploy/public && \
    cp -r /app/apps/dashboard/public/app /app/deploy/public/app && \
    cp /app/apps/dashboard/public/docs.html /app/deploy/public/docs.html && \
    cp -f /app/apps/dashboard/client/public/*.gif /app/deploy/public/app/ 2>/dev/null || true && \
    cp -f /app/apps/dashboard/client/public/*.png /app/deploy/public/app/ 2>/dev/null || true

# Claude Code CLI stage - install in isolation, extract only the binary
FROM node:22-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34 AS claude-installer

RUN apk add --no-cache bash curl python3 make g++ && \
    npm install -g @anthropic-ai/claude-code && \
    claude install --force 2>&1 || true && \
    npm uninstall -g @anthropic-ai/claude-code && \
    apk del python3 make g++ && \
    test -f /root/.local/bin/claude

# Codex CLI stage - install with platform-specific native binary
FROM node:22-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34 AS codex-installer

RUN npm install -g @openai/codex && \
    codex --version

# Production stage - minimal Alpine
FROM node:22-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34 AS runner

# Runtime deps only: bash (node-pty), git (claude/codex), curl (healthchecks)
RUN apk add --no-cache bash git curl

# Security: run as non-root
RUN addgroup -g 1001 -S substrate && \
    adduser -S -u 1001 -G substrate substrate && \
    mkdir -p /home/substrate/.local/bin \
             /home/substrate/.claude-session \
             /home/substrate/.codex-session && \
    chown -R substrate:substrate /home/substrate

# Copy Claude binary directly to user home (single copy, no duplication)
COPY --from=claude-installer --chown=substrate:substrate /root/.local/bin/claude /home/substrate/.local/bin/claude

# Copy Codex CLI (full npm global install — includes platform-specific native binary)
COPY --from=codex-installer /usr/local/lib/node_modules/@openai /usr/local/lib/node_modules/@openai
# Must be a symlink (not a copy) so require.resolve() finds the native binary package
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex

WORKDIR /app

# Copy the deployed app
COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3001
ENV PATH="/home/substrate/.local/bin:${PATH}"

USER substrate

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
