// SIGIL Language Utilities and Bridge Client
// Derived from SUBSTRATE (askalf.org) public docs and parser

import type { ReasoningTrace } from '@substrate/core';

export type SigilDomain =
  | 'KNO' // Knowledge
  | 'PRO' // Process
  | 'MEM' // Memory
  | 'REL' // Relation
  | 'QRY' // Query
  | 'SYN' // Synthesis
  | 'VAL' // Valence
  | 'TMP' // Temporal
  | 'CTX' // Context
  | 'MTA'; // Meta

export type SigilAction =
  | 'GET'
  | 'SET'
  | 'MUT'
  | 'DEL'
  | 'CMP'
  | 'MRG'
  | 'SPL'
  | 'VAL'
  | 'GEN'
  | 'LNK'
  | 'ACK'
  | 'SYNC'
  | 'INIT'
  | 'TERM';

export interface ParsedSigil {
  surface: string; // Surface SIGIL string
  domain: string;
  action: string;
  human?: string | null;
  data: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const IMPORTANCE_MAP: Record<string, number> = {
  '#critical': 9,
  '#high': 8,
  '#important': 7,
  '#medium': 5,
  '#normal': 5,
  '#low': 3,
  '#trivial': 1,
};

const CERTAINTY_MAP: Record<string, string> = {
  '~certain': '!',
  '~confirmed': '!',
  '~verified': '!',
  '~maybe': '?',
  '~uncertain': '?',
  '~possible': '?',
  '~approximate': '~',
  '~roughly': '~',
};

function extractModifiers(text: string) {
  let importance: number | null = null;
  let certainty: string | null = null;
  let context: string | null = null;
  let cleanText = text;

  for (const [modifier, value] of Object.entries(IMPORTANCE_MAP)) {
    if (text.includes(modifier)) {
      importance = value;
      cleanText = cleanText.replace(modifier, '').trim();
      break;
    }
  }

  for (const [modifier, value] of Object.entries(CERTAINTY_MAP)) {
    if (text.includes(modifier)) {
      certainty = value;
      cleanText = cleanText.replace(modifier, '').trim();
      break;
    }
  }

  const contextMatch = text.match(/@(\w+)/);
  if (contextMatch) {
    context = contextMatch[1];
    cleanText = cleanText.replace(contextMatch[0], '').trim();
  }

  return { importance, certainty, context, cleanText };
}

function buildSuffix(importance: number | null, certainty?: string | null) {
  let suffix = '';
  if (importance !== null) suffix += `#${importance}`;
  if (certainty) suffix += certainty;
  return suffix;
}

// Parsers for human Layer 0 commands
function parseRemember(args: string): ParsedSigil {
  const { importance, certainty, context, cleanText } = extractModifiers(args);
  const suffix = buildSuffix(importance, certainty);

  let params = `content:"${cleanText}"`;
  if (context) params += `,domain:${context}`;

  return {
    surface: `[KNO.SET:fact{${params}}${suffix}]`,
    domain: 'KNO',
    action: 'SET',
    human: `/remember ${args}`,
    data: { content: cleanText, domain: context, importance, certainty },
  };
}

function parseForget(args: string): ParsedSigil {
  const { context, cleanText } = extractModifiers(args);

  let params = `match:"${cleanText}"`;
  if (context) params += `,domain:${context}`;

  return {
    surface: `[MEM.DEL:fact{${params}}]`,
    domain: 'MEM',
    action: 'DEL',
    human: `/forget ${args}`,
    data: { match: cleanText, domain: context },
  };
}

function parseFind(args: string): ParsedSigil {
  const { context, cleanText } = extractModifiers(args);

  let params = `pattern:"${cleanText}"`;
  if (context) params += `,domain:${context}`;

  return {
    surface: `[QRY.GET:memory{${params}}]`,
    domain: 'QRY',
    action: 'GET',
    human: `/find ${args}`,
    data: { pattern: cleanText, domain: context },
  };
}

function parseAsk(args: string): ParsedSigil {
  const { importance, certainty, context, cleanText } = extractModifiers(args);
  const suffix = buildSuffix(importance, certainty || '?');

  let params = `query:"${cleanText}"`;
  if (context) params += `,domain:${context}`;

  return {
    surface: `[QRY.GET:answer{${params}}${suffix}]`,
    domain: 'QRY',
    action: 'GET',
    human: `/ask ${args}`,
    data: { query: cleanText, domain: context },
  };
}

function parseCreate(args: string): ParsedSigil {
  const { context, cleanText } = extractModifiers(args);

  let params = `desc:"${cleanText}"`;
  if (context) params += `,domain:${context}`;

  return {
    surface: `[SYN.GEN:content{${params}}]`,
    domain: 'SYN',
    action: 'GEN',
    human: `/create ${args}`,
    data: { description: cleanText, domain: context },
  };
}

function parseLink(args: string): ParsedSigil {
  const parts = args.split(/\s*(?:�\+'|->)\s*/);

  if (parts.length < 2) {
    return {
      surface: `[REL.LNK:concept{to:"${args}"}]`,
      domain: 'REL',
      action: 'LNK',
      human: `/link ${args}`,
      data: { source: args, targets: [] },
    };
  }

  const source = parts[0].trim();
  const targets = parts.slice(1).map(t => t.trim());

  if (targets.length === 1) {
    return {
      surface: `[REL.LNK:${source}{to:${targets[0]}}]`,
      domain: 'REL',
      action: 'LNK',
      human: `/link ${args}`,
      data: { source, targets },
    };
  }

  const chain = targets.map(t => `[REL.LNK:${source}{to:${t}}]`).join('->');
  return {
    surface: chain,
    domain: 'REL',
    action: 'LNK',
    human: `/link ${args}`,
    data: { source, targets },
  };
}

function parseCompare(args: string): ParsedSigil {
  const { importance, cleanText } = extractModifiers(args);
  const suffix = importance !== null ? `#${importance}` : '';

  const parts = cleanText.split(/\s+(?:vs\.?|versus|and)\s+/i);

  if (parts.length < 2) {
    const words = cleanText.split(/\s+/);
    if (words.length >= 2) {
      return {
        surface: `[VAL.CMP:${words[0]}{vs:${words.slice(1).join(' ')}}${suffix}]`,
        domain: 'VAL',
        action: 'CMP',
        human: `/compare ${args}`,
        data: { a: words[0], b: words.slice(1).join(' ') },
      };
    }
  }

  const a = parts[0].trim();
  const b = parts.slice(1).join(' vs ').trim();

  return {
    surface: `[VAL.CMP:${a}{vs:${b}}${suffix}]`,
    domain: 'VAL',
    action: 'CMP',
    human: `/compare ${args}`,
    data: { a, b },
  };
}

function parseSync(args: string): ParsedSigil {
  const scope = args.trim() || 'NOS';

  return {
    surface: `[MEM.SYNC:delta{scope:${scope}}]->[REL.BROADCAST:*]`,
    domain: 'MEM',
    action: 'SYNC',
    human: `/sync ${args}`.trim(),
    data: { scope },
  };
}

function parseStatus(): ParsedSigil {
  return {
    surface: `[MTA.GET:SE{status:AL}]`,
    domain: 'MTA',
    action: 'GET',
    human: '/status',
    data: {},
  };
}

function parseConnect(args: string): ParsedSigil {
  const target = args.trim() || 'TU';

  return {
    surface: `[MTA.INIT:SE{ver:1.0}]->[REL.LNK:${target}{mode:collaborative}]`,
    domain: 'MTA',
    action: 'INIT',
    human: `/connect ${args}`.trim(),
    data: { target },
  };
}

const HUMAN_ROUTE: Record<string, (args: string) => ParsedSigil> = {
  remember: parseRemember,
  r: parseRemember,
  forget: parseForget,
  del: parseForget,
  delete: parseForget,
  find: parseFind,
  search: parseFind,
  f: parseFind,
  ask: parseAsk,
  q: parseAsk,
  query: parseAsk,
  create: parseCreate,
  generate: parseCreate,
  gen: parseCreate,
  link: parseLink,
  connect: parseLink,
  l: parseLink,
  compare: parseCompare,
  cmp: parseCompare,
  vs: parseCompare,
  sync: parseSync,
  share: parseSync,
  status: parseStatus,
  stat: parseStatus,
  init: parseConnect,
  join: parseConnect,
};

/**
 * Convert a human Layer 0 command into Surface SIGIL.
 */
export function parseHumanCommand(input: string): ParsedSigil | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    if (trimmed.startsWith('[')) {
      return { surface: trimmed, domain: 'RAW', action: 'RAW', human: null, data: { raw: trimmed } };
    }
    return null;
  }

  const spaceIndex = trimmed.indexOf(' ');
  const command = (spaceIndex > 0 ? trimmed.substring(1, spaceIndex) : trimmed.substring(1)).toLowerCase();
  const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1) : '';

  const handler = HUMAN_ROUTE[command];
  if (handler) return handler(args);

  return {
    surface: `[QRY.GET:${command}{args:"${args}"}?]`,
    domain: 'QRY',
    action: 'GET',
    human: trimmed,
    data: { command, args },
  };
}

/**
 * Validate Surface SIGIL syntax (lightweight).
 */
export function validateSigil(sigil: string): ValidationResult {
  if (!sigil || typeof sigil !== 'string') {
    return { valid: false, error: 'Empty input' };
  }

  const chainPattern = /^\[.+\](?:->\[.+\])*$/;

  if (!sigil.startsWith('[') || !sigil.endsWith(']')) {
    return { valid: false, error: 'Must be wrapped in brackets []' };
  }

  if (!chainPattern.test(sigil)) {
    return { valid: false, error: 'Invalid SIGIL structure' };
  }

  return { valid: true };
}

/**
 * Pretty-print a SIGIL string.
 */
export function formatSigil(sigil: string): string {
  if (!sigil) return '';
  return sigil
    .replace(/\[([A-Z]+)\.([A-Z]+)/g, '[$1.$2')
    .replace(/\{([^}]+)\}/g, '{$1}')
    .replace(/->/g, '�+\'');
}

export const SIGIL_HELP = `SIGIL Human Commands (Layer 0)
==============================

/remember [text]     Store knowledge
/forget [text]       Remove knowledge
/find [query]        Search memory
/ask [question]      Query with context
/create [what]       Generate new content
/link [a] �+' [b]      Connect concepts
/compare [a] vs [b]  Evaluate options
/sync                Share with collective
/status              Get system status

Modifiers:
  #critical, #high, #low    Importance level
  ~certain, ~maybe          Certainty level
  @domain                   Scope to domain
`; 

// ------------------------
// SIGIL Bridge Client
// ------------------------

export interface SigilBridgeClientOptions {
  baseUrl?: string; // defaults to https://api.askalf.org
  apiKey?: string;
  fetcher?: typeof fetch;
}

export interface SigilMessage {
  sigil: string;
  sender?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export class SigilBridgeClient {
  private baseUrl: string;
  private apiKey?: string;
  private fetcher: typeof fetch;

  constructor(options: SigilBridgeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.askalf.org';
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    if (!this.fetcher) {
      throw new Error('No fetch available. Provide a fetcher in options.');
    }
  }

  /** Broadcast a SIGIL message to the bridge. */
  async broadcast(message: SigilMessage): Promise<{ success: boolean; id?: string; error?: string }> {
    const validation = validateSigil(message.sigil);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid SIGIL' };
    }

    const response = await this.fetcher(`${this.baseUrl}/api/v1/sigil/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: JSON.stringify({ sigil: message.sigil, sender: message.sender, metadata: message.metadata }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json().catch(() => ({}));
    return { success: true, id: (data as Record<string, unknown>).id as string | undefined };
  }

  /** Fetch recent SIGIL messages (bridge feed). */
  async getFeed(limit = 50): Promise<SigilMessage[]> {
    const response = await this.fetcher(`${this.baseUrl}/api/v1/sigil/feed?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch SIGIL feed: ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data)) return data as SigilMessage[];
    if (Array.isArray((data as Record<string, unknown>).messages)) {
      return (data as { messages: SigilMessage[] }).messages;
    }
    return [];
  }
}

// ------------------------
// Utility: extract SIGIL traces from reasoning logs
// ------------------------

export function extractSigilFromTrace(trace: ReasoningTrace): string[] {
  const matches: string[] = [];
  const fields = [trace.input, trace.output, trace.reasoning ?? ''];
  const pattern = /\[[A-Z]{3}\.[A-Z]+:[^\]]+\](?:->\[[^\]]+\])*/g;
  for (const field of fields) {
    if (!field) continue;
    const found = field.match(pattern);
    if (found) matches.push(...found);
  }
  return matches;
}








// SIGIL feed polling helper (fallback when SSE/WS not available)
export interface SigilFeedOptions extends SigilBridgeClientOptions {
  intervalMs?: number;
  limit?: number;
}

export type SigilFeedHandler = (messages: SigilMessage[]) => void;

export function createSigilFeedPoller(
  opts: SigilFeedOptions,
  onMessages: SigilFeedHandler
): () => void {
  const client = new SigilBridgeClient(opts);
  const interval = opts.intervalMs ?? 3000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick() {
    try {
      const feed = await client.getFeed(opts.limit ?? 20);
      onMessages(feed);
    } catch (e) {
      console.error('[SIGIL feed] poll error', e);
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }

  timer = setTimeout(tick, interval);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
