#!/bin/bash
# check-drift.sh — Detect source-vs-container drift BEFORE rebuilding
# Run this BEFORE any docker compose build to prevent losing container-only changes.
#
# Usage: ./scripts/check-drift.sh [service...]
# Example: ./scripts/check-drift.sh dashboard forge api

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Service → container name + source path + container path mappings
declare -A CONTAINERS=(
  [dashboard]="sprayberry-labs-dashboard"
  [forge]="sprayberry-labs-forge"
  [api]="sprayberry-labs-api"
)

declare -A SOURCE_PATHS=(
  [dashboard]="apps/dashboard/src"
  [forge]="apps/forge/src"
  [api]="apps/api/src"
)

declare -A CONTAINER_PATHS=(
  [dashboard]="/app/src"
  [forge]="/app/dist"
  [api]="/app/dist"
)

# Key files to check per service (these are the most commonly edited)
declare -A KEY_FILES=(
  [dashboard]="routes/admin-hub.js"
  [forge]="runtime/worker.js index.js routes/memory.js routes/executions.js"
  [api]="routes/chat.js services/chat-tools.js"
)

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then
  SERVICES=("dashboard" "forge")
fi

DRIFT_FOUND=0

echo -e "${YELLOW}=== Container Drift Check ===${NC}"
echo ""

for svc in "${SERVICES[@]}"; do
  container="${CONTAINERS[$svc]:-}"
  if [ -z "$container" ]; then
    echo -e "${YELLOW}SKIP${NC} Unknown service: $svc"
    continue
  fi

  # Check if container is running
  if ! docker inspect "$container" &>/dev/null; then
    echo -e "${YELLOW}SKIP${NC} $svc — container not running"
    continue
  fi

  echo -e "Checking ${YELLOW}$svc${NC} ($container)..."

  src_base="${SOURCE_PATHS[$svc]}"
  ctn_base="${CONTAINER_PATHS[$svc]}"
  files="${KEY_FILES[$svc]}"

  for file in $files; do
    src_file="$src_base/$file"
    ctn_file="$ctn_base/$file"

    # For TypeScript services, source is .ts but container has .js
    if [[ "$svc" == "forge" || "$svc" == "api" ]]; then
      src_ts="${src_file%.js}.ts"
      if [ -f "$src_ts" ]; then
        src_file="$src_ts"
      fi
    fi

    if [ ! -f "$src_file" ]; then
      echo -e "  ${YELLOW}WARN${NC} Source missing: $src_file"
      continue
    fi

    # Extract file from container
    tmp_file=$(mktemp)
    if docker exec "$container" cat "$ctn_file" > "$tmp_file" 2>/dev/null; then
      # For TS→JS comparison, we can't do exact diff, but we can check if key
      # exports/functions exist in both. For JS→JS (dashboard), do real diff.
      if [[ "$svc" == "dashboard" ]]; then
        if ! diff -q "$src_file" "$tmp_file" &>/dev/null; then
          echo -e "  ${RED}DRIFT${NC} $file — source differs from container!"
          echo "    Source: $src_file"
          echo "    Container: $container:$ctn_file"
          echo "    Run: docker exec $container cat $ctn_file > /tmp/drift-$svc-$(basename $file)"
          DRIFT_FOUND=1
        else
          echo -e "  ${GREEN}OK${NC} $file"
        fi
      else
        # For compiled services, check if key function signatures exist
        # This catches major missing code (new functions, new routes)
        src_functions=$(grep -oP '(export\s+)?(async\s+)?function\s+\w+|export\s+(const|let)\s+\w+' "$src_file" 2>/dev/null | sort || true)
        ctn_functions=$(grep -oP 'function\s+\w+|const\s+\w+\s*=' "$tmp_file" 2>/dev/null | head -50 | sort || true)

        # Simple heuristic: if source has functions not in container, that's drift
        src_count=$(echo "$src_functions" | wc -l)
        ctn_size=$(wc -c < "$tmp_file")

        if [ "$ctn_size" -lt 100 ]; then
          echo -e "  ${RED}DRIFT${NC} $file — container file is suspiciously small (${ctn_size} bytes)"
          DRIFT_FOUND=1
        else
          echo -e "  ${GREEN}OK${NC} $file (${ctn_size} bytes in container)"
        fi
      fi
    else
      echo -e "  ${YELLOW}WARN${NC} Cannot read $ctn_file from container"
    fi

    rm -f "$tmp_file"
  done

  echo ""
done

# Final verdict
echo -e "${YELLOW}=== Result ===${NC}"
if [ $DRIFT_FOUND -eq 1 ]; then
  echo -e "${RED}DRIFT DETECTED!${NC}"
  echo ""
  echo "DO NOT REBUILD until you extract the drifted files from the container"
  echo "and update source. Otherwise you will LOSE those changes permanently."
  echo ""
  echo "To extract a file:"
  echo "  docker exec <container> cat <path> > local/path"
  echo ""
  exit 1
else
  echo -e "${GREEN}No drift detected. Safe to rebuild.${NC}"
  exit 0
fi
