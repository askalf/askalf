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
const log = (msg: string) => console.log(`[mcp-tools:alf] ${new Date().toISOString()} ${msg}`);

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
    name: 'browser_use',
    description: 'Control a headless browser — navigate pages, take screenshots, click elements, fill forms, extract text. Powered by Puppeteer. Use for pages that require JavaScript rendering.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['navigate', 'screenshot', 'click', 'type', 'extract', 'evaluate', 'get_page_info', 'close'], description: 'Browser action to perform' },
        url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
        selector: { type: 'string', description: 'CSS selector for click, type, or extract actions' },
        text: { type: 'string', description: 'Text to type (for type action)' },
        script: { type: 'string', description: 'JavaScript to evaluate in the page (for evaluate action)' },
        wait_for: { type: 'string', description: 'CSS selector to wait for after navigation (optional)' },
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
    case 'browser_use': return handleBrowserUse(args);
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

  // Remove script/style/noscript — loop until stable to prevent nested bypass
  let prev = '';
  while (prev !== content) {
    prev = content;
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
  }

  // Block elements → newlines
  content = content.replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, '\n');
  content = content.replace(/<li[^>]*>/gi, '\n- ');

  // Strip remaining tags — loop until stable
  prev = '';
  while (prev !== content) {
    prev = content;
    content = content.replace(/<[^>]+>/g, '');
  }

  // Decode entities AFTER all tags are fully stripped
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&lt;/g, ' ');
  content = content.replace(/&gt;/g, ' ');
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
// twitter_ops — X/Twitter via browser bridge OR OAuth API OR cookie scraper
// Strategy: OAuth API (if keys set) → Browser bridge (CDP) → Cookie scraper (legacy fallback)
// ============================================

// Human-like delay between actions (2-5 seconds)
function humanDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 3000;
  return new Promise(r => setTimeout(r, ms));
}

type TwitterStrategy = 'oauth' | 'browser' | 'scraper';

function detectTwitterStrategy(): TwitterStrategy {
  if (process.env['TWITTER_API_KEY'] && process.env['TWITTER_API_SECRET'] &&
      process.env['TWITTER_ACCESS_TOKEN'] && process.env['TWITTER_ACCESS_TOKEN_SECRET']) {
    return 'oauth';
  }
  // Check if browser bridge is available
  const browserHost = process.env['BROWSER_HOST'] || 'browser';
  const browserPort = process.env['BROWSER_PORT'] || '9222';
  // We'll try browser first, fall back to scraper
  return 'browser';
}

let _twitterPage: import('puppeteer-core').Page | null = null;
let _twitterLoggedIn = false;

async function getTwitterBrowserPage(): Promise<import('puppeteer-core').Page> {
  if (_twitterPage && !_twitterPage.isClosed() && _twitterLoggedIn) return _twitterPage;

  const browser = await getBrowser(); // reuse browser_use's connection
  _twitterPage = await browser.newPage();
  await _twitterPage.setViewport({ width: 1280, height: 900 });
  await _twitterPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');

  // Check if already logged in
  await _twitterPage.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 20000 });
  await humanDelay();

  const url = _twitterPage.url();
  if (url.includes('/login') || url.includes('/i/flow/login')) {
    // Need to log in
    const username = process.env['TWITTER_USERNAME'] || '';
    const password = process.env['TWITTER_PASSWORD'] || '';
    if (!username || !password) {
      throw new Error('Twitter credentials not configured. Set TWITTER_USERNAME and TWITTER_PASSWORD.');
    }

    log('twitter_ops: logging in via browser bridge...');

    // Enter username
    await _twitterPage.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await _twitterPage.type('input[autocomplete="username"]', username, { delay: 50 });
    await humanDelay();

    // Click Next
    const nextButtons = await _twitterPage.$$('button');
    for (const btn of nextButtons) {
      const text = await btn.evaluate((el: HTMLElement) => el.textContent?.trim());
      if (text === 'Next') { await btn.click(); break; }
    }
    await humanDelay();

    // Handle email verification step if it appears
    const emailInput = await _twitterPage.$('input[data-testid="ocfEnterTextTextInput"]');
    if (emailInput) {
      const email = process.env['TWITTER_EMAIL'] || '';
      if (email) {
        await emailInput.type(email, { delay: 50 });
        const verifyNext = await _twitterPage.$$('button');
        for (const btn of verifyNext) {
          const text = await btn.evaluate((el: HTMLElement) => el.textContent?.trim());
          if (text === 'Next') { await btn.click(); break; }
        }
        await humanDelay();
      }
    }

    // Enter password
    await _twitterPage.waitForSelector('input[type="password"]', { timeout: 10000 });
    await _twitterPage.type('input[type="password"]', password, { delay: 50 });
    await humanDelay();

    // Click Log in
    const loginButtons = await _twitterPage.$$('button');
    for (const btn of loginButtons) {
      const text = await btn.evaluate((el: HTMLElement) => el.textContent?.trim());
      if (text === 'Log in') { await btn.click(); break; }
    }

    await new Promise(r => setTimeout(r, 5000));

    // Verify login succeeded
    const postLoginUrl = _twitterPage.url();
    if (postLoginUrl.includes('/home')) {
      _twitterLoggedIn = true;
      log('twitter_ops: browser login successful');
    } else {
      throw new Error(`Twitter browser login failed — ended up at ${postLoginUrl}`);
    }
  } else {
    _twitterLoggedIn = true;
    log('twitter_ops: already logged in via browser');
  }

  return _twitterPage;
}

// Legacy cookie scraper fallback
let _scraper: unknown = null;
let _scraperReady = false;

async function getScraperFallback(): Promise<unknown> {
  if (_scraperReady && _scraper) return _scraper;
  const { Scraper } = await import('agent-twitter-client');
  const scraper = new Scraper();
  const username = process.env['TWITTER_USERNAME'] || '';
  const password = process.env['TWITTER_PASSWORD'] || '';
  const email = process.env['TWITTER_EMAIL'] || '';
  if (!username || !password) throw new Error('Twitter credentials not configured');
  await scraper.login(username, password, email || undefined);
  _scraper = scraper;
  _scraperReady = true;
  return scraper;
}

async function handleTwitterViaBrowser(action: string, args: Record<string, unknown>): Promise<string> {
  const page = await getTwitterBrowserPage();

  switch (action) {
    case 'post_tweet': {
      const text = args['text'] as string;
      if (!text) return JSON.stringify({ error: 'text is required' });
      if (text.length > 280) return JSON.stringify({ error: `Tweet too long (${text.length}/280)` });

      await page.goto('https://x.com/compose/post', { waitUntil: 'networkidle2', timeout: 15000 });
      await humanDelay();

      // Type into the compose box
      const editor = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });
      if (!editor) throw new Error('Could not find tweet compose box');
      await editor.click();
      await page.keyboard.type(text, { delay: 30 });
      await humanDelay();

      // Click Post button
      const postBtn = await page.$('[data-testid="tweetButton"]');
      if (!postBtn) throw new Error('Could not find Post button');
      await postBtn.click();
      await new Promise(r => setTimeout(r, 3000));

      log(`twitter_ops: posted tweet via browser`);
      return JSON.stringify({ posted: true, text, strategy: 'browser' });
    }

    case 'search': {
      const query = args['query'] as string;
      if (!query) return JSON.stringify({ error: 'query is required' });
      const max = Math.min((args['max_results'] as number) || 10, 20);

      await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&f=live`, { waitUntil: 'networkidle2', timeout: 15000 });
      await humanDelay();

      // Extract tweet content from the page
      const tweets = await page.evaluate((limit: number) => {
        const results: Array<{ text: string; username: string }> = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        for (const article of articles) {
          if (results.length >= limit) break;
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const userEl = article.querySelector('a[role="link"][href*="/"]');
          results.push({
            text: textEl?.textContent || '',
            username: userEl?.getAttribute('href')?.replace('/', '') || '',
          });
        }
        return results;
      }, max);

      return JSON.stringify({ count: tweets.length, tweets, strategy: 'browser' });
    }

    case 'get_profile': {
      const username = (args['username'] as string) || process.env['TWITTER_USERNAME'] || '';
      if (!username) return JSON.stringify({ error: 'username required' });

      await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await humanDelay();

      const profile = await page.evaluate(() => {
        const name = document.querySelector('[data-testid="UserName"]')?.textContent || '';
        const bio = document.querySelector('[data-testid="UserDescription"]')?.textContent || '';
        const followers = document.querySelector('a[href*="/followers"] span')?.textContent || '';
        const following = document.querySelector('a[href*="/following"] span')?.textContent || '';
        return { name, bio, followers, following };
      });

      return JSON.stringify({ ...profile, username, strategy: 'browser' });
    }

    default:
      throw new Error(`Browser strategy doesn't support action: ${action}`);
  }
}

async function handleTwitterOps(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;
  if (!action) return JSON.stringify({ error: 'action is required' });

  const strategy = detectTwitterStrategy();

  // OAuth strategy — use the official API (twitter-ops.ts in forge handles this)
  if (strategy === 'oauth' && (action === 'post_tweet' || action === 'reply')) {
    // Delegate to forge's OAuth twitter tool
    try {
      const forgeUrl = process.env['FORGE_URL'] || 'http://forge:3005';
      const forgeKey = process.env['FORGE_API_KEY'] || '';
      const res = await fetch(`${forgeUrl}/api/v1/tools/twitter_ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': forgeKey },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return await res.text();
    } catch { /* fall through to browser */ }
  }

  // Browser strategy — use the browser bridge
  if (strategy === 'browser' || strategy === 'oauth') {
    try {
      return await handleTwitterViaBrowser(action, args);
    } catch (browserErr) {
      log(`twitter_ops: browser strategy failed: ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`);
      // Fall through to legacy scraper
    }
  }

  // Legacy scraper fallback
  try {
    const scraper = await getScraperFallback() as {
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

// ============================================
// browser_use — Headless browser control via Puppeteer
// ============================================

let browserInstance: import('puppeteer-core').Browser | null = null;
let activePage: import('puppeteer-core').Page | null = null;

async function getBrowser(): Promise<import('puppeteer-core').Browser> {
  if (browserInstance?.connected) return browserInstance;
  const puppeteer = await import('puppeteer-core');

  // Strategy 1: Connect to remote browser container via CDP (preferred — works everywhere)
  const browserWsUrl = process.env['BROWSER_WS_URL'] || process.env['BROWSER_CDP_URL'];
  const browserHost = process.env['BROWSER_HOST'] || 'browser';
  const browserPort = process.env['BROWSER_PORT'] || '9222';

  if (browserWsUrl) {
    // Direct WebSocket URL provided
    try {
      browserInstance = await puppeteer.default.connect({ browserWSEndpoint: browserWsUrl });
      log(`browser_use: connected to remote browser at ${browserWsUrl}`);
      return browserInstance;
    } catch (err) {
      log(`browser_use: failed to connect to ${browserWsUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Try discovering the WebSocket URL from the CDP endpoint
  try {
    const cdpUrl = `http://${browserHost}:${browserPort}`;
    // Chromium validates Host header — must be 127.0.0.1 or localhost
    const res = await fetch(`${cdpUrl}/json/version`, {
      headers: { Host: `127.0.0.1:${browserPort}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as { webSocketDebuggerUrl?: string };
      if (data.webSocketDebuggerUrl) {
        // Replace localhost with the actual container host for Docker networking
        const wsUrl = data.webSocketDebuggerUrl
          .replace('ws://127.0.0.1:', `ws://${browserHost}:`)
          .replace('ws://localhost:', `ws://${browserHost}:`);
        browserInstance = await puppeteer.default.connect({ browserWSEndpoint: wsUrl });
        log(`browser_use: connected to remote browser at ${wsUrl}`);
        return browserInstance;
      }
    }
  } catch {
    log('browser_use: remote browser container not available, trying local launch');
  }

  // Strategy 2: Launch locally (fallback for standalone/dev)
  const execPaths = [
    process.env['CHROME_PATH'],
    process.env['PUPPETEER_EXECUTABLE_PATH'],
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean) as string[];

  for (const execPath of execPaths) {
    try {
      browserInstance = await puppeteer.default.launch({
        headless: true,
        executablePath: execPath,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-gpu', '--disable-software-rasterizer',
          '--disable-crash-reporter', '--disable-extensions', '--disable-background-networking',
          '--no-first-run', '--no-zygote', '--single-process',
          '--disable-features=VizDisplayCompositor',
        ],
        timeout: 15000,
      });
      log(`browser_use: launched Chrome from ${execPath}`);
      return browserInstance;
    } catch (err) {
      log(`browser_use: failed to launch from ${execPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error('No browser available. Either start the browser container (docker compose up browser) or set CHROME_PATH.');
}

async function getPage(): Promise<import('puppeteer-core').Page> {
  if (activePage && !activePage.isClosed()) return activePage;
  const browser = await getBrowser();
  activePage = await browser.newPage();
  await activePage.setViewport({ width: 1280, height: 800 });
  await activePage.setUserAgent('AskAlf/2.4.0 Browser Bridge');
  return activePage;
}

async function handleBrowserUse(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`browser_use: ${action}`);

  try {
    switch (action) {
      case 'navigate': {
        const url = String(args['url'] ?? '');
        if (!url) return JSON.stringify({ error: 'url required for navigate' });
        const page = await getPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        if (args['wait_for']) {
          await page.waitForSelector(String(args['wait_for']), { timeout: 10000 }).catch(() => {});
        }
        const title = await page.title();
        const pageUrl = page.url();
        return JSON.stringify({ success: true, title, url: pageUrl });
      }

      case 'screenshot': {
        const page = await getPage();
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png', fullPage: false });
        return JSON.stringify({ success: true, screenshot: `data:image/png;base64,${screenshot}`, width: 1280, height: 800 });
      }

      case 'click': {
        const selector = String(args['selector'] ?? '');
        if (!selector) return JSON.stringify({ error: 'selector required for click' });
        const page = await getPage();
        await page.click(selector);
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify({ success: true, clicked: selector });
      }

      case 'type': {
        const selector = String(args['selector'] ?? '');
        const text = String(args['text'] ?? '');
        if (!selector || !text) return JSON.stringify({ error: 'selector and text required for type' });
        const page = await getPage();
        await page.click(selector);
        await page.type(selector, text, { delay: 50 });
        return JSON.stringify({ success: true, typed: text.length + ' chars into ' + selector });
      }

      case 'extract': {
        const selector = String(args['selector'] ?? 'body');
        const page = await getPage();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = await page.$eval(selector, (el: any) => el.textContent?.trim() ?? '').catch(() => '');
        return JSON.stringify({ success: true, text: text.slice(0, 5000), length: text.length });
      }

      case 'evaluate': {
        const script = String(args['script'] ?? '');
        if (!script) return JSON.stringify({ error: 'script required for evaluate' });
        const page = await getPage();
        const result = await page.evaluate(script).catch((e: Error) => `Error: ${e.message}`);
        return JSON.stringify({ success: true, result: String(result).slice(0, 5000) });
      }

      case 'get_page_info': {
        const page = await getPage();
        const title = await page.title();
        const url = page.url();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const links = await page.$$eval('a[href]', (els: any[]) => els.slice(0, 20).map((e: any) => ({ text: e.textContent?.trim(), href: e.href }))).catch(() => []);
        const forms = await page.$$eval('form', (els: any[]) => els.length).catch(() => 0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputs = await page.$$eval('input, textarea, select', (els: any[]) => els.map((e: any) => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id })).slice(0, 20)).catch(() => []);
        return JSON.stringify({ title, url, links, forms, inputs });
      }

      case 'close': {
        if (activePage && !activePage.isClosed()) await activePage.close();
        activePage = null;
        if (browserInstance?.connected) await browserInstance.close();
        browserInstance = null;
        return JSON.stringify({ success: true, message: 'Browser closed' });
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}. Valid: navigate, screenshot, click, type, extract, evaluate, get_page_info, close` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Browser operation failed' });
  }
}
