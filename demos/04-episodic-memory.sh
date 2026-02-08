#!/bin/bash
# SUBSTRATE Demo 4: Episodic Memory (SAO Chains)
# Shows how experiences are recorded as Situation-Action-Outcome chains
#
# Value proposition: Learn from past experiences, avoid repeating mistakes

API="https://api.askalf.org"

echo "=========================================="
echo "SUBSTRATE Demo: Episodic Memory"
echo "=========================================="
echo ""

echo "1. Current episode statistics:"
echo "------------------------------"
curl -s "$API/api/v1/stats" | jq '.episodic'
echo ""

echo "2. View recent episodes:"
echo "------------------------"
curl -s "$API/api/v1/episodes?limit=5" | jq '.episodes[] | {summary, type, valence, importance}'
echo ""

echo "3. Search for similar past experiences:"
echo "---------------------------------------"
echo "Query: 'deployment failed'"
curl -s "$API/api/v1/episodes/similar?q=deployment%20failed&limit=3" | jq '.episodes[] | {summary, lessonsLearned, valence}'
echo ""

echo "4. Episode Structure (SAO Chain):"
echo "----------------------------------"
cat << 'EOF'
{
  "situation": {
    "context": "User requested deployment to production",
    "entities": ["deployment", "production", "API"],
    "state": {"environment": "prod", "risk": "high"}
  },
  "action": {
    "type": "deployment",
    "description": "Executed blue-green deployment",
    "parameters": {"strategy": "blue-green", "rollback": true}
  },
  "outcome": {
    "result": "Deployment successful, zero downtime",
    "success": true,
    "effects": ["service_updated", "users_unaffected"],
    "metrics": {"downtime_ms": 0, "duration_s": 45}
  },
  "lessonsLearned": ["Blue-green deployments minimize risk"]
}
EOF
echo ""

echo "=========================================="
echo "Key Features:"
echo "- 51,583+ episodes recorded"
echo "- Semantic search for similar situations"
echo "- Lessons extracted automatically"
echo "- Positive/negative valence tracking"
echo "=========================================="
