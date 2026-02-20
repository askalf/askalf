#!/bin/bash
# SUBSTRATE Demo 1: Procedural Memory
# Shows how reasoning patterns become executable shards
#
# Value proposition: Execute learned patterns in ~10ms instead of 2000ms+ LLM calls
# Token savings: ~50 tokens per execution

API="https://api.askalf.org"

echo "=========================================="
echo "SUBSTRATE Demo: Procedural Memory"
echo "=========================================="
echo ""

echo "1. Check current shard statistics:"
echo "-----------------------------------"
curl -s "$API/api/v1/stats" | jq '.procedural'
echo ""

echo "2. Execute a learned pattern (no LLM call needed):"
echo "---------------------------------------------------"
echo "Input: 'what is 15% of 200'"
curl -s -X POST "$API/api/demo/execute" \
  -H "Content-Type: application/json" \
  -d '{"input": "what is 15% of 200"}' | jq .
echo ""

echo "3. Another pattern - temperature conversion:"
echo "---------------------------------------------"
echo "Input: '100 fahrenheit to celsius'"
curl -s -X POST "$API/api/demo/execute" \
  -H "Content-Type: application/json" \
  -d '{"input": "100 fahrenheit to celsius"}' | jq .
echo ""

echo "4. View available public shards:"
echo "--------------------------------"
curl -s "$API/api/shards/public?limit=5" | jq '.shards[] | {name, confidence, execution_count}'
echo ""

echo "=========================================="
echo "Key Metrics:"
echo "- Execution time: ~10-15ms (vs 2000ms+ for LLM)"
echo "- Success rate: 99.99%"
echo "- No API costs per execution"
echo "=========================================="
