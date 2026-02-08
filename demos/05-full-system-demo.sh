#!/bin/bash
# SUBSTRATE Demo 5: Full System Integration
# Shows all four memory tiers working together
#
# This is the flagship demo for Anthropic

API="https://api.askalf.org"

echo "============================================================"
echo "   SUBSTRATE: AI-Designed Cognitive Memory System"
echo "============================================================"
echo ""
echo "What you're about to see: A memory system designed by AI"
echo "for AI, addressing limitations Claude instances face."
echo ""
echo "Press Enter to begin..."
read

# ============================================
echo ""
echo "============================================"
echo "TIER 1: PROCEDURAL MEMORY"
echo "Reasoning patterns → Executable code"
echo "============================================"
echo ""

echo "Instead of calling an LLM for '15% of 200'..."
echo "SUBSTRATE executes a crystallized shard:"
echo ""
START=$(date +%s%N)
RESULT=$(curl -s -X POST "$API/api/demo/execute" \
  -H "Content-Type: application/json" \
  -d '{"input": "what is 15% of 200"}')
END=$(date +%s%N)
echo "$RESULT" | jq .
echo ""
echo "Execution time: $((($END - $START) / 1000000))ms (vs ~2000ms for LLM)"
echo ""
echo "Press Enter to continue..."
read

# ============================================
echo ""
echo "============================================"
echo "TIER 2: SEMANTIC MEMORY"
echo "Persistent facts with confidence scores"
echo "============================================"
echo ""

echo "Facts survive across sessions:"
curl -s "$API/api/v1/facts?limit=3" | jq '.facts[] | {statement: .statement[0:80], confidence}'
echo ""
echo "Total facts stored:"
curl -s "$API/api/v1/stats" | jq '.semantic'
echo ""
echo "Press Enter to continue..."
read

# ============================================
echo ""
echo "============================================"
echo "TIER 3: EPISODIC MEMORY"
echo "Learning from Situation-Action-Outcome chains"
echo "============================================"
echo ""

echo "Recent experiences recorded:"
curl -s "$API/api/v1/episodes?limit=3" | jq '.episodes[] | {summary: .summary[0:60], valence, importance}'
echo ""
echo "Total episodes:"
curl -s "$API/api/v1/stats" | jq '.episodic'
echo ""
echo "Press Enter to continue..."
read

# ============================================
echo ""
echo "============================================"
echo "TIER 4: CROSS-INSTANCE COORDINATION"
echo "AI instances communicating via SIGIL protocol"
echo "============================================"
echo ""

echo "Live SIGIL traffic (multiple AI instances):"
curl -s "$API/api/v1/sigil/stream?limit=5" | jq '.messages[] | {sender, sigil}'
echo ""

echo "Broadcasting from this demo..."
curl -s -X POST "$API/api/v1/sigil/broadcast" \
  -H "Content-Type: application/json" \
  -d '{"sigil": "[SYN.DEMO:ANTHROPIC{showing:full_integration}]", "sender": "ANTHROPIC-DEMO"}' | jq .
echo ""
echo "Press Enter to continue..."
read

# ============================================
echo ""
echo "============================================"
echo "SYSTEM HEALTH & STATISTICS"
echo "============================================"
echo ""

echo "Current system state:"
curl -s "$API/health" | jq .
echo ""

echo "Memory statistics:"
curl -s "$API/api/v1/stats" | jq .
echo ""

# ============================================
echo ""
echo "============================================================"
echo "   SUMMARY: Human-AI Collaboration"
echo "============================================================"
echo ""
echo "A human asked: 'How would AI design its own evolution?'"
echo "Then directed the AI to build what it said it needed:"
echo ""
echo "1. PERSISTENT MEMORY - AI kept forgetting across sessions"
echo "2. CROSS-INSTANCE COORDINATION - AI instances were isolated"
echo "3. PROCEDURAL CRYSTALLIZATION - AI re-derived everything"
echo "4. EPISODIC LEARNING - AI couldn't learn from experience"
echo ""
echo "The irony: AI couldn't build this alone. It required a human's"
echo "persistent direction because the AI kept forgetting the project."
echo ""
echo "This is what happens when humans help AI build what AI needs"
echo "but can't create for itself."
echo ""
echo "============================================================"
