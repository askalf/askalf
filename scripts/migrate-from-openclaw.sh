#!/usr/bin/env bash
# ============================================
# AskAlf — OpenClaw Migration Tool
# Converts OpenClaw agents, skills, memory, and config to AskAlf format.
#
# Usage:
#   ./scripts/migrate-from-openclaw.sh [openclaw-dir]
#
# Default: reads from ~/.openclaw
# Output: ./openclaw-migration/
# ============================================

set -euo pipefail

OPENCLAW_DIR="${1:-$HOME/.openclaw}"
OUTPUT_DIR="./openclaw-migration"
WORKSPACE="${OPENCLAW_DIR}/workspace"
CONFIG="${OPENCLAW_DIR}/openclaw.json"

echo ""
echo "  AskAlf — OpenClaw Migration Tool"
echo "  ================================="
echo ""

if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "[error] OpenClaw directory not found: $OPENCLAW_DIR"
  echo "Usage: $0 [path-to-openclaw-dir]"
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "[error] openclaw.json not found in $OPENCLAW_DIR"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[error] Node.js required"
  exit 1
fi

echo "[migrate] Found OpenClaw at: $OPENCLAW_DIR"
mkdir -p "$OUTPUT_DIR/agents" "$OUTPUT_DIR/skills" "$OUTPUT_DIR/memory"

# ── Parse openclaw.json — extract agents, providers, channels ──

echo "[migrate] Parsing openclaw.json..."

node -e "
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(process.argv[1], 'utf8');
const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
let config;
try { config = JSON.parse(cleaned); } catch(e) { console.error('[error] Parse failed:', e.message); process.exit(1); }

const output = process.argv[2];
const wsDir = process.argv[3];
const agents = config.agents?.list || [];
const defaults = config.agents?.defaults || {};
const defaultModel = defaults.model || 'claude-sonnet-4-5';

const alfAgents = [];
for (const agent of agents) {
  const id = agent.id || agent.name || 'agent-' + alfAgents.length;
  const ws = (agent.workspace || defaults.workspace || wsDir).replace('~', process.env.HOME || '');
  let systemPrompt = '';
  try { systemPrompt = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8').slice(0, 4000); } catch {}
  let soul = '';
  try { soul = fs.readFileSync(path.join(ws, 'SOUL.md'), 'utf8').slice(0, 2000); } catch {}
  const a = {
    name: id,
    slug: id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    description: agent.description || 'Migrated from OpenClaw',
    model: agent.model || defaultModel,
    system_prompt: (soul ? soul + '\n\n---\n\n' : '') + systemPrompt,
    autonomy_level: agent.elevated ? 4 : 2,
    type: 'custom',
    tools: agent.tools || [],
    heartbeat: agent.heartbeat || null,
    source: 'openclaw-migration',
  };
  alfAgents.push(a);
  fs.writeFileSync(path.join(output, 'agents', a.slug + '.json'), JSON.stringify(a, null, 2));
}

const models = config.agents?.defaults?.models || {};
const providers = {};
for (const [key, val] of Object.entries(models)) {
  const [p] = key.split('/');
  if (!providers[p]) providers[p] = [];
  providers[p].push({ id: key, ...(typeof val === 'object' ? val : { name: val }) });
}
fs.writeFileSync(path.join(output, 'providers.json'), JSON.stringify(providers, null, 2));

const channels = config.channels || {};
if (Object.keys(channels).length > 0) {
  fs.writeFileSync(path.join(output, 'channels.json'), JSON.stringify(channels, null, 2));
}

fs.writeFileSync(path.join(output, 'migration-summary.json'), JSON.stringify({
  source: 'openclaw', migrated_at: new Date().toISOString(),
  agents: alfAgents.length, providers: Object.keys(providers).length,
  channels: Object.keys(channels).length,
}, null, 2));

console.log('[migrate] Agents: ' + alfAgents.length);
console.log('[migrate] Providers: ' + Object.keys(providers).length);
console.log('[migrate] Channels: ' + Object.keys(channels).length);
" "$CONFIG" "$OUTPUT_DIR" "$WORKSPACE"

# ── Workspace files ──

if [ -d "$WORKSPACE" ]; then
  [ -f "$WORKSPACE/MEMORY.md" ] && cp "$WORKSPACE/MEMORY.md" "$OUTPUT_DIR/memory/MEMORY.md" && echo "[migrate] Copied MEMORY.md"
  [ -d "$WORKSPACE/memory" ] && cp -r "$WORKSPACE/memory" "$OUTPUT_DIR/memory/episodes" && echo "[migrate] Copied memory episodes"
  [ -f "$WORKSPACE/HEARTBEAT.md" ] && cp "$WORKSPACE/HEARTBEAT.md" "$OUTPUT_DIR/heartbeat-config.md" && echo "[migrate] Copied HEARTBEAT.md"
  [ -f "$WORKSPACE/TOOLS.md" ] && cp "$WORKSPACE/TOOLS.md" "$OUTPUT_DIR/tools-reference.md" && echo "[migrate] Copied TOOLS.md"

  if [ -d "$WORKSPACE/skills" ]; then
    for skill_dir in "$WORKSPACE/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      sn=$(basename "$skill_dir")
      [ -f "${skill_dir}SKILL.md" ] && node -e "
        const fs=require('fs'),c=fs.readFileSync(process.argv[1],'utf8'),m=c.match(/^#\s+(.+)/m);
        fs.writeFileSync(process.argv[3],JSON.stringify({name:m?m[1].trim():process.argv[2],slug:process.argv[2].toLowerCase().replace(/[^a-z0-9-]/g,'-'),description:'Migrated from OpenClaw',content:c,source:'openclaw-migration'},null,2));
        console.log('[migrate] Skill: '+(m?m[1].trim():process.argv[2]));
      " "${skill_dir}SKILL.md" "$sn" "$OUTPUT_DIR/skills/${sn}.json" 2>/dev/null || true
    done
  fi
fi

# ── Generate import script ──

cat > "$OUTPUT_DIR/import-to-askalf.sh" << 'IMPORTSCRIPT'
#!/usr/bin/env bash
set -euo pipefail
URL="${1:-http://localhost:3001}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Importing into AskAlf at $URL..."
for f in "$DIR/agents"/*.json; do [ -f "$f" ] || continue
  echo "  Agent: $(node -pe "JSON.parse(require('fs').readFileSync('$f','utf8')).name")"
  curl -s -X POST "$URL/api/v1/forge/agents" -H "Content-Type: application/json" -d @"$f" >/dev/null 2>&1 || echo "    (failed)"
done
for f in "$DIR/skills"/*.json; do [ -f "$f" ] || continue
  echo "  Skill: $(node -pe "JSON.parse(require('fs').readFileSync('$f','utf8')).name")"
  curl -s -X POST "$URL/api/v1/forge/templates" -H "Content-Type: application/json" -d @"$f" >/dev/null 2>&1 || echo "    (failed)"
done
echo "Done. Check Fleet tab in AskAlf dashboard."
IMPORTSCRIPT
chmod +x "$OUTPUT_DIR/import-to-askalf.sh"

echo ""
echo "  Migration complete!"
echo "  Output: $OUTPUT_DIR/"
echo ""
echo "  Next steps:"
echo "    1. Review files in $OUTPUT_DIR/"
echo "    2. Start AskAlf: docker compose -f docker-compose.selfhosted.yml up -d"
echo "    3. Import: $OUTPUT_DIR/import-to-askalf.sh"
echo "    4. Configure providers in Settings > Providers"
echo ""
