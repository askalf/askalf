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
    name: 'discord_ops',
    description: 'Send messages, read channels, list members, and manage the AskAlf Discord server. Uses Discord REST API with bot token.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['send_message', 'read_messages', 'list_channels', 'list_members', 'add_reaction'], description: 'Action to perform' },
        channel_id: { type: 'string', description: 'Discord channel ID. Required for send_message, read_messages, add_reaction.' },
        message: { type: 'string', description: 'Message content for send_message.' },
        message_id: { type: 'string', description: 'Message ID for add_reaction.' },
        emoji: { type: 'string', description: 'Emoji for add_reaction (e.g., "👍").' },
        limit: { type: 'number', description: 'Number of messages to fetch (default 10, max 50).' },
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
    case 'discord_ops': return handleDiscordOps(args);
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
// twitter_ops — Cookie-based X/Twitter via agent-twitter-client
// Routes through Gluetun VPN proxy when available.
// No paid API tier needed — uses same endpoints as the web browser.
// ============================================

let _scraper: unknown = null;
let _scraperReady = false;

async function getScraper(): Promise<unknown> {
  if (_scraperReady && _scraper) return _scraper;

  const username = process.env['TWITTER_USERNAME'] || '';
  const password = process.env['TWITTER_PASSWORD'] || '';
  const email = process.env['TWITTER_EMAIL'] || '';

  if (!username || !password) {
    throw new Error('Twitter credentials not configured. Set TWITTER_USERNAME, TWITTER_PASSWORD, and optionally TWITTER_EMAIL in .env');
  }

  try {
    const { Scraper } = await import('agent-twitter-client');
    const scraper = new Scraper();

    // Configure proxy if Gluetun VPN is available
    const proxy = process.env['HTTPS_PROXY'] || process.env['HTTP_PROXY'];
    if (proxy) {
      log(`twitter_ops: routing through VPN proxy ${proxy}`);
    }

    await scraper.login(username, password, email || undefined);
    _scraper = scraper;
    _scraperReady = true;
    log(`twitter_ops: logged in as @${username} (cookie-based)`);
    return scraper;
  } catch (err) {
    _scraperReady = false;
    _scraper = null;
    throw new Error(`Twitter login failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// Human-like delay between actions (2-5 seconds)
function humanDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 3000;
  return new Promise(r => setTimeout(r, ms));
}

async function handleTwitterOps(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;
  if (!action) return JSON.stringify({ error: 'action is required' });

  try {
    const scraper = await getScraper() as {
      sendTweet: (text: string, replyTo?: string) => Promise<{ id_str?: string; text?: string } | { rest_id?: string }>;
      getTweets: (username: string, count: number) => AsyncGenerator<{ id?: string; text?: string; username?: string; likes?: number; retweets?: number; timeParsed?: Date }>;
      getProfile: (username: string) => Promise<Record<string, unknown>>;
      searchTweets: (query: string, count: number, mode: number) => AsyncGenerator<{ id?: string; text?: string; username?: string }>;
      likeTweet: (tweetId: string) => Promise<void>;
      retweet: (tweetId: string) => Promise<void>;
      isLoggedIn: () => Promise<boolean>;
    };

    switch (action) {
      case 'post_tweet': {
        const text = args['text'] as string;
        if (!text) return JSON.stringify({ error: 'text is required' });
        if (text.length > 280) return JSON.stringify({ error: `Tweet too long (${text.length}/280)` });
        await humanDelay();
        const result = await scraper.sendTweet(text, args['reply_to_id'] as string | undefined);
        const id = (result as Record<string, unknown>)?.['rest_id'] || (result as Record<string, unknown>)?.['id_str'] || '';
        log(`twitter_ops: posted tweet ${id}`);
        return JSON.stringify({ posted: true, id, text, url: id ? `https://x.com/i/status/${id}` : null });
      }

      case 'post_thread': {
        const thread = args['thread'] as string[];
        if (!thread?.length) return JSON.stringify({ error: 'thread array is required' });
        const results: Array<{ id: string; text: string }> = [];
        let replyTo: string | undefined;
        for (const text of thread) {
          if (text.length > 280) return JSON.stringify({ error: `Tweet "${text.slice(0, 30)}..." too long (${text.length}/280)` });
          await humanDelay();
          const result = await scraper.sendTweet(text, replyTo);
          const id = String((result as Record<string, unknown>)?.['rest_id'] || (result as Record<string, unknown>)?.['id_str'] || '');
          results.push({ id, text });
          replyTo = id;
        }
        log(`twitter_ops: posted thread (${results.length} tweets)`);
        return JSON.stringify({ posted: true, tweets: results.length, thread: results, url: results[0]?.id ? `https://x.com/i/status/${results[0].id}` : null });
      }

      case 'reply': {
        const text = args['text'] as string;
        const replyId = args['reply_to_id'] as string;
        if (!text || !replyId) return JSON.stringify({ error: 'text and reply_to_id required' });
        await humanDelay();
        const result = await scraper.sendTweet(text, replyId);
        const id = String((result as Record<string, unknown>)?.['rest_id'] || (result as Record<string, unknown>)?.['id_str'] || '');
        return JSON.stringify({ replied: true, id, text });
      }

      case 'search': {
        const query = args['query'] as string;
        if (!query) return JSON.stringify({ error: 'query is required' });
        const max = Math.min((args['max_results'] as number) || 10, 50);
        const tweets: Array<Record<string, unknown>> = [];
        const gen = scraper.searchTweets(query, max, 1); // mode 1 = Latest
        for await (const tweet of gen) {
          tweets.push({ id: tweet.id, text: tweet.text, username: tweet.username });
          if (tweets.length >= max) break;
        }
        return JSON.stringify({ count: tweets.length, tweets });
      }

      case 'get_mentions': {
        const username = process.env['TWITTER_USERNAME'] || '';
        const max = Math.min((args['max_results'] as number) || 20, 50);
        const mentions: Array<Record<string, unknown>> = [];
        // Search for @mentions
        const gen = scraper.searchTweets(`@${username}`, max, 1);
        for await (const tweet of gen) {
          mentions.push({ id: tweet.id, text: tweet.text, username: tweet.username });
          if (mentions.length >= max) break;
        }
        return JSON.stringify({ count: mentions.length, mentions });
      }

      case 'get_profile': {
        const username = (args['username'] as string) || process.env['TWITTER_USERNAME'] || '';
        if (!username) return JSON.stringify({ error: 'username required' });
        const profile = await scraper.getProfile(username);
        return JSON.stringify(profile);
      }

      case 'like': {
        const tweetId = args['tweet_id'] as string;
        if (!tweetId) return JSON.stringify({ error: 'tweet_id required' });
        await humanDelay();
        await scraper.likeTweet(tweetId);
        return JSON.stringify({ liked: true });
      }

      case 'retweet': {
        const tweetId = args['tweet_id'] as string;
        if (!tweetId) return JSON.stringify({ error: 'tweet_id required' });
        await humanDelay();
        await scraper.retweet(tweetId);
        return JSON.stringify({ retweeted: true });
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}. Valid: post_tweet, post_thread, reply, search, get_mentions, get_profile, like, retweet` });
    }
  } catch (err) {
    // Reset scraper on auth failure so next call re-logs in
    if (err instanceof Error && /login|auth|403|401/i.test(err.message)) {
      _scraperReady = false;
      _scraper = null;
    }
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Twitter operation failed' });
  }
}

// ============================================
// discord_ops — Discord REST API
// ============================================

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = process.env['DISCORD_BOT_TOKEN'] || '';

async function discordFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured in .env');
  return fetch(`${DISCORD_API}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
}

async function handleDiscordOps(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;
  if (!action) return JSON.stringify({ error: 'action is required' });

  try {
    switch (action) {
      case 'send_message': {
        const channelId = args['channel_id'] as string;
        const message = args['message'] as string;
        if (!channelId || !message) return JSON.stringify({ error: 'channel_id and message required' });
        const res = await discordFetch(`/channels/${channelId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content: message }),
        });
        if (!res.ok) { const e = await res.text().catch(() => ''); return JSON.stringify({ error: `Discord ${res.status}: ${e.slice(0, 300)}` }); }
        const data = await res.json() as { id: string; content: string };
        log(`discord_ops: sent message ${data.id} to channel ${channelId}`);
        return JSON.stringify({ sent: true, id: data.id, content: data.content });
      }

      case 'read_messages': {
        const channelId = args['channel_id'] as string;
        if (!channelId) return JSON.stringify({ error: 'channel_id required' });
        const limit = Math.min((args['limit'] as number) || 10, 50);
        const res = await discordFetch(`/channels/${channelId}/messages?limit=${limit}`);
        if (!res.ok) return JSON.stringify({ error: `Discord ${res.status}` });
        const messages = await res.json() as Array<{ id: string; content: string; author: { username: string }; timestamp: string }>;
        return JSON.stringify({
          count: messages.length,
          messages: messages.map(m => ({ id: m.id, content: m.content, author: m.author.username, timestamp: m.timestamp })),
        });
      }

      case 'list_channels': {
        // Get guild ID from bot's guilds
        const guildsRes = await discordFetch('/users/@me/guilds');
        if (!guildsRes.ok) return JSON.stringify({ error: 'Failed to fetch guilds' });
        const guilds = await guildsRes.json() as Array<{ id: string; name: string }>;
        if (guilds.length === 0) return JSON.stringify({ error: 'Bot is not in any servers' });

        const guildId = guilds[0]!.id;
        const channelsRes = await discordFetch(`/guilds/${guildId}/channels`);
        if (!channelsRes.ok) return JSON.stringify({ error: 'Failed to fetch channels' });
        const channels = await channelsRes.json() as Array<{ id: string; name: string; type: number }>;
        // Type 0 = text, 2 = voice, 5 = announcement
        return JSON.stringify({
          guild: guilds[0]!.name,
          channels: channels.filter(c => c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name, type: c.type === 5 ? 'announcement' : 'text' })),
        });
      }

      case 'list_members': {
        const guildsRes = await discordFetch('/users/@me/guilds');
        if (!guildsRes.ok) return JSON.stringify({ error: 'Failed to fetch guilds' });
        const guilds = await guildsRes.json() as Array<{ id: string }>;
        if (guilds.length === 0) return JSON.stringify({ error: 'No guilds' });

        const limit = Math.min((args['limit'] as number) || 20, 100);
        const membersRes = await discordFetch(`/guilds/${guilds[0]!.id}/members?limit=${limit}`);
        if (!membersRes.ok) return JSON.stringify({ error: 'Failed to fetch members' });
        const members = await membersRes.json() as Array<{ user: { id: string; username: string }; joined_at: string }>;
        return JSON.stringify({
          count: members.length,
          members: members.map(m => ({ id: m.user.id, username: m.user.username, joined_at: m.joined_at })),
        });
      }

      case 'add_reaction': {
        const channelId = args['channel_id'] as string;
        const messageId = args['message_id'] as string;
        const emoji = args['emoji'] as string;
        if (!channelId || !messageId || !emoji) return JSON.stringify({ error: 'channel_id, message_id, and emoji required' });
        const encoded = encodeURIComponent(emoji);
        const res = await discordFetch(`/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, { method: 'PUT' });
        return JSON.stringify({ reacted: res.ok });
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}. Valid: send_message, read_messages, list_channels, list_members, add_reaction` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Discord operation failed' });
  }
}
