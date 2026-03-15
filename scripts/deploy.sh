#!/usr/bin/env bash
# Deploy one or more services (build + restart).
# Usage: ./scripts/deploy.sh forge
#        ./scripts/deploy.sh forge dashboard
#        ./scripts/deploy.sh forge --no-cache
#
# Works in bash/Linux environments. Uses docker-proxy TCP socket as fallback
# if /var/run/docker.sock is not accessible.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Docker host resolution ---
# Prefer Unix socket; fall back to TCP proxy used in agent execution contexts.
if [ -S /var/run/docker.sock ] && [ -r /var/run/docker.sock ]; then
    export DOCKER_HOST="unix:///var/run/docker.sock"
elif [ -n "${DOCKER_HOST:-}" ]; then
    : # already set by caller
else
    export DOCKER_HOST="tcp://docker-proxy:2375"
fi

# --- Argument parsing ---
SERVICES=()
NO_CACHE=""
for arg in "$@"; do
    case "$arg" in
        -NoCache|--no-cache) NO_CACHE="--no-cache" ;;
        *) SERVICES+=("$arg") ;;
    esac
done

if [ ${#SERVICES[@]} -eq 0 ]; then
    echo "ERROR: No services specified" >&2
    echo "Usage: deploy.sh <service> [service2] [--no-cache]"
    exit 1
fi

SERVICE_LIST="${SERVICES[*]}"

# --- Step 1: Build ---
echo "=== BUILD: ${SERVICE_LIST}${NO_CACHE:+ (no-cache)} ==="
BUILD_START=$(date +%s)

docker compose \
    -f "$ROOT_DIR/docker-compose.selfhosted.yml" \
    --env-file "$ROOT_DIR/.env.production" \
    build $NO_CACHE "${SERVICES[@]}"

BUILD_END=$(date +%s)
BUILD_TIME=$(( BUILD_END - BUILD_START ))
echo "Build complete (${BUILD_TIME}s)"

# --- Step 2: Deploy ---
echo ""
echo "=== DEPLOY: ${SERVICE_LIST} ==="

docker compose \
    -f "$ROOT_DIR/docker-compose.selfhosted.yml" \
    --env-file "$ROOT_DIR/.env.production" \
    up -d --no-deps "${SERVICES[@]}"

# --- Step 3: Verify ---
echo ""
echo "=== VERIFY ==="
sleep 5

ALL_HEALTHY=true
DEPLOY_START=${BUILD_START}

for svc in "${SERVICES[@]}"; do
    CONTAINER="askalf-${svc}"
    STATUS=$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")
    HEALTH=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || echo "unknown")

    if [ "$STATUS" = "running" ]; then
        echo "  $svc : running ($HEALTH)"
    else
        echo "  $svc : $STATUS" >&2
        ALL_HEALTHY=false
    fi
done

echo ""
if $ALL_HEALTHY; then
    TOTAL_TIME=$(( $(date +%s) - DEPLOY_START ))
    echo "DEPLOY SUCCESS: ${SERVICE_LIST} (${TOTAL_TIME}s total)"

    # Record deployment in history
    HISTORY_FILE="$ROOT_DIR/.deployment-history"
    GIT_SHA=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
    TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%SZ")
    SERVICE_STRING="${SERVICES[*]}"
    SERVICE_STRING="${SERVICE_STRING// /,}"

    if [ ! -f "$HISTORY_FILE" ]; then
        echo "# Deployment history (format: TIMESTAMP|SERVICE1,SERVICE2|GIT_SHA|STATUS)" > "$HISTORY_FILE"
    fi
    echo "${TIMESTAMP}|${SERVICE_STRING}|${GIT_SHA}|success" >> "$HISTORY_FILE"
    echo "Deployment recorded in history"

    exit 0
else
    echo "DEPLOY WARNING: Some services not running" >&2
    exit 1
fi
