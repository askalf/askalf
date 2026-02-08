#!/bin/bash
# SUBSTRATE Demo 2: Semantic Memory (Truth Store)
# Shows how facts are stored with confidence and can be verified
#
# Value proposition: Persistent knowledge that survives sessions

API="https://api.askalf.org"

echo "=========================================="
echo "SUBSTRATE Demo: Semantic Memory"
echo "=========================================="
echo ""

echo "1. Current fact statistics:"
echo "---------------------------"
curl -s "$API/api/v1/stats" | jq '.semantic'
echo ""

echo "2. View recent facts stored:"
echo "----------------------------"
curl -s "$API/api/v1/facts?limit=5" | jq '.facts[] | {subject, predicate, object, confidence}'
echo ""

echo "3. Search for facts about a topic:"
echo "-----------------------------------"
echo "Query: 'SUBSTRATE'"
curl -s "$API/api/v1/facts/search?q=SUBSTRATE&limit=3" | jq '.facts[] | {statement, confidence}'
echo ""

echo "4. Store a new fact (requires auth in production):"
echo "---------------------------------------------------"
echo "Example payload:"
cat << 'EOF'
{
  "subject": "SUBSTRATE",
  "predicate": "demonstrated to",
  "object": "Anthropic team on 2026-01-15",
  "statement": "SUBSTRATE was demonstrated to Anthropic team on 2026-01-15",
  "confidence": 0.95
}
EOF
echo ""

echo "=========================================="
echo "Key Features:"
echo "- Facts stored with confidence scores"
echo "- Semantic search via embeddings"
echo "- Supports claim verification"
echo "- Persists across all sessions"
echo "=========================================="
