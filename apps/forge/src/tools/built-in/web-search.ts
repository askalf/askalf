/**
 * Built-in Tool: Web Search
 * Stub implementation for web search functionality.
 * Interface is ready for future integration with search APIs
 * (e.g., Brave Search, Serper, Tavily, SearXNG).
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface WebSearchInput {
  query: string;
  maxResults?: number | undefined;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ============================================
// Implementation
// ============================================

/**
 * Search the web for information.
 *
 * This is a stub implementation that returns a configuration message.
 * To enable web search, integrate with a search API provider:
 *
 * - Brave Search API: https://api.search.brave.com
 * - Serper API: https://google.serper.dev
 * - Tavily API: https://api.tavily.com
 * - SearXNG: self-hosted meta search
 *
 * Set the appropriate API key in the environment and update this implementation.
 */
export async function webSearch(input: WebSearchInput): Promise<ToolResult> {
  const startTime = performance.now();
  const maxResults = input.maxResults ?? 5;

  if (!input.query.trim()) {
    return {
      output: null,
      error: 'Search query cannot be empty',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // TODO: Integrate with a real search API
  // Example implementation with Brave Search:
  //
  // const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  // if (!apiKey) {
  //   return { output: null, error: 'BRAVE_SEARCH_API_KEY not configured', durationMs: 0 };
  // }
  //
  // const response = await fetch(
  //   `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}&count=${maxResults}`,
  //   { headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' } },
  // );
  //
  // const data = await response.json();
  // const results = data.web.results.map(r => ({
  //   title: r.title,
  //   url: r.url,
  //   snippet: r.description,
  // }));

  const durationMs = Math.round(performance.now() - startTime);

  return {
    output: {
      message: 'Web search requires configuration. No search API provider is currently configured.',
      query: input.query,
      maxResults,
      instructions: [
        'To enable web search, configure one of the following:',
        '1. Set BRAVE_SEARCH_API_KEY for Brave Search',
        '2. Set SERPER_API_KEY for Serper (Google Search)',
        '3. Set TAVILY_API_KEY for Tavily',
        '4. Set SEARXNG_URL for a self-hosted SearXNG instance',
      ],
      results: [] as WebSearchResult[],
    },
    durationMs,
  };
}
