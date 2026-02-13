# MCP Infrastructure Server - Production build
FROM node:20-slim AS builder

# Need build tools for potential native modules
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/db ./packages/db
COPY apps/mcp-infra ./apps/mcp-infra

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @substrate/db build && \
    pnpm --filter @substrate/mcp-infra build

RUN pnpm deploy --filter @substrate/mcp-infra --prod /app/deploy

RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true

FROM node:20-slim AS runner

# Install pnpm for outdated check in dependency_check
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /bin/false substrate

WORKDIR /app

COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3012
ENV REPO_ROOT=/workspace

USER substrate

EXPOSE 3012

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3012/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
