# Unified MCP Tools Server
# Consolidates mcp-workflow + mcp-data + mcp-infra into one container.
FROM node:25-alpine@sha256:ad82ecad30371c43f4057aaa4800a8ed88f9446553a2d21323710c7b937177fc AS builder

# Install build dependencies for native modules (node-pty from workspace peers)
RUN apk add --no-cache python3 make g++ linux-headers

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files — all package.json files needed for frozen lockfile resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/database-adapter/package.json ./packages/database-adapter/package.json
COPY packages/redis-adapter/package.json ./packages/redis-adapter/package.json
COPY packages/observability/package.json ./packages/observability/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/agent-cli/package.json ./packages/agent-cli/package.json
COPY apps/forge/package.json ./apps/forge/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/mcp-tools/package.json ./apps/mcp-tools/package.json
COPY apps/standalone/package.json ./apps/standalone/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/create-askalf/package.json ./packages/create-askalf/package.json


# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy full source for packages we need to build
COPY packages/database-adapter ./packages/database-adapter
COPY packages/redis-adapter ./packages/redis-adapter
COPY packages/db ./packages/db
COPY packages/observability ./packages/observability
COPY apps/mcp-tools ./apps/mcp-tools

# Build shared packages first, then mcp-tools
RUN pnpm --filter @askalf/database-adapter build && \
    pnpm --filter @askalf/redis-adapter build && \
    pnpm --filter @askalf/db build || true
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

# Production stage — Debian slim + Google Chrome (works in Docker Desktop WSL2)
FROM node:25-slim AS runner

# Install Chrome/Chromium for browser_use tool
# Google Chrome only available for amd64; use Chromium from Debian repos for arm64
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates fonts-freefont-ttf && \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      apt-get install -y --no-install-recommends wget gnupg && \
      wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google.gpg && \
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
      apt-get update -qq && \
      apt-get install -y --no-install-recommends google-chrome-stable && \
      rm -f /opt/google/chrome/chrome_crashpad_handler && \
      echo '#!/bin/sh' > /opt/google/chrome/chrome_crashpad_handler && \
      chmod +x /opt/google/chrome/chrome_crashpad_handler; \
    else \
      apt-get install -y --no-install-recommends chromium; \
    fi && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Security: create non-root user
RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /usr/sbin/nologin -m substrate

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3010

USER substrate

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
