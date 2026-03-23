/**
 * Agent tool handlers: web_search, web_browse, team_coordinate
 *
 * web_search — SearXNG self-hosted meta search (no API keys)
 * web_browse — Fetch URL and extract text content
 * team_coordinate — Multi-agent team coordination via Forge API
 */

const SEARXNG_URL = process.env['SEARXNG_URL'] ?? 'http://searxng:8080';
const FORGE_URL = process.env['FORGE_URL'] ?? 'http://forge:3005';
const FORGE_API_KEY = process.env['FORGE_API_KEY'] ?? '';
const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;
const log = (msg: string) => console.log(`[mcp-tools:agent] ${new Date().toISOString()} ${msg}`);

// ============================================
// Tool Definitions
// ============================================

export const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web using self-hosted SearXNG meta-search. Aggregates results from Google, Bing, DuckDuckGo, Wikipedia, GitHub, StackOverflow. No API keys required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_browse',
    description: 'Fetch a URL and extract its text content. Strips HTML tags, decodes entities. Supports optional CSS-tag selector filtering and max length truncation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch (http or https)' },
        selector: { type: 'string', description: 'Optional HTML tag to extract (e.g. "article", "main", "h1")' },
        max_length: { type: 'number', description: 'Maximum content length in characters (default: 5000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'twitter_ops',
    description: 'Post tweets, threads, reply to mentions, search hashtags, get profile info, like and retweet on Twitter/X. Requires TWITTER_* env vars or integration credentials.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['post_tweet', 'post_thread', 'reply', 'search', 'get_mentions', 'get_profile', 'delete_tweet', 'like', 'retweet'], description: 'Action to perform' },
        text: { type: 'string', description: 'Tweet text (max 280 chars). Required for post_tweet and reply.' },
        thread: { type: 'array', items: { type: 'string' }, description: 'Array of tweet texts for post_thread.' },
        reply_to_id: { type: 'string', description: 'Tweet ID to reply to.' },
        tweet_id: { type: 'string', description: 'Tweet ID for delete, like, or retweet.' },
        query: { type: 'string', description: 'Search query for finding tweets.' },
        max_results: { type: 'number', description: 'Max results for search/mentions (default 10).' },
        username: { type: 'string', description: 'Username for get_profile (omit for own profile).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'team_coordinate',
    description: 'Create a multi-agent team to work on a complex task. Supports single (direct dispatch to one agent), pipeline (sequential A→B→C), fan-out (parallel dispatch), and consensus (parallel analysis + synthesizer). Returns session ID to track progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'ID of the calling agent (lead agent)' },
        agent_name: { type: 'string', description: 'Name of the calling agent' },
        title: { type: 'string', description: 'Title of the coordination plan' },
        pattern: {
          type: 'string',
          enum: ['single', 'pipeline', 'fan-out', 'consensus'],
          description: 'Coordination pattern: single (one agent, direct execution), pipeline (A→B→C), fan-out (parallel), consensus (parallel + synthesizer)',
        },
        tasks: {
          type: 'array',
          description: 'Tasks to assign to agents',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title (used as dependency reference)' },
              description: { type: 'string', description: 'Detailed task description' },
              agentName: { type: 'string', description: 'Worker name to assign (e.g. "Security Scanner", "Builder", "Researcher")' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Titles of prerequisite tasks' },
            },
            required: ['title', 'description', 'agentName'],
          },
        },
      },
      required: ['agent_id', 'agent_name', 'title', 'pattern', 'tasks'],
    },
  },
];

// ============================================
// Handlers
// ============================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'web_search': return handleWebSearch(args);
    case 'web_browse': return handleWebBrowse(args);
    case 'twitter_ops': return handleTwitterOps(args);
    case 'team_coordinate': return handleTeamCoordinate(args);
    default: throw new Error(`Unknown agent tool: ${name}`);
  }
}

// ============================================
// web_search — SearXNG
// ============================================

interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
}

async function handleWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args['query'] ?? '').trim();
  if (!query) return JSON.stringify({ error: 'query is required' });

  const maxResults = Math.min(Number(args['max_results'] ?? 5), 20);
  log(`web_search: "${query}" (max ${maxResults})`);

  const params = new URLSearchParams({ q: query, format: 'json', pageno: '1' });
  const url = `${SEARXNG_URL}/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return JSON.stringify({ error: `SearXNG HTTP ${response.status}: ${body.slice(0, 200)}` });
    }

    const data = await response.json() as { results?: SearXNGResult[] };
    const results = (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? '',
    }));

    return JSON.stringify({ query, resultCount: results.length, results });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return JSON.stringify({ error: `Search timed out after ${SEARCH_TIMEOUT_MS}ms` });
    }
    return JSON.stringify({ error: `Web search failed: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// web_browse — URL fetch + text extraction
// ============================================

async function handleWebBrowse(args: Record<string, unknown>): Promise<string> {
  const urlStr = String(args['url'] ?? '');
  const selector = args['selector'] ? String(args['selector']) : undefined;
  const maxLength = Number(args['max_length'] ?? 5000);

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return JSON.stringify({ error: `Invalid URL: ${urlStr}` });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return JSON.stringify({ error: `Unsupported protocol: ${parsed.protocol}` });
  }

  log(`web_browse: ${urlStr}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'AgentForge/1.0 (web-browse tool)',
        'Accept': 'text/html, application/xhtml+xml, text/plain, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      return JSON.stringify({ error: `HTTP ${response.status}: ${response.statusText}` });
    }

    const contentType = response.headers.get('content-type') ?? '';
    const rawBody = await response.text();

    let textContent: string;
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      textContent = extractTextFromHtml(rawBody, selector);
    } else if (contentType.includes('application/json')) {
      try {
        textContent = JSON.stringify(JSON.parse(rawBody), null, 2);
      } catch {
        textContent = rawBody;
      }
    } else {
      textContent = rawBody;
    }

    const truncated = textContent.length > maxLength;
    const content = truncated ? textContent.slice(0, maxLength) : textContent;

    return JSON.stringify({
      url: urlStr,
      statusCode: response.status,
      contentType,
      content,
      truncated,
      originalLength: textContent.length,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return JSON.stringify({ error: `Request timed out after ${FETCH_TIMEOUT_MS}ms` });
    }
    return JSON.stringify({ error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromHtml(html: string, selector?: string): string {
  let content = html;

  if (selector) {
    const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch) {
      const tag = tagMatch[1]!;
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        if (match[1]) matches.push(match[1]);
      }
      if (matches.length > 0) content = matches.join('\n\n');
    }
  }

  // Remove script/style/noscript
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Block elements → newlines
  content = content.replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, '\n');
  content = content.replace(/<li[^>]*>/gi, '\n- ');

  // Strip remaining tags
  content = content.replace(/<[^>]+>/g, '');

  // Decode entities
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&#x27;/g, "'");
  content = content.replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  return content.trim();
}

// ============================================
// team_coordinate — Forge coordination API
// ============================================

async function handleTeamCoordinate(args: Record<string, unknown>): Promise<string> {
  const agentId = String(args['agent_id'] ?? '');
  const agentName = String(args['agent_name'] ?? '');
  const title = String(args['title'] ?? '').trim();
  const pattern = String(args['pattern'] ?? '');
  const tasks = args['tasks'] as Array<{
    title: string;
    description: string;
    agentName: string;
    dependencies?: string[];
  }> | undefined;

  if (!title) return JSON.stringify({ error: 'title is required' });
  if (!['single', 'pipeline', 'fan-out', 'consensus'].includes(pattern)) {
    return JSON.stringify({ error: 'pattern must be: single, pipeline, fan-out, or consensus' });
  }
  if (!tasks?.length) return JSON.stringify({ error: 'At least one task is required' });

  log(`team_coordinate: "${title}" (${pattern}, ${tasks.length} tasks) by ${agentName}`);

  try {
    const response = await fetch(`${FORGE_URL}/api/v1/forge/coordination/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FORGE_API_KEY}`,
      },
      body: JSON.stringify({
        leadAgentId: agentId,
        leadAgentName: agentName,
        title,
        pattern,
        tasks,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return JSON.stringify({ error: `Forge API error: HTTP ${response.status} — ${body.slice(0, 300)}` });
    }

    const result = await response.json() as Record<string, unknown>;
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: `Team coordination failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ============================================
// twitter_ops — Twitter/X API v2
// ============================================

import { createHmac, randomBytes } from 'crypto';

const TWITTER_API = 'https://api.twitter.com/2';

function getTwitterCreds() {
  const api_key = process.env['TWITTER_API_KEY'] || '';
  const api_secret = process.env['TWITTER_API_SECRET'] || '';
  const access_token = process.env['TWITTER_ACCESS_TOKEN'] || '';
  const access_token_secret = process.env['TWITTER_ACCESS_TOKEN_SECRET'] || '';
  const bearer_token = process.env['TWITTER_BEARER_TOKEN'] || '';
  if (!api_key || !access_token) throw new Error('Twitter credentials not configured. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET, TWITTER_BEARER_TOKEN in .env');
  return { api_key, api_secret, access_token, access_token_secret, bearer_token };
}

function pctEncode(s: string): string { return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

function oauthHeader(method: string, url: string, creds: ReturnType<typeof getTwitterCreds>): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    oauth_consumer_key: creds.api_key, oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts,
    oauth_token: creds.access_token, oauth_version: '1.0',
  };
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const paramStr = sorted.map(([k, v]) => `${pctEncode(k)}=${pctEncode(v)}`).join('&');
  const base = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramStr)}`;
  const key = `${pctEncode(creds.api_secret)}&${pctEncode(creds.access_token_secret)}`;
  params['oauth_signature'] = createHmac('sha1', key).update(base).digest('base64');
  const header = Object.entries(params).filter(([k]) => k.startsWith('oauth_')).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pctEncode(k)}="${pctEncode(v)}"`).join(', ');
  return `OAuth ${header}`;
}

async function handleTwitterOps(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;
  if (!action) return JSON.stringify({ error: 'action is required' });

  try {
    const creds = getTwitterCreds();

    switch (action) {
      case 'post_tweet': {
        const text = args['text'] as string;
        if (!text) return JSON.stringify({ error: 'text is required' });
        if (text.length > 280) return JSON.stringify({ error: `Tweet too long (${text.length}/280)` });
        const url = `${TWITTER_API}/tweets`;
        const body: Record<string, unknown> = { text };
        if (args['reply_to_id']) body['reply'] = { in_reply_to_tweet_id: args['reply_to_id'] };
        const auth = oauthHeader('POST', url, creds);
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        if (!res.ok) { const e = await res.text().catch(() => ''); return JSON.stringify({ error: `Twitter ${res.status}: ${e.slice(0, 300)}` }); }
        const data = await res.json() as { data: { id: string; text: string } };
        log(`twitter_ops: posted tweet ${data.data.id}`);
        return JSON.stringify({ posted: true, id: data.data.id, text: data.data.text, url: `https://x.com/i/status/${data.data.id}` });
      }

      case 'post_thread': {
        const thread = args['thread'] as string[];
        if (!thread?.length) return JSON.stringify({ error: 'thread array is required' });
        const results: Array<{ id: string; text: string }> = [];
        let replyTo: string | undefined;
        for (const text of thread) {
          if (text.length > 280) return JSON.stringify({ error: `Tweet "${text.slice(0, 30)}..." too long (${text.length}/280)` });
          const url = `${TWITTER_API}/tweets`;
          const body: Record<string, unknown> = { text };
          if (replyTo) body['reply'] = { in_reply_to_tweet_id: replyTo };
          const auth = oauthHeader('POST', url, creds);
          const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
          if (!res.ok) { const e = await res.text().catch(() => ''); return JSON.stringify({ error: `Twitter ${res.status}: ${e.slice(0, 300)}` }); }
          const data = await res.json() as { data: { id: string; text: string } };
          results.push(data.data);
          replyTo = data.data.id;
        }
        log(`twitter_ops: posted thread (${results.length} tweets)`);
        return JSON.stringify({ posted: true, tweets: results.length, thread: results, url: `https://x.com/i/status/${results[0]!.id}` });
      }

      case 'reply': {
        const text = args['text'] as string;
        const replyId = args['reply_to_id'] as string;
        if (!text || !replyId) return JSON.stringify({ error: 'text and reply_to_id required' });
        const url = `${TWITTER_API}/tweets`;
        const auth = oauthHeader('POST', url, creds);
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: replyId } }), signal: AbortSignal.timeout(15000) });
        if (!res.ok) { const e = await res.text().catch(() => ''); return JSON.stringify({ error: `Twitter ${res.status}: ${e.slice(0, 300)}` }); }
        const data = await res.json() as { data: { id: string; text: string } };
        return JSON.stringify({ replied: true, id: data.data.id, text: data.data.text });
      }

      case 'search': {
        const query = args['query'] as string;
        if (!query) return JSON.stringify({ error: 'query is required' });
        const max = Math.min((args['max_results'] as number) || 10, 100);
        const params = new URLSearchParams({ query, max_results: String(max), 'tweet.fields': 'created_at,public_metrics,author_id' });
        const res = await fetch(`${TWITTER_API}/tweets/search/recent?${params}`, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) { const e = await res.text().catch(() => ''); return JSON.stringify({ error: `Search ${res.status}: ${e.slice(0, 300)}` }); }
        const data = await res.json() as { data?: unknown[]; meta?: unknown };
        return JSON.stringify({ count: data.data?.length || 0, tweets: data.data || [] });
      }

      case 'get_mentions': {
        const meRes = await fetch(`${TWITTER_API}/users/me`, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(10000) });
        if (!meRes.ok) return JSON.stringify({ error: 'Failed to get user info' });
        const me = await meRes.json() as { data: { id: string } };
        const max = Math.min((args['max_results'] as number) || 20, 100);
        const res = await fetch(`${TWITTER_API}/users/${me.data.id}/mentions?max_results=${max}&tweet.fields=created_at,public_metrics,author_id`, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return JSON.stringify({ error: `Mentions ${res.status}` });
        const data = await res.json() as { data?: unknown[] };
        return JSON.stringify({ count: data.data?.length || 0, mentions: data.data || [] });
      }

      case 'get_profile': {
        const username = args['username'] as string;
        const endpoint = username
          ? `${TWITTER_API}/users/by/username/${username}?user.fields=description,public_metrics,created_at`
          : `${TWITTER_API}/users/me?user.fields=description,public_metrics,created_at`;
        const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return JSON.stringify({ error: `Profile ${res.status}` });
        const data = await res.json() as { data: unknown };
        return JSON.stringify(data.data);
      }

      case 'delete_tweet': {
        const tweetId = args['tweet_id'] as string;
        if (!tweetId) return JSON.stringify({ error: 'tweet_id required' });
        const url = `${TWITTER_API}/tweets/${tweetId}`;
        const auth = oauthHeader('DELETE', url, creds);
        const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': auth }, signal: AbortSignal.timeout(10000) });
        return JSON.stringify({ deleted: res.ok });
      }

      case 'like': {
        const tweetId = args['tweet_id'] as string;
        if (!tweetId) return JSON.stringify({ error: 'tweet_id required' });
        const meRes = await fetch(`${TWITTER_API}/users/me`, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(10000) });
        if (!meRes.ok) return JSON.stringify({ error: 'Failed to get user info' });
        const me = await meRes.json() as { data: { id: string } };
        const url = `${TWITTER_API}/users/${me.data.id}/likes`;
        const auth = oauthHeader('POST', url, creds);
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ tweet_id: tweetId }), signal: AbortSignal.timeout(10000) });
        return JSON.stringify({ liked: res.ok });
      }

      case 'retweet': {
        const tweetId = args['tweet_id'] as string;
        if (!tweetId) return JSON.stringify({ error: 'tweet_id required' });
        const meRes = await fetch(`${TWITTER_API}/users/me`, { headers: { 'Authorization': `Bearer ${creds.bearer_token}` }, signal: AbortSignal.timeout(10000) });
        if (!meRes.ok) return JSON.stringify({ error: 'Failed to get user info' });
        const me = await meRes.json() as { data: { id: string } };
        const url = `${TWITTER_API}/users/${me.data.id}/retweets`;
        const auth = oauthHeader('POST', url, creds);
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ tweet_id: tweetId }), signal: AbortSignal.timeout(10000) });
        return JSON.stringify({ retweeted: res.ok });
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Twitter operation failed' });
  }
}
