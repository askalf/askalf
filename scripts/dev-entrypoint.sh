#!/bin/bash
set -e

echo "=== Hot-Reload Dev Entrypoint ==="
echo "Service: $DEV_SERVICE"

# Suppress interactive prompts (pnpm asks about reinstalling node_modules)
export CI=true

# Use a container-local pnpm store (NOT the bind mount).
# Docker Desktop's 9P/grpcfuse on Windows causes ENOMEM when multiple containers
# access the pnpm store on the bind mount simultaneously.
STORE_FLAG="--store-dir /pnpm-store"

# 1. Install dependencies (fast if node_modules volume already populated)
#    Anonymous volumes mask host's Windows-built node_modules, so pnpm
#    creates everything fresh for Linux on first run, then reuses on restart.
echo "--- Installing dependencies ---"
pnpm install --frozen-lockfile $STORE_FLAG 2>/dev/null || pnpm install $STORE_FLAG

# Rebuild native addons (bcrypt, isolated-vm, etc.) for Linux platform.
# Fast no-op if already compiled correctly; essential on first run where
# the pnpm store may have cached packages from a different platform.
echo "--- Rebuilding native modules ---"
pnpm rebuild $STORE_FLAG 2>&1 | tail -5
echo "--- Dependencies ready ---"

# 2. Build ALL shared packages (apps import dist/ output from packages)
#    pnpm -r handles dependency ordering automatically.
#    --filter './packages/**' builds only packages, not apps (apps use tsx watch).
#    Continue on failure (|| true) — some packages may have TS errors that don't
#    affect the service being started. tsx watch will report any real import errors.
echo "--- Building shared packages ---"
pnpm --filter './packages/**' -r build || echo "WARNING: Some packages failed to build (non-critical)"
echo "--- Shared packages built ---"

# 3. Execute the dev command passed as CMD
echo "--- Starting: $@ ---"
exec "$@"
