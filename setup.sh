#!/usr/bin/env bash
# AskAlf Self-Hosted Setup Script
# Generates secure secrets and creates .env from .env.example

set -euo pipefail

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║     AskAlf — Self-Hosted Setup    ║"
echo "  ╚═══════════════════════════════════╝"
echo ""

# Check for .env.example
if [ ! -f "$EXAMPLE_FILE" ]; then
  echo "Error: $EXAMPLE_FILE not found. Run this script from the project root."
  exit 1
fi

# Copy .env.example to .env if it doesn't exist
if [ -f "$ENV_FILE" ]; then
  echo "Found existing .env file."
  read -p "Overwrite with fresh config? (y/N): " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Keeping existing .env. Only regenerating secrets."
  else
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "Created fresh .env from template."
  fi
else
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created .env from template."
fi

# Generate secure random strings
gen_secret() {
  openssl rand -base64 "$1" 2>/dev/null | tr -d '=/+' | head -c "$1"
}

gen_hex() {
  openssl rand -hex "$1" 2>/dev/null
}

# Replace placeholder values with generated secrets
replace_if_default() {
  local key="$1"
  local value="$2"
  local default="${3:-changeme}"

  # Only replace if current value matches default
  if grep -q "^${key}=${default}" "$ENV_FILE" 2>/dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=${default}|${key}=${value}|" "$ENV_FILE"
    else
      sed -i "s|^${key}=${default}|${key}=${value}|" "$ENV_FILE"
    fi
    echo "  Generated: $key"
  fi
}

echo ""
echo "Generating secrets..."
replace_if_default "POSTGRES_PASSWORD" "$(gen_secret 32)"
replace_if_default "REDIS_PASSWORD" "$(gen_secret 24)"
replace_if_default "JWT_SECRET" "$(gen_secret 48)"
replace_if_default "SESSION_SECRET" "$(gen_secret 48)"
replace_if_default "FORGE_API_KEY" "fk_$(gen_secret 32)"
replace_if_default "CHANNEL_ENCRYPTION_KEY" "$(gen_hex 32)"
replace_if_default "SEARXNG_SECRET_KEY" "$(gen_hex 32)"

echo ""
echo "Configuration saved to .env"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your API keys (ANTHROPIC_API_KEY, etc.)"
echo "  2. Set ADMIN_EMAIL and ADMIN_PASSWORD"
echo "  3. Start AskAlf:"
echo ""
echo "     docker compose -f docker-compose.selfhosted.yml up -d"
echo ""
echo "  4. Open http://localhost:3001"
echo ""
