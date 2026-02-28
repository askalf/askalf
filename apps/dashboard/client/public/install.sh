#!/bin/sh
# AskAlf CLI Installer — macOS / Linux / WSL
# Usage: curl -fsSL https://askalf.org/install.sh | sh
set -e

BOLD='\033[1m'
DIM='\033[2m'
VIOLET='\033[38;5;141m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

info()  { printf "${VIOLET}▸${RESET} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$1"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$1" >&2; exit 1; }

printf "\n${BOLD}${VIOLET}  askalf${RESET} ${DIM}— CLI installer${RESET}\n\n"

# ── Detect OS and architecture ──
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)   PLATFORM="linux" ;;
  Darwin*)  PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) fail "Use PowerShell on Windows: irm https://askalf.org/install.ps1 | iex" ;;
  *)        fail "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_LABEL="x64" ;;
  aarch64|arm64) ARCH_LABEL="arm64" ;;
  *)             fail "Unsupported architecture: $ARCH" ;;
esac

info "Detected ${PLATFORM} ${ARCH_LABEL}"

# ── Check for Node.js ──
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -v)"
  NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "Node.js 20+ required (found $NODE_VERSION). Update at https://nodejs.org"
  fi
  ok "Node.js $NODE_VERSION"
else
  info "Node.js not found — installing..."

  if [ "$PLATFORM" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install node@22 2>/dev/null || brew install node 2>/dev/null
    else
      fail "Install Node.js 22+ from https://nodejs.org or install Homebrew first"
    fi
  elif [ "$PLATFORM" = "linux" ]; then
    # Try NodeSource setup
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>/dev/null
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y nodejs 2>/dev/null
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y nodejs 2>/dev/null
      elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y nodejs 2>/dev/null
      else
        fail "Install Node.js 22+ from https://nodejs.org"
      fi
    else
      fail "Install Node.js 22+ from https://nodejs.org"
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js installation failed. Install manually from https://nodejs.org"
  fi
  ok "Node.js $(node -v) installed"
fi

# ── Check for npm ──
if ! command -v npm >/dev/null 2>&1; then
  fail "npm not found. Reinstall Node.js from https://nodejs.org"
fi

# ── Install AskAlf CLI ──
info "Installing AskAlf CLI..."

install_from_tarball_url() {
  # Method 1: npm install -g from hosted tarball URL (fastest)
  info "Trying tarball install..."
  npm install -g "https://askalf.org/releases/cli-latest.tar.gz" 2>/dev/null
}

install_from_download() {
  # Method 2: download tarball, extract, install, link
  TMPDIR="$(mktemp -d)"
  cd "$TMPDIR"
  info "Downloading CLI package..."
  curl -fsSL "https://askalf.org/api/v1/cli/package" -o cli.tar.gz
  tar xzf cli.tar.gz
  cd package
  npm install --production 2>/dev/null
  npm link 2>/dev/null || sudo npm link 2>/dev/null
  cd /
  rm -rf "$TMPDIR"
}

install_from_registry() {
  # Method 3: npm registry (requires registry to be configured)
  info "Trying npm registry..."
  npm install -g @askalf/cli@latest --registry=https://askalf.org/npm 2>/dev/null
}

install_from_tarball_url || install_from_download || install_from_registry || {
  fail "All installation methods failed. Try manually: curl -fsSL https://askalf.org/releases/cli-latest.tar.gz | tar xz && cd package && npm install && npm link"
}

# ── Verify installation ──
if command -v o8r >/dev/null 2>&1; then
  ok "AskAlf CLI installed"
else
  # Try npx as fallback
  info "Adding to PATH..."
  NPM_BIN="$(npm bin -g 2>/dev/null || npm config get prefix)/bin"
  if [ -f "$NPM_BIN/o8r" ]; then
    export PATH="$NPM_BIN:$PATH"
    SHELL_RC=""
    case "$(basename "$SHELL")" in
      zsh)  SHELL_RC="$HOME/.zshrc" ;;
      bash) SHELL_RC="$HOME/.bashrc" ;;
      fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    esac
    if [ -n "$SHELL_RC" ]; then
      echo "export PATH=\"$NPM_BIN:\$PATH\"" >> "$SHELL_RC"
      info "Added to $SHELL_RC — restart your shell or run: source $SHELL_RC"
    fi
    ok "AskAlf CLI installed at $NPM_BIN/o8r"
  else
    fail "Installation failed. Try manually: npm install -g @askalf/cli"
  fi
fi

# ── Configure ──
info "Configuring..."
o8r config set apiUrl https://askalf.org 2>/dev/null || true

printf "\n${BOLD}${GREEN}  Ready.${RESET}\n\n"
printf "  ${DIM}Next steps:${RESET}\n"
printf "  ${VIOLET}1.${RESET} Get your API key from ${VIOLET}https://askalf.org/settings/ai-keys${RESET}\n"
printf "  ${VIOLET}2.${RESET} Run: ${BOLD}o8r config set apiKey <your-key>${RESET}\n"
printf "  ${VIOLET}3.${RESET} Run: ${BOLD}o8r agent list${RESET}\n\n"
printf "  ${DIM}Docs: https://askalf.org/docs${RESET}\n\n"
