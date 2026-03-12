#!/usr/bin/env bash
# Deployment rollback script for AskAlf
# Maintains deployment history and supports rolling back to previous git SHA
#
# Usage:
#   ./scripts/rollback.sh --list                    # List recent deployments
#   ./scripts/rollback.sh <service> [service2] ...  # Rollback specific services to previous SHA
#   ./scripts/rollback.sh <service> <SHA>           # Rollback specific service to exact SHA

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
HISTORY_FILE="${ROOT_DIR}/.deployment-history"
MAX_KEPT_DEPLOYMENTS=3

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${CYAN}=== $1 ===${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    exit 1
}

init_history() {
    if [[ ! -f "$HISTORY_FILE" ]]; then
        echo "# Deployment history (format: TIMESTAMP|SERVICE1,SERVICE2|GIT_SHA|STATUS)" > "$HISTORY_FILE"
    fi
}

record_deployment() {
    local services="$1"
    local sha="$2"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    echo "${timestamp}|${services}|${sha}|success" >> "$HISTORY_FILE"

    # Keep only last N deployments
    local line_count=$(wc -l < "$HISTORY_FILE")
    if (( line_count > MAX_KEPT_DEPLOYMENTS + 1 )); then
        # Keep header + MAX_KEPT_DEPLOYMENTS lines
        head -n $((MAX_KEPT_DEPLOYMENTS + 1)) "$HISTORY_FILE" > "${HISTORY_FILE}.tmp"
        mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
    fi
}

get_current_sha() {
    git -C "$ROOT_DIR" rev-parse HEAD
}

get_last_deployment_sha() {
    local services="${1:-}"
    # Get the most recent deployment entry
    if [[ -z "$services" ]]; then
        tail -1 "$HISTORY_FILE" 2>/dev/null | cut -d'|' -f3 || echo ""
    else
        grep "|${services}|" "$HISTORY_FILE" 2>/dev/null | tail -1 | cut -d'|' -f3 || echo ""
    fi
}

list_deployments() {
    log_info "Recent Deployments"
    echo ""
    echo "Current HEAD: $(get_current_sha | cut -c1-7)"
    echo ""
    tail -n $((MAX_KEPT_DEPLOYMENTS + 1)) "$HISTORY_FILE" | tail -n +2 | awk -F'|' '{
        printf "  %s | Services: %-25s | SHA: %s\n", $1, $3, substr($2, 1, 30)
    }' || echo "  (no deployments yet)"
    echo ""
}

validate_services() {
    local valid_services=("dashboard" "forge" "mcp-tools" "admin-console")
    for service in "$@"; do
        if [[ ! " ${valid_services[@]} " =~ " ${service} " ]]; then
            log_error "Unknown service: $service"
        fi
    done
}

rollback_to_sha() {
    local sha="$1"
    shift
    local services=("$@")

    log_info "Rolling back to SHA ${sha:0:7}"

    cd "$ROOT_DIR"

    # Verify SHA exists
    if ! git rev-parse "$sha" &>/dev/null; then
        log_error "Invalid git SHA: $sha"
    fi

    # Checkout the SHA
    log_info "Checking out $sha"
    git checkout "$sha" -q || log_error "Failed to checkout $sha"

    # Build services
    log_info "Building services: ${services[*]}"
    if command -v powershell.exe &> /dev/null; then
        # Windows/Git Bash
        powershell.exe -NoProfile -File "$SCRIPT_DIR/deploy.ps1" "${services[@]}" || log_error "Build failed"
    else
        # Native bash (fallback — update as needed)
        log_error "Bash deployment not yet implemented. Use deploy.ps1 or Windows PowerShell."
    fi

    log_success "Rollback to ${sha:0:7} completed"

    # Verify health
    log_info "Validating service health"
    sleep 5
    validate_health "${services[@]}" || log_error "Health check failed after rollback"

    # Record in history
    record_deployment "$(IFS=,; echo "${services[*]}")" "$sha"
    log_success "Rollback recorded in deployment history"
}

validate_health() {
    local all_healthy=true
    for service in "$@"; do
        if docker compose -f "docker-compose.selfhosted.yml" ps "$service" 2>/dev/null | grep -q "healthy\|running"; then
            log_success "$service is healthy"
        else
            log_error "$service failed health check"
            all_healthy=false
        fi
    done

    if [[ "$all_healthy" == false ]]; then
        return 1
    fi
}

# Main logic
init_history

if [[ $# -eq 0 ]]; then
    list_deployments
elif [[ "$1" == "--list" ]]; then
    list_deployments
elif [[ -z "${2:-}" ]]; then
    # Single service — rollback to previous deployment of that service
    validate_services "$1"
    prev_sha=$(get_last_deployment_sha "$1")
    if [[ -z "$prev_sha" ]]; then
        log_error "No previous deployment found for $1"
    fi
    rollback_to_sha "$prev_sha" "$1"
else
    # Check if second arg is a SHA or service name
    if [[ "${2}" =~ ^[0-9a-f]{7,40}$ ]]; then
        # Second arg is a SHA
        validate_services "$1"
        rollback_to_sha "$2" "$1"
    else
        # Multiple services without explicit SHA — rollback all to most recent common SHA
        validate_services "$@"
        prev_sha=$(get_last_deployment_sha)
        if [[ -z "$prev_sha" ]]; then
            log_error "No previous deployment found"
        fi
        rollback_to_sha "$prev_sha" "$@"
    fi
fi
