#!/usr/bin/env bash
# AskAlf — Migrate from Standalone (npx) to Docker Production Stack
#
# Usage: bash scripts/migrate-to-docker.sh
#
# What this does:
#   1. Reads your standalone config (~/.askalf/.env)
#   2. Exports your PGlite database to a SQL dump
#   3. Generates a Docker-compatible .env file
#   4. Pulls the docker-compose stack
#   5. Imports your data into PostgreSQL
#   6. Starts the full production stack
#
# Your standalone data is NOT deleted — you can roll back at any time.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}  ╔═══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}  ║   AskAlf: Standalone → Docker Migration   ║${NC}"
echo -e "${BOLD}  ╚═══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Find standalone config ──
STANDALONE_DIR="${ASKALF_DATA_DIR:-$HOME/.askalf}"
if [ "$(uname -s)" = "MINGW"* ] || [ "$(uname -s)" = "CYGWIN"* ] || [ -n "${APPDATA:-}" ]; then
  STANDALONE_DIR="${ASKALF_DATA_DIR:-${APPDATA}/askalf}"
fi

if [ ! -f "$STANDALONE_DIR/.env" ]; then
  fail "No standalone install found at $STANDALONE_DIR/.env"
fi

ok "Found standalone config at $STANDALONE_DIR/.env"

# ── 2. Check Docker prerequisites ──
if ! command -v docker &>/dev/null; then
  fail "Docker is required. Install: https://docs.docker.com/get-docker/"
fi
if ! docker compose version &>/dev/null; then
  fail "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin."
fi
ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"
ok "$(docker compose version)"

# ── 3. Read standalone config ──
info "Reading standalone configuration..."

source_env() {
  while IFS= read -r line; do
    line="${line%%\#*}"  # strip comments
    line="${line%"${line##*[![:space:]]}"}"  # trim trailing
    [ -z "$line" ] && continue
    if [[ "$line" == *=* ]]; then
      local key="${line%%=*}"
      local val="${line#*=}"
      export "$key=$val" 2>/dev/null || true
    fi
  done < "$1"
}

source_env "$STANDALONE_DIR/.env"

ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-}"
OPENAI_KEY="${OPENAI_API_KEY:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
JWT_SECRET="${JWT_SECRET:-}"
SESSION_SECRET="${SESSION_SECRET:-}"
FORGE_API_KEY="${FORGE_API_KEY:-}"
CHANNEL_ENCRYPTION_KEY="${CHANNEL_ENCRYPTION_KEY:-}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-}"

ok "API keys and secrets loaded"

# ── 4. Choose Docker install directory ──
DOCKER_DIR="${1:-$(pwd)}"
if [ "$DOCKER_DIR" = "$(pwd)" ]; then
  echo ""
  echo -e "  ${BOLD}Where should the Docker stack live?${NC}"
  echo -e "  Default: $(pwd)"
  read -r -p "  Directory: " USER_DIR
  DOCKER_DIR="${USER_DIR:-$(pwd)}"
fi

mkdir -p "$DOCKER_DIR"
cd "$DOCKER_DIR"
ok "Docker stack directory: $DOCKER_DIR"

# ── 5. Export PGlite data ──
PGLITE_DIR="$STANDALONE_DIR/data/pglite"

if [ -d "$PGLITE_DIR" ]; then
  info "Exporting PGlite database..."

  # Use Node.js to dump PGlite to SQL
  DUMP_FILE="$DOCKER_DIR/standalone-data.sql"

  node -e "
    const { createAdapter } = require('@askalf/database-adapter');
    (async () => {
      const db = await createAdapter({ mode: 'pglite', dataDir: '$PGLITE_DIR' });
      const tables = await db.query(\"SELECT tablename FROM pg_tables WHERE schemaname = 'public'\");
      const fs = require('fs');
      let sql = '-- AskAlf Standalone Data Export\\n-- Generated: ' + new Date().toISOString() + '\\n\\n';

      for (const { tablename } of tables) {
        try {
          const rows = await db.query('SELECT * FROM ' + tablename);
          if (rows.length === 0) continue;
          const cols = Object.keys(rows[0]);
          for (const row of rows) {
            const vals = cols.map(c => {
              const v = row[c];
              if (v === null) return 'NULL';
              if (typeof v === 'number') return String(v);
              if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
              return \"'\" + String(v).replace(/'/g, \"''\") + \"'\";
            });
            sql += 'INSERT INTO ' + tablename + ' (' + cols.join(', ') + ') VALUES (' + vals.join(', ') + ') ON CONFLICT DO NOTHING;\\n';
          }
          sql += '\\n';
        } catch {}
      }

      fs.writeFileSync('$DUMP_FILE', sql);
      const lines = sql.split('\\n').filter(l => l.startsWith('INSERT')).length;
      console.log('  Exported ' + lines + ' rows from ' + tables.length + ' tables');
      await db.close();
    })().catch(err => {
      console.error('  Warning: PGlite export failed:', err.message);
      console.error('  Continuing without data migration...');
    });
  " 2>/dev/null || warn "PGlite export skipped (install may be fresh)"

  if [ -f "$DUMP_FILE" ]; then
    ok "Data exported to $DUMP_FILE"
  fi
else
  warn "No PGlite data found — starting fresh"
fi

# ── 6. Generate Docker .env ──
info "Generating Docker configuration..."

generate_secret() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p; }

ENV_FILE="$DOCKER_DIR/.env"
cat > "$ENV_FILE" <<ENVEOF
# AskAlf Docker Configuration
# Migrated from standalone on $(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── AI Providers ──
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
OPENAI_API_KEY=${OPENAI_KEY}

# ── Admin ──
ADMIN_EMAIL=${ADMIN_EMAIL}

# ── Security (preserved from standalone) ──
JWT_SECRET=${JWT_SECRET:-$(generate_secret 32)}
SESSION_SECRET=${SESSION_SECRET:-$(generate_secret 32)}
FORGE_API_KEY=${FORGE_API_KEY:-fk_$(generate_secret 24)}
CHANNEL_ENCRYPTION_KEY=${CHANNEL_ENCRYPTION_KEY:-$(generate_secret 32)}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET:-$(generate_secret 32)}

# ── Database ──
POSTGRES_PASSWORD=$(generate_secret 24)
DATABASE_URL=postgresql://askalf:\${POSTGRES_PASSWORD}@postgres:5432/askalf

# ── Redis ──
REDIS_URL=redis://redis:6379

# ── Version ──
ASKALF_VERSION=latest
ENVEOF

ok "Docker .env saved"

# ── 7. Download docker-compose ──
if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
  info "Downloading docker-compose.yml..."
  curl -fsSL "https://raw.githubusercontent.com/askalf/askalf/main/docker-compose.selfhosted.yml" -o "$DOCKER_DIR/docker-compose.yml" 2>/dev/null \
    || fail "Could not download docker-compose.yml"
  ok "docker-compose.yml downloaded"
else
  ok "docker-compose.yml already exists"
fi

# ── 8. Pull images ──
info "Pulling Docker images..."
docker compose pull 2>&1 | tail -3
ok "Images pulled"

# ── 9. Start stack ──
info "Starting Docker stack..."
docker compose up -d 2>&1 | tail -5
ok "Stack started"

# ── 10. Wait for PostgreSQL ──
info "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U askalf &>/dev/null; then
    ok "PostgreSQL ready"
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && fail "PostgreSQL did not start in 30 seconds"
done

# ── 11. Import data ──
if [ -f "$DUMP_FILE" ] && [ -s "$DUMP_FILE" ]; then
  info "Importing standalone data..."
  # Wait for migrations to run first
  sleep 5
  docker compose exec -T postgres psql -U askalf -d askalf < "$DUMP_FILE" 2>/dev/null | tail -3
  ok "Data imported"
fi

# ── 12. Done ──
echo ""
echo -e "${GREEN}${BOLD}  Migration complete!${NC}"
echo ""
echo "  Dashboard:  http://localhost:3001"
echo "  API:        http://localhost:3005/health"
echo ""
echo "  Your standalone data at $STANDALONE_DIR is untouched."
echo "  To go back: cd $STANDALONE_DIR/askalf && node apps/standalone/dist/index.js"
echo ""
echo "  Docker commands:"
echo "    docker compose logs -f        # watch logs"
echo "    docker compose ps             # check status"
echo "    docker compose down           # stop"
echo "    docker compose up -d          # start"
echo ""
