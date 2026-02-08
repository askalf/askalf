#!/bin/bash
# SUBSTRATE Database Migration Script
#
# Runs database migrations against the production database.
# Can be run locally or inside a Docker container.
#
# Usage:
#   ./scripts/run-migrations.sh              # Run migrations
#   ./scripts/run-migrations.sh status       # Show migration status
#   ./scripts/run-migrations.sh --docker     # Run via docker exec
#
# Environment:
#   DATABASE_URL or POSTGRES_* variables must be set
#   Or use --docker to run inside the API container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[migrate]${NC} $1"; }
warn() { echo -e "${YELLOW}[migrate]${NC} $1"; }
error() { echo -e "${RED}[migrate]${NC} $1"; exit 1; }

# Parse arguments
USE_DOCKER=false
COMMAND="up"

while [[ $# -gt 0 ]]; do
  case $1 in
    --docker|-d)
      USE_DOCKER=true
      shift
      ;;
    status|up|down)
      COMMAND="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$USE_DOCKER" = true ]; then
  log "Running migrations via Docker..."

  # Check if container is running
  if ! docker ps --format '{{.Names}}' | grep -q "substrate-prod-api"; then
    error "substrate-prod-api container is not running"
  fi

  # Run migrations inside the API container (it has the built migrate.js)
  docker exec -it substrate-prod-api node -e "
    const { migrate } = require('postgres-migrations');
    const { Client } = require('pg');
    const path = require('path');

    async function run() {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();

      const migrationsDir = '/app/node_modules/@substrate/database/dist/migrations';
      console.log('Running migrations from:', migrationsDir);

      try {
        const applied = await migrate({ client }, migrationsDir);
        if (applied.length === 0) {
          console.log('No new migrations to apply.');
        } else {
          console.log('Applied', applied.length, 'migration(s)');
          applied.forEach(m => console.log('  ✓', m.name));
        }
      } finally {
        await client.end();
      }
    }

    run().catch(e => { console.error(e); process.exit(1); });
  "

else
  log "Running migrations locally..."

  # Check for required environment
  if [ -z "$DATABASE_URL" ] && [ -z "$POSTGRES_PASSWORD" ]; then
    # Try to load from .env.production
    if [ -f "$PROJECT_DIR/.env.production" ]; then
      log "Loading environment from .env.production..."
      export $(grep -v '^#' "$PROJECT_DIR/.env.production" | xargs)
    else
      error "DATABASE_URL or POSTGRES_* environment variables not set"
    fi
  fi

  # Build database package if needed
  if [ ! -f "$PROJECT_DIR/packages/database/dist/migrate.js" ]; then
    log "Building @substrate/database package..."
    cd "$PROJECT_DIR"
    pnpm --filter @substrate/database build
  fi

  cd "$PROJECT_DIR/packages/database"

  case $COMMAND in
    up)
      log "Applying migrations..."
      node dist/migrate.js up
      ;;
    status)
      log "Checking migration status..."
      node dist/migrate.js status
      ;;
    down)
      error "Down migrations not supported. Create a new migration to reverse changes."
      ;;
  esac
fi

log "Done!"
