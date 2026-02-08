#!/bin/bash
# SUBSTRATE Docker Cleanup Script
# Run weekly to prevent disk bloat
# Add to crontab: 0 3 * * 0 /path/to/substrate/scripts/docker-cleanup.sh >> /var/log/docker-cleanup.log 2>&1

set -e

echo "=== Docker Cleanup Started: $(date) ==="

# Prune build cache older than 7 days
echo "Pruning build cache..."
docker builder prune -f --filter "until=168h"

# Prune dangling images
echo "Pruning dangling images..."
docker image prune -f

# Prune unused networks (not used by running containers)
echo "Pruning unused networks..."
docker network prune -f

# Remove exited containers older than 24h
echo "Removing old exited containers..."
docker container prune -f --filter "until=24h"

# Show disk usage after cleanup
echo ""
echo "=== Disk Usage After Cleanup ==="
docker system df

echo ""
echo "=== Cleanup Complete: $(date) ==="
