import { useState, useCallback, useRef } from 'react';
import type { Agent } from '../../hooks/useHubApi';
import { hubApi } from '../../hooks/useHubApi';
import { useToast } from '../../components/Toast';

// ── Field schema for autocomplete reference ──────────────────────────────────

const FIELD_SCHEMA: Record<string, { type: string; desc: string }> = {
  name:                   { type: 'string',      desc: 'Agent display name' },
  description:            { type: 'string',      desc: 'Short description of the agent' },
  system_prompt:          { type: 'string',      desc: 'Core system prompt (max 10240 chars)' },
  model_id:               { type: 'string|null', desc: 'Model override (null = default)' },
  autonomy_level:         { type: 'number 0–5',  desc: 'Autonomy level' },
  enabled_tools:          { type: 'string[]',    desc: 'Enabled tool names' },
  max_iterations:         { type: 'number|null', desc: 'Max turns per execution' },
  max_cost_per_execution: { type: 'number|null', desc: 'Cost limit per execution (USD)' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractEditableConfig(agent: Agent): Record<string, unknown> {
  return {
    name:                   agent.name,
    description:            agent.description || '',
    system_prompt:          agent.system_prompt || '',
    model_id:               (agent.config?.model_id as string) ?? null,
    autonomy_level:         agent.autonomy_level,
    enabled_tools:          agent.enabled_tools || [],
    max_iterations:         (agent.config?.max_iterations as number) ?? null,
    max_cost_per_execution: (agent.config?.max_cost_per_execution as number) ?? null,
  };
}

// ── JSON tokenizer for syntax highlighting ────────────────────────────────────

type TokenType = 'key' | 'str' | 'num' | 'bool' | 'null' | 'punc' | 'ws';

function tokenizeJson(json: string): Array<{ type: TokenType; value: string }> {
  const tokens: Array<{ type: TokenType; value: string }> = [];
  let i = 0;

  while (i < json.length) {
    const ch = json[i]!;

    // Whitespace (including newlines)
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < json.length && /\s/.test(json[i]!)) ws += json[i++];
      tokens.push({ type: 'ws', value: ws });
      continue;
    }

    // String
    if (ch === '"') {
      let s = '"';
      i++;
      while (i < json.length) {
        const c = json[i]!;
        if (c === '\\' && i + 1 < json.length) {
          s += c + json[i + 1]!;
          i += 2;
        } else if (c === '"') {
          s += '"';
          i++;
          break;
        } else {
          s += c;
          i++;
        }
      }
      // Determine key vs value: peek past whitespace for ':'
      let j = i;
      while (j < json.length && /\s/.test(json[j]!)) j++;
      tokens.push({ type: json[j] === ':' ? 'key' : 'str', value: s });
      continue;
    }

    // Number
    if (ch === '-' || /\d/.test(ch)) {
      let n = '';
      while (i < json.length && /[-\d.eE+]/.test(json[i]!)) n += json[i++];
      tokens.push({ type: 'num', value: n });
      continue;
    }

    // Literals: true / false / null
    if (/[tfn]/.test(ch)) {
      let lit = '';
      while (i < json.length && /[a-z]/.test(json[i]!)) lit += json[i++];
      tokens.push({ type: lit === 'null' ? 'null' : 'bool', value: lit });
      continue;
    }

    // Punctuation
    tokens.push({ type: 'punc', value: ch });
    i++;
  }

  return tokens;
}

function renderHighlighted(json: string): string {
  return tokenizeJson(json)
    .map(({ type, value }) => {
      const v = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      switch (type) {
        case 'key':  return `<span class="jh-key">${v}</span>`;
        case 'str':  return `<span class="jh-str">${v}</span>`;
        case 'num':  return `<span class="jh-num">${v}</span>`;
        case 'bool': return `<span class="jh-bool">${v}</span>`;
        case 'null': return `<span class="jh-null">${v}</span>`;
        default:     return v;
      }
    })
    .join('');
}

// ── Diff ──────────────────────────────────────────────────────────────────────

function formatDiffValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    if (val.every(v => typeof v === 'string' && v.length < 24)) {
      return `[${val.map(v => JSON.stringify(v)).join(', ')}]`;
    }
    return `[…${val.length} items]`;
  }
  if (typeof val === 'string') {
    if (val.length > 80) return `"${val.slice(0, 76)}…" (${val.length}c)`;
    return JSON.stringify(val);
  }
  return String(JSON.stringify(val));
}

interface DiffEntry {
  key: string;
  oldVal: unknown;
  newVal: unknown;
}

function computeDiff(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
): DiffEntry[] {
  const allKeys = new Set([...Object.keys(original), ...Object.keys(edited)]);
  return [...allKeys]
    .filter(k => JSON.stringify(original[k]) !== JSON.stringify(edited[k]))
    .map(k => ({ key: k, oldVal: original[k], newVal: edited[k] }));
}

// ── Component ─────────────────────────────────────────────────────────────────

type EditorMode = 'view' | 'edit' | 'diff';

export default function AgentConfigEditor({
  agent,
  onSaved,
}: {
  agent: Agent;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const originalConfig = extractEditableConfig(agent);

  const [mode, setMode] = useState<EditorMode>('view');
  const [rawJson, setRawJson] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const enterEdit = useCallback(() => {
    setRawJson(JSON.stringify(originalConfig, null, 2));
    setParseError(null);
    setMode('edit');
  }, [originalConfig]);

  const handleJsonChange = useCallback((val: string) => {
    setRawJson(val);
    try {
      JSON.parse(val);
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
    }
  }, []);

  const handleInsertField = useCallback(
    (fieldName: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const insertion = `  "${fieldName}": `;
      const pos = ta.selectionStart;
      const next = rawJson.slice(0, pos) + insertion + rawJson.slice(pos);
      setRawJson(next);
      try { JSON.parse(next); setParseError(null); } catch (e) { setParseError((e as Error).message); }
      setTimeout(() => {
        ta.setSelectionRange(pos + insertion.length, pos + insertion.length);
        ta.focus();
      }, 0);
    },
    [rawJson],
  );

  // Parsed edited config (null if JSON is invalid)
  let parsedEdited: Record<string, unknown> | null = null;
  if (mode === 'edit' || mode === 'diff') {
    try { parsedEdited = JSON.parse(rawJson); } catch { /* */ }
  }

  const diff: DiffEntry[] =
    mode === 'diff' && parsedEdited ? computeDiff(originalConfig, parsedEdited) : [];

  const handleSave = useCallback(async () => {
    if (saving || !parsedEdited) return;
    setSaving(true);
    try {
      await hubApi.agents.updateSettings(agent.id, parsedEdited as Record<string, unknown>);
      addToast('Config saved', 'success');
      onSaved();
      setMode('view');
    } catch (err) {
      addToast(`Save failed: ${(err as Error).message.slice(0, 80)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [agent.id, parsedEdited, saving, addToast, onSaved]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="ace-editor">

      {/* Header */}
      <div className="ace-header">
        <span className="ace-title">Agent Config</span>

        {mode === 'view' && (
          <button className="fleet-btn" onClick={enterEdit}>Edit</button>
        )}

        {mode === 'edit' && (
          <div className="ace-actions">
            <button className="fleet-btn" onClick={() => setMode('view')}>Cancel</button>
            <button
              className="fleet-btn primary"
              disabled={!!parseError || !parsedEdited}
              onClick={() => setMode('diff')}
            >
              Preview Changes
            </button>
          </div>
        )}

        {mode === 'diff' && (
          <div className="ace-actions">
            <button className="fleet-btn" onClick={() => setMode('edit')}>Back</button>
            <button
              className="fleet-btn primary"
              disabled={saving || diff.length === 0}
              onClick={handleSave}
            >
              {saving
                ? 'Saving…'
                : diff.length === 0
                ? 'No Changes'
                : `Save ${diff.length} Change${diff.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* VIEW — highlighted JSON */}
      {mode === 'view' && (
        <pre
          className="ace-highlight"
          // We generate the HTML from our own tokenizer — no user-controlled input reaches this
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderHighlighted(JSON.stringify(originalConfig, null, 2)) }}
        />
      )}

      {/* EDIT — textarea + field reference */}
      {mode === 'edit' && (
        <div className="ace-edit-layout">
          <div className="ace-textarea-wrap">
            <textarea
              ref={textareaRef}
              className={`ace-textarea${parseError ? ' has-error' : ''}`}
              value={rawJson}
              onChange={e => handleJsonChange(e.target.value)}
              spellCheck={false}
              aria-label="Agent configuration JSON"
              aria-invalid={!!parseError}
              aria-describedby={parseError ? 'ace-parse-error' : undefined}
            />
            {parseError && (
              <div id="ace-parse-error" className="ace-error" role="alert">
                {parseError}
              </div>
            )}
          </div>

          {/* Known fields reference / autocomplete */}
          <div className="ace-fields" aria-label="Known configuration fields">
            <div className="ace-fields-title">Known Fields</div>
            {Object.entries(FIELD_SCHEMA).map(([key, { type, desc }]) => (
              <button
                key={key}
                className="ace-field-item"
                onClick={() => handleInsertField(key)}
                title={`Insert "${key}" at cursor`}
              >
                <span className="ace-field-name">{key}</span>
                <span className="ace-field-type">{type}</span>
                <span className="ace-field-desc">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* DIFF — field-level comparison before save */}
      {mode === 'diff' && (
        <div className="ace-diff">
          {diff.length === 0 ? (
            <div className="ace-diff-empty">No changes detected — values are identical</div>
          ) : (
            <>
              <div className="ace-diff-count">
                {diff.length} field{diff.length !== 1 ? 's' : ''} changed
              </div>
              <table className="ace-diff-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map(({ key, oldVal, newVal }) => (
                    <tr key={key}>
                      <td className="ace-diff-key">{key}</td>
                      <td className="ace-diff-old">{formatDiffValue(oldVal)}</td>
                      <td className="ace-diff-new">{formatDiffValue(newVal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
