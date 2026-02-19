/**
 * Built-in Tool: Web Search
 * Searches the web via SearXNG (self-hosted meta search engine).
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
// Config
// ============================================

const SEARXNG_URL = process.env['SEARXNG_URL'] ?? 'http://searxng:8080';
const SEARCH_TIMEOUT_MS = 10_000;

// ============================================
// Implementation
// ============================================

export async function webSearch(input: WebSearchInput): Promise<ToolResult> {
  const startTime = performance.now();
  const maxResults = Math.min(input.maxResults ?? 5, 10);

  if (!input.query.trim()) {
    return {
      output: null,
      error: 'Search query cannot be empty',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const params = new URLSearchParams({
    q: input.query,
    format: 'json',
    pageno: '1',
  });
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
      return {
        output: null,
        error: `SearXNG returned HTTP ${response.status}: ${body.slice(0, 200)}`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const data = await response.json() as { results?: { title: string; url: string; content?: string }[] };
    const results: WebSearchResult[] = (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? '',
    }));

    return {
      output: { query: input.query, results, total: results.length },
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    if (err instanceof Error && err.name === 'AbortError') {
      return { output: null, error: `Search timed out after ${SEARCH_TIMEOUT_MS}ms`, durationMs };
    }
    return { output: null, error: `Web search failed: ${err instanceof Error ? err.message : String(err)}`, durationMs };
  } finally {
    clearTimeout(timer);
  }
}
