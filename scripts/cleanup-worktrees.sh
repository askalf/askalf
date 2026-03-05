#!/usr/bin/env bash
# cleanup-worktrees.sh — Remove stale agent git worktrees older than MAX_AGE_HOURS
# Usage: ./scripts/cleanup-worktrees.sh [max_age_hours]
#
# Logs each removal action and prints a summary of worktree count + disk usage.

set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
MAX_AGE_HOURS="${1:-2}"
MAX_AGE_SECONDS=$(( MAX_AGE_HOURS * 3600 ))
WORKTREES_DIR="${WORKSPACE_ROOT}/.worktrees"
NOW=$(date +%s)
REMOVED=0
SKIPPED=0
ERRORS=0

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [worktree-cleanup] $*"
}

if [ ! -d "${WORKTREES_DIR}" ]; then
  log "No worktrees directory found at ${WORKTREES_DIR}, nothing to clean."
  exit 0
fi

log "Scanning ${WORKTREES_DIR} for worktrees older than ${MAX_AGE_HOURS}h..."

for worktree_path in "${WORKTREES_DIR}"/*/; do
  [ -d "${worktree_path}" ] || continue

  worktree_name=$(basename "${worktree_path}")

  # Get directory mtime as a proxy for last activity
  dir_mtime=$(stat -c "%Y" "${worktree_path}" 2>/dev/null || echo "${NOW}")
  age=$(( NOW - dir_mtime ))

  if [ "${age}" -lt "${MAX_AGE_SECONDS}" ]; then
    log "SKIP ${worktree_name} (age ${age}s < ${MAX_AGE_SECONDS}s threshold)"
    SKIPPED=$(( SKIPPED + 1 ))
    continue
  fi

  log "REMOVE ${worktree_name} (age ${age}s, last modified $(date -d "@${dir_mtime}" -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo 'unknown'))"

  # Use git worktree remove if this is a registered worktree; fall back to rm
  if git -C "${WORKSPACE_ROOT}" worktree list --porcelain 2>/dev/null | grep -q "worktree ${worktree_path%/}"; then
    if git -C "${WORKSPACE_ROOT}" worktree remove --force "${worktree_path%/}" 2>/dev/null; then
      log "  -> git worktree remove OK"
      REMOVED=$(( REMOVED + 1 ))
    else
      log "  -> git worktree remove failed, falling back to rm -rf"
      if rm -rf "${worktree_path}"; then
        git -C "${WORKSPACE_ROOT}" worktree prune 2>/dev/null || true
        log "  -> rm -rf OK, pruned stale refs"
        REMOVED=$(( REMOVED + 1 ))
      else
        log "  -> ERROR: could not remove ${worktree_name}"
        ERRORS=$(( ERRORS + 1 ))
      fi
    fi
  else
    # Not registered — just remove the directory
    if rm -rf "${worktree_path}"; then
      log "  -> rm -rf OK (unregistered worktree)"
      REMOVED=$(( REMOVED + 1 ))
    else
      log "  -> ERROR: could not remove ${worktree_name}"
      ERRORS=$(( ERRORS + 1 ))
    fi
  fi
done

# Prune any remaining stale git worktree metadata
git -C "${WORKSPACE_ROOT}" worktree prune 2>/dev/null || true

# Summary metrics
remaining=$(find "${WORKTREES_DIR}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l || echo 0)
disk_bytes=$(du -sb "${WORKTREES_DIR}" 2>/dev/null | cut -f1 || echo 0)

log "Done. removed=${REMOVED} skipped=${SKIPPED} errors=${ERRORS} remaining=${remaining} disk_bytes=${disk_bytes}"

# Emit structured JSON summary to stdout for log ingestion
echo "{\"event\":\"worktree_cleanup\",\"removed\":${REMOVED},\"skipped\":${SKIPPED},\"errors\":${ERRORS},\"remaining\":${remaining},\"disk_bytes\":${disk_bytes},\"timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}"
