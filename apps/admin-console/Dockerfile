# Admin Console — Standalone Super-Admin Terminal
# Simplified build: no TypeScript, no React, no workspace packages
# Key difference from dashboard: docker-cli installed + docker socket mounted

# Stage 1: Claude Code CLI installer (isolated stage)
FROM node:22-alpine AS claude-installer

RUN apk add --no-cache bash curl python3 make g++ && \
    npm install -g @anthropic-ai/claude-code && \
    claude install --force && \
    npm uninstall -g @anthropic-ai/claude-code && \
    apk del python3 make g++

# Stage 2: Install production dependencies (need native build tools for node-pty)
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

COPY apps/admin-console/package.json ./
RUN npm install --omit=dev

# Stage 3: Production runner
FROM node:22-alpine AS runner

# Runtime deps: bash (node-pty), git (claude), curl (healthchecks), docker-cli (container management), openssh-client (SSH to host)
RUN apk add --no-cache bash git curl docker-cli openssh-client

# Copy Claude binary from installer stage
COPY --from=claude-installer /root/.local/bin/claude /usr/local/bin/claude

# Security: run as non-root with docker group access
# Alpine has GID 999 taken (ping group), so create docker group without fixed GID
# At runtime, the mounted docker.sock's group will be matched via group_add in compose
RUN addgroup -S docker && \
    addgroup -g 1001 -S substrate && \
    adduser -S -u 1001 -G substrate substrate && \
    addgroup substrate docker && \
    mkdir -p /home/substrate/.local/bin && \
    cp /usr/local/bin/claude /home/substrate/.local/bin/claude && \
    chown -R substrate:substrate /home/substrate/.local

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps --chown=substrate:substrate /app/node_modules ./node_modules

# Copy source files (plain JS, no build needed)
COPY --chown=substrate:substrate apps/admin-console/package.json ./
COPY --chown=substrate:substrate apps/admin-console/src ./src

# Pre-create the claude home dir and SSH config so Docker initializes empty volumes with correct ownership
RUN mkdir -p /tmp/admin-claude-home/.ssh && \
    chmod 700 /tmp/admin-claude-home/.ssh && \
    chown -R substrate:substrate /tmp/admin-claude-home

ENV NODE_ENV=production
ENV PORT=3002

USER substrate

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
