#!/bin/bash
# SUBSTRATE Migration Baseline Script
#
# Initializes the postgres-migrations tracking table and marks
# all existing migrations as applied. Run this ONCE on databases
# that were initialized via docker-entrypoint-initdb.d.
#
# Usage:
#   ./scripts/baseline-migrations.sh
#
# Prerequisites:
#   - Database must already have the schema applied
#   - Run via Docker since postgres is in a container

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[baseline]${NC} $1"; }
warn() { echo -e "${YELLOW}[baseline]${NC} $1"; }
error() { echo -e "${RED}[baseline]${NC} $1"; exit 1; }

log "============================================"
log "SUBSTRATE Migration Baseline"
log "============================================"
log ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "sprayberry-labs-postgres"; then
  error "sprayberry-labs-postgres container is not running"
fi

# Check if migrations table already exists
EXISTS=$(docker exec sprayberry-labs-postgres psql -U substrate -d substrate -tAc \
  "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migrations');" 2>/dev/null)

if [ "$EXISTS" = "t" ]; then
  warn "Migrations table already exists!"
  log "Current migrations:"
  docker exec sprayberry-labs-postgres psql -U substrate -d substrate -c \
    "SELECT id, name FROM migrations ORDER BY id;"
  echo ""
  warn "If you need to re-baseline, drop the migrations table first:"
  warn "  docker exec sprayberry-labs-postgres psql -U substrate -d substrate -c 'DROP TABLE migrations;'"
  exit 0
fi

log "Creating migrations tracking table and baselining..."

# Create the migrations table and insert all existing migrations as applied
docker exec sprayberry-labs-postgres psql -U substrate -d substrate << 'EOF'
-- Create the migrations table (same schema as postgres-migrations)
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert all existing migrations as already applied
INSERT INTO migrations (name) VALUES
  ('001_initial_schema.sql'),
  ('002_add_intent_template.sql'),
  ('003_working_memory_enhancements.sql'),
  ('004_multi_tenancy.sql'),
  ('005_api_keys_enhancement.sql'),
  ('006_consumer_pivot.sql'),
  ('007_free_tier_rate_limits.sql'),
  ('010_alf_profiles.sql'),
  ('011_credit_system.sql'),
  ('012_add_system_visibility.sql'),
  ('013_shard_submissions.sql'),
  ('014_promo_codes.sql'),
  ('015_metacognition.sql')
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT 'Baselined ' || COUNT(*) || ' migrations' as result FROM migrations;
EOF

log ""
log "Baseline complete! Migration status:"
docker exec sprayberry-labs-postgres psql -U substrate -d substrate -c \
  "SELECT id, name, applied_at FROM migrations ORDER BY id;"

log ""
log "Future migrations will now be tracked properly."
log "Run migrations with: ./scripts/run-migrations.sh --docker"
