#!/bin/bash
# build-cli.sh — Build and package @askalf/cli as a self-contained npm-installable tarball
# Output: apps/dashboard/client/public/releases/cli-latest.tar.gz
#
# The tarball contains a flat npm package with:
#   - package.json (with bundled @askalf/sdk)
#   - dist/ (compiled CLI code)
#   - node_modules/@askalf/sdk/ (bundled SDK)
#
# Users install with: npm install -g ./cli-latest.tar.gz
# Or: tar xzf cli-latest.tar.gz && cd package && npm install && npm link

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SDK_DIR="$ROOT_DIR/packages/sdk"
CLI_DIR="$ROOT_DIR/packages/cli"
OUTPUT_DIR="$ROOT_DIR/apps/dashboard/client/public/releases"
STAGING_DIR="$(mktemp -d)"

cleanup() { rm -rf "$STAGING_DIR"; }
trap cleanup EXIT

echo "==> Building @askalf/sdk..."
cd "$SDK_DIR"
npx tsc
cp -r "$SDK_DIR/dist/"* "$STAGING_DIR/sdk-dist/" 2>/dev/null || cp -r "$SDK_DIR/dist/" "$STAGING_DIR/sdk-dist/"

echo "==> Building @askalf/cli..."
cd "$CLI_DIR"
npx tsc --outDir "$STAGING_DIR/cli-dist"

echo "==> Assembling package..."
PACKAGE_DIR="$STAGING_DIR/package"
mkdir -p "$PACKAGE_DIR/dist"
mkdir -p "$PACKAGE_DIR/node_modules/@askalf/sdk/dist"

# Copy compiled CLI code
cp -r "$STAGING_DIR/cli-dist/"* "$PACKAGE_DIR/dist/"

# Bundle the SDK as a node_modules dependency
cp "$SDK_DIR/package.json" "$PACKAGE_DIR/node_modules/@askalf/sdk/package.json"
cp -r "$STAGING_DIR/sdk-dist/"* "$PACKAGE_DIR/node_modules/@askalf/sdk/dist/"

# Create a standalone package.json (no workspace: references)
cat > "$PACKAGE_DIR/package.json" << 'PKGJSON'
{
  "name": "@askalf/cli",
  "version": "1.0.0",
  "description": "AskAlf CLI — manage agents, executions, and fleet from the command line",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "type": "module",
  "bin": {
    "o8r": "./dist/index.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "yaml": "^2.4.0"
  },
  "bundledDependencies": [
    "@askalf/sdk"
  ]
}
PKGJSON

# Install production dependencies (commander, yaml) into the package
cd "$PACKAGE_DIR"
npm install --production --ignore-scripts 2>/dev/null || {
  echo "    npm install failed, trying with --legacy-peer-deps..."
  npm install --production --ignore-scripts --legacy-peer-deps 2>/dev/null
}

echo "==> Creating tarball..."
mkdir -p "$OUTPUT_DIR"

# Create the tarball from the staging dir so it extracts to 'package/'
cd "$STAGING_DIR"
tar czf "$OUTPUT_DIR/cli-latest.tar.gz" package/

TARBALL_SIZE=$(du -h "$OUTPUT_DIR/cli-latest.tar.gz" | cut -f1)
echo "==> Done: $OUTPUT_DIR/cli-latest.tar.gz ($TARBALL_SIZE)"
echo "    Install with: npm install -g \"$OUTPUT_DIR/cli-latest.tar.gz\""
