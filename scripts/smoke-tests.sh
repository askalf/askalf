#!/usr/bin/env bash
# smoke-tests.sh — Post-deployment smoke tests for critical services
# Validates: HTTP health endpoints, database connectivity, Redis connectivity, MCP tools
# Usage: ./scripts/smoke-tests.sh
# Exit codes: 0 = all tests pass, 1 = one or more tests failed

set -euo pipefail

# Configuration
MAX_RETRIES=${SMOKE_TEST_RETRIES:-10}
RETRY_INTERVAL=${SMOKE_TEST_INTERVAL:-2}
TESTS_FAILED=0
TESTS_PASSED=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# === HELPER FUNCTIONS ===

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((TESTS_PASSED++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((TESTS_FAILED++))
}

log_wait() {
  echo -e "${YELLOW}[WAIT]${NC} $1"
}

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

# === TEST 1: HTTP HEALTH ENDPOINTS ===

test_http_health() {
  local service="$1"
  local url="$2"
  local attempt=1

  log_info "Testing HTTP health: $service ($url)"

  while [[ $attempt -le $MAX_RETRIES ]]; do
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

    if [[ "$http_code" == "200" ]]; then
      log_pass "HTTP health check: $service"
      return 0
    fi

    log_wait "HTTP $http_code for $service (attempt $attempt/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
    ((attempt++))
  done

  log_fail "HTTP health check: $service (failed after $MAX_RETRIES attempts)"
  return 1
}

# === TEST 2: DATABASE CONNECTIVITY VIA API ===

test_database_connectivity() {
  log_info "Testing database connectivity via API"
  local attempt=1

  while [[ $attempt -le $MAX_RETRIES ]]; do
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3005/api/v1/forge/agents" 2>/dev/null || echo "000")

    # 200 = success, 401 = unauthorized (still means DB is up)
    if [[ "$response" == "200" ]] || [[ "$response" == "401" ]] || [[ "$response" == "403" ]]; then
      log_pass "Database connectivity via API"
      return 0
    fi

    log_wait "Database API response: $response (attempt $attempt/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
    ((attempt++))
  done

  log_fail "Database connectivity via API (no response after $MAX_RETRIES attempts)"
  return 1
}

# === TEST 3: REDIS CONNECTIVITY ===

test_redis_connectivity() {
  log_info "Testing Redis connectivity"
  local attempt=1

  while [[ $attempt -le $MAX_RETRIES ]]; do
    # Try to ping Redis using nc (netcat) with timeout
    if timeout 5 bash -c "echo 'PING' | nc -q 1 127.0.0.1 6379 2>/dev/null | grep -q 'PONG'" 2>/dev/null; then
      log_pass "Redis connectivity"
      return 0
    fi

    log_wait "Redis not responding (attempt $attempt/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
    ((attempt++))
  done

  log_fail "Redis connectivity (no PONG after $MAX_RETRIES attempts)"
  return 1
}

# === TEST 4: MCP TOOLS SERVER ===

test_mcp_tools() {
  log_info "Testing MCP tools server (port 3010)"
  local attempt=1

  while [[ $attempt -le $MAX_RETRIES ]]; do
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3010/health" 2>/dev/null || echo "000")

    if [[ "$response" == "200" ]]; then
      log_pass "MCP tools server health check"
      return 0
    fi

    log_wait "MCP tools server HTTP $response (attempt $attempt/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
    ((attempt++))
  done

  log_fail "MCP tools server health check (failed after $MAX_RETRIES attempts)"
  return 1
}

# === MAIN EXECUTION ===

main() {
  echo ""
  echo "========================================"
  echo "  POST-DEPLOY SMOKE TESTS"
  echo "========================================"
  echo "Start time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  # Give containers a moment to settle
  log_info "Waiting for containers to stabilize..."
  sleep 3

  # Run all tests
  test_http_health "forge" "http://127.0.0.1:3005/health" || true
  test_http_health "dashboard" "http://127.0.0.1:3001/health" || true
  test_http_health "nginx" "http://127.0.0.1/nginx-health" || true
  test_database_connectivity || true
  test_redis_connectivity || true
  test_mcp_tools || true

  # Summary
  echo ""
  echo "========================================"
  local total=$((TESTS_PASSED + TESTS_FAILED))
  echo "Results: ${GREEN}${TESTS_PASSED}${NC}/${total} tests passed"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "${RED}SMOKE TESTS FAILED${NC} — ${TESTS_FAILED} test(s) failed"
    echo "========================================"
    echo ""
    return 1
  fi

  echo -e "${GREEN}SMOKE TESTS PASSED${NC} — All critical services healthy"
  echo "========================================"
  echo ""
  return 0
}

main "$@"
