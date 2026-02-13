#!/bin/bash

# Backup API Integration Test Runner
# This script runs the backup API integration tests

set -e

echo "🧪 Backup API Integration Test Suite"
echo "===================================="
echo ""

# Check environment
if [ -z "$API_URL" ]; then
  echo "⚠️  API_URL not set, using default: http://localhost:3000"
  export API_URL="http://localhost:3000"
fi

if [ -z "$ADMIN_TOKEN" ]; then
  echo "⚠️  ADMIN_TOKEN not set, tests requiring authentication may fail"
fi

echo "Configuration:"
echo "  API_URL: $API_URL"
echo "  ADMIN_TOKEN: ${ADMIN_TOKEN:0:20}..."
echo ""

# Check if API is reachable
echo "🔍 Checking API connectivity..."
if ! curl -s -f "$API_URL/health" > /dev/null 2>&1; then
  echo "❌ API is not reachable at $API_URL"
  exit 1
fi
echo "✅ API is reachable"
echo ""

# Run tests
echo "📋 Running tests..."
npm test -- tests/backup-integration.test.ts --verbose

echo ""
echo "✅ Test suite completed"
