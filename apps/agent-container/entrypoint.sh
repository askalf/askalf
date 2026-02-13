#!/bin/bash
set -e

echo "[agent-${AGENT_NAME}] Starting agent daemon..."
echo "[agent-${AGENT_NAME}] Agent ID: ${AGENT_ID}"
echo "[agent-${AGENT_NAME}] Max budget: \$${MAX_BUDGET_USD}"

# Run the agent daemon via tsx (TypeScript execution)
exec npx tsx /app/agent-daemon.ts
