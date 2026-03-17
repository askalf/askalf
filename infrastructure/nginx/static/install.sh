#!/usr/bin/env bash
# AskAlf — One-Line Installer
# Usage: curl -fsSL https://get.askalf.org | bash
#
# Environment variables (optional):
#   ASKALF_DIR        - Install directory (default: ~/.askalf)
#   ANTHROPIC_API_KEY - Anthropic API key (will prompt if not set)
#   OPENAI_API_KEY    - OpenAI API key (optional)
#   ASKALF_BRANCH     - Git branch to clone (default: main)

set -euo pipefail

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── Banner ──────────────────────────────────────────────
echo ""
echo -e "${PURPLE}${BOLD}"
echo "   ╔═══════════════════════════════════════╗"
echo "   ║         AskAlf — Installer            ║"
echo "   ║   Your autonomous agent fleet.        ║"
echo "   ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Platform Detection ──────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
IS_WSL=false

case "$OS" in
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      IS_WSL=true
      info "Detected: Windows WSL2 ($ARCH)"
    else
      info "Detected: Linux ($ARCH)"
    fi
    ;;
  Darwin)
    info "Detected: macOS ($ARCH)"
    ;;
  *)
    fail "Unsupported OS: $OS. Use Linux, macOS, or WSL2."
    ;;
esac

# ── Prerequisite Checks ────────────────────────────────
info "Checking prerequisites..."

# Docker
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker not found. Install Docker: https://docs.docker.com/get-docker/"
fi

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
if [ "$DOCKER_MAJOR" -lt 24 ] 2>/dev/null; then
  warn "Docker $DOCKER_VERSION detected. Version 24+ recommended."
fi
ok "Docker $DOCKER_VERSION"

# Docker Compose v2
if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose v2 not found. Install: https://docs.docker.com/compose/install/"
fi
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "unknown")
ok "Docker Compose $COMPOSE_VERSION"

# Git
if ! command -v git >/dev/null 2>&1; then
  fail "Git not found. Install git: https://git-scm.com/downloads"
fi
ok "Git $(git --version | awk '{print $3}')"

# Memory check (need at least 4GB)
if [ -f /proc/meminfo ]; then
  TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  TOTAL_MEM_GB=$((TOTAL_MEM_KB / 1024 / 1024))
  if [ "$TOTAL_MEM_GB" -lt 3 ]; then
    warn "Only ${TOTAL_MEM_GB}GB RAM detected. 4GB+ recommended."
  else
    ok "${TOTAL_MEM_GB}GB RAM"
  fi
elif command -v sysctl >/dev/null 2>&1; then
  TOTAL_MEM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  TOTAL_MEM_GB=$((TOTAL_MEM_BYTES / 1024 / 1024 / 1024))
  if [ "$TOTAL_MEM_GB" -lt 3 ]; then
    warn "Only ${TOTAL_MEM_GB}GB RAM detected. 4GB+ recommended."
  else
    ok "${TOTAL_MEM_GB}GB RAM"
  fi
fi

# ── Install Directory ──────────────────────────────────
INSTALL_DIR="${ASKALF_DIR:-$HOME/.askalf}"
BRANCH="${ASKALF_BRANCH:-main}"
REPO_URL="https://github.com/askalf/askalf.git"

echo ""
info "Installing to: $INSTALL_DIR"

if [ -d "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing installation found. Pulling latest..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin "$BRANCH" 2>/dev/null || {
      warn "Git pull failed. Continuing with existing version."
    }
  else
    fail "$INSTALL_DIR exists but is not a git repo. Remove it or set ASKALF_DIR."
  fi
else
  info "Cloning AskAlf..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>&1 | tail -1
  ok "Repository cloned"
fi

cd "$INSTALL_DIR/substrate"

# ── API Key Configuration ──────────────────────────────
echo ""
echo -e "${BOLD}API Key Configuration${NC}"
echo ""

# Anthropic key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo -e "  An Anthropic API key is required for the AI agents."
  echo -e "  Get one at: ${CYAN}https://console.anthropic.com/settings/keys${NC}"
  echo ""
  read -rp "  Anthropic API Key: " ANTHROPIC_API_KEY
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    fail "Anthropic API key is required."
  fi
fi
ok "Anthropic API key configured"

# OpenAI key (optional)
if [ -z "${OPENAI_API_KEY:-}" ]; then
  read -rp "  OpenAI API Key (optional, press Enter to skip): " OPENAI_API_KEY
fi
if [ -n "${OPENAI_API_KEY:-}" ]; then
  ok "OpenAI API key configured"
fi

# ── Generate Configuration ─────────────────────────────
echo ""
info "Generating configuration..."

# Run setup.sh non-interactively
if [ -f "setup.sh" ]; then
  chmod +x setup.sh
  yes y 2>/dev/null | bash setup.sh 2>/dev/null || bash setup.sh <<< "y" 2>/dev/null || true
fi

# Write API keys into .env
if [ -f ".env" ]; then
  # Replace API key placeholders
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}|" .env
    [ -n "${OPENAI_API_KEY:-}" ] && sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_API_KEY}|" .env
  else
    sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}|" .env
    [ -n "${OPENAI_API_KEY:-}" ] && sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_API_KEY}|" .env
  fi

  # Generate INTERNAL_API_SECRET if missing
  if grep -q "^INTERNAL_API_SECRET=$" .env 2>/dev/null || ! grep -q "INTERNAL_API_SECRET" .env 2>/dev/null; then
    SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
    if grep -q "INTERNAL_API_SECRET" .env; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^INTERNAL_API_SECRET=.*|INTERNAL_API_SECRET=${SECRET}|" .env
      else
        sed -i "s|^INTERNAL_API_SECRET=.*|INTERNAL_API_SECRET=${SECRET}|" .env
      fi
    else
      echo "INTERNAL_API_SECRET=${SECRET}" >> .env
    fi
  fi
fi
ok "Configuration generated"

# ── Pull & Build ───────────────────────────────────────
echo ""
info "Pulling Docker images..."
docker compose -f docker-compose.selfhosted.yml pull 2>&1 | grep -E "Pull|Done|pull" || true
ok "Images pulled"

info "Building application containers..."
docker compose -f docker-compose.selfhosted.yml build 2>&1 | tail -5
ok "Containers built"

# ── Start Services ─────────────────────────────────────
echo ""
info "Starting AskAlf..."
docker compose -f docker-compose.selfhosted.yml up -d 2>&1

# Wait for health
info "Waiting for services to be ready..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  printf "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
  warn "Dashboard didn't respond within ${TIMEOUT}s. Check: docker compose -f docker-compose.selfhosted.yml logs"
else
  ok "All services running"
fi

# ── Extract Credentials ────────────────────────────────
ADMIN_EMAIL=$(grep "^ADMIN_EMAIL=" .env | cut -d= -f2-)
ADMIN_PASS=$(grep "^ADMIN_PASSWORD=" .env | cut -d= -f2-)
DASHBOARD_PORT=$(grep "^DASHBOARD_PORT=" .env | cut -d= -f2- || echo "3001")
DASHBOARD_PORT="${DASHBOARD_PORT:-3001}"

# ── Done ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "   ╔═══════════════════════════════════════╗"
echo "   ║       AskAlf is running!              ║"
echo "   ╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo -e "   ${BOLD}Dashboard:${NC}  http://localhost:${DASHBOARD_PORT}"
echo -e "   ${BOLD}Email:${NC}      ${ADMIN_EMAIL:-admin@localhost}"
echo -e "   ${BOLD}Password:${NC}   ${ADMIN_PASS:-(check .env)}"
echo ""
echo -e "   ${CYAN}Installed at:${NC} $INSTALL_DIR"
echo ""
echo -e "   ${BOLD}Commands:${NC}"
echo "   cd $INSTALL_DIR/substrate"
echo "   docker compose -f docker-compose.selfhosted.yml logs -f    # view logs"
echo "   docker compose -f docker-compose.selfhosted.yml down       # stop"
echo "   docker compose -f docker-compose.selfhosted.yml up -d      # start"
echo ""

# Try to open browser
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${DASHBOARD_PORT}" 2>/dev/null &
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:${DASHBOARD_PORT}" 2>/dev/null &
fi
