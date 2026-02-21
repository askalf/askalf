#!/usr/bin/env bash
# post-deploy-healthcheck.sh — Verify service health after deployment
# Usage: ./post-deploy-healthcheck.sh [service|all]
# Exit codes: 0 = all healthy, 1 = one or more failed

set -euo pipefail

# Service health endpoints (internal Docker network URLs)
declare -A HEALTH_URLS=(
  [forge]="http://127.0.0.1:3005/health"
  [dashboard]="http://127.0.0.1:3001/health"
  [mcp-tools]="http://127.0.0.1:3010/health"
  [nginx]="http://127.0.0.1/nginx-health"
  [searxng]="http://127.0.0.1:8080/healthz"
)

MAX_RETRIES=${HEALTHCHECK_RETRIES:-6}
RETRY_INTERVAL=${HEALTHCHECK_INTERVAL:-5}
FAILED=0
CHECKED=0

check_service() {
  local service="$1"
  local url="${HEALTH_URLS[$service]:-}"

  if [[ -z "$url" ]]; then
    echo "  [SKIP] $service — no health endpoint configured"
    return 0
  fi

  local attempt=1
  while [[ $attempt -le $MAX_RETRIES ]]; do
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

    if [[ "$http_code" == "200" ]]; then
      echo "  [OK]   $service — healthy (attempt $attempt)"
      return 0
    fi

    echo "  [WAIT] $service — got HTTP $http_code (attempt $attempt/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
    ((attempt++))
  done

  echo "  [FAIL] $service — unhealthy after $MAX_RETRIES attempts"
  return 1
}

# Determine which services to check
TARGET="${1:-all}"
echo "=== Post-Deploy Health Check ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

if [[ "$TARGET" == "all" ]]; then
  SERVICES=("forge" "dashboard" "mcp-tools" "nginx" "searxng")
else
  if [[ -z "${HEALTH_URLS[$TARGET]:-}" ]]; then
    echo "Unknown service: $TARGET"
    echo "Available: ${!HEALTH_URLS[*]}"
    exit 1
  fi
  SERVICES=("$TARGET")
fi

for svc in "${SERVICES[@]}"; do
  ((CHECKED++))
  if ! check_service "$svc"; then
    ((FAILED++))
  fi
done

echo ""
echo "=== Results: $((CHECKED - FAILED))/$CHECKED healthy ==="

if [[ $FAILED -gt 0 ]]; then
  echo "DEPLOY HEALTH CHECK FAILED — $FAILED service(s) unhealthy"
  exit 1
fi

echo "All services healthy."
exit 0
