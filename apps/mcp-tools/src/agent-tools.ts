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
    name: 'team_coordinate',
    description: 'Create a multi-agent team to work on a complex task. Supports pipeline (sequential A→B→C), fan-out (parallel dispatch), and consensus (parallel analysis + synthesizer). Returns session ID to track progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'ID of the calling agent (lead agent)' },
        agent_name: { type: 'string', description: 'Name of the calling agent' },
        title: { type: 'string', description: 'Title of the coordination plan' },
        pattern: {
          type: 'string',
          enum: ['pipeline', 'fan-out', 'consensus'],
          description: 'Coordination pattern: pipeline (A→B→C), fan-out (parallel), consensus (parallel + synthesizer)',
        },
        tasks: {
          type: 'array',
          description: 'Tasks to assign to agents',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title (used as dependency reference)' },
              description: { type: 'string', description: 'Detailed task description' },
              agentName: { type: 'string', description: 'Agent name to assign (e.g. "Sentinel", "Backend Dev")' },
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
  if (!['pipeline', 'fan-out', 'consensus'].includes(pattern)) {
    return JSON.stringify({ error: 'pattern must be: pipeline, fan-out, or consensus' });
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
