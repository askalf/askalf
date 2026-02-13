# MCP ALF Server - Production build
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/db ./packages/db
COPY apps/mcp-alf ./apps/mcp-alf

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @substrate/db build && \
    pnpm --filter @substrate/mcp-alf build

RUN pnpm deploy --filter @substrate/mcp-alf --prod /app/deploy

RUN rm -rf /app/deploy/src 2>/dev/null || true && \
    find /app/deploy -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true && \
    find /app/deploy -name "*.map" -delete 2>/dev/null || true

FROM node:20-slim AS runner

RUN groupadd -g 1001 substrate && \
    useradd -u 1001 -g substrate -s /bin/false substrate

WORKDIR /app

COPY --from=builder --chown=substrate:substrate /app/deploy ./

ENV NODE_ENV=production
ENV PORT=3013

USER substrate

EXPOSE 3013

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3013/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
