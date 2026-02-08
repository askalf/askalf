/**
 * Built-in Tool: Web Browse
 * Fetches a URL and extracts text content, optionally filtered by CSS selector.
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface WebBrowseInput {
  url: string;
  selector?: string | undefined;
  maxLength?: number | undefined;
}

// ============================================
// Implementation
// ============================================

const DEFAULT_MAX_LENGTH = 5000;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a URL and extract its text content.
 * Optionally filters content by a CSS-like selector (basic heading/tag extraction).
 * Truncates output to maxLength characters.
 */
export async function webBrowse(input: WebBrowseInput): Promise<ToolResult> {
  const startTime = performance.now();
  const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH;

  try {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      return {
        output: null,
        error: `Invalid URL: ${input.url}`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Only allow http and https
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        output: null,
        error: `Unsupported protocol: ${parsedUrl.protocol} (only http and https are allowed)`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Fetch with timeout using AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(input.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'AgentForge/1.0 (web-browse tool)',
          'Accept': 'text/html, application/xhtml+xml, text/plain, */*',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        output: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const rawBody = await response.text();

    // Extract text content based on content type
    let textContent: string;

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      textContent = extractTextFromHtml(rawBody, input.selector);
    } else if (contentType.includes('application/json')) {
      // For JSON, pretty-print it
      try {
        const parsed = JSON.parse(rawBody) as unknown;
        textContent = JSON.stringify(parsed, null, 2);
      } catch {
        textContent = rawBody;
      }
    } else {
      // Plain text or other formats
      textContent = rawBody;
    }

    // Truncate to max length
    const truncated = textContent.length > maxLength;
    const output = truncated ? textContent.slice(0, maxLength) : textContent;

    const durationMs = Math.round(performance.now() - startTime);

    return {
      output: {
        url: input.url,
        statusCode: response.status,
        contentType,
        content: output,
        truncated,
        originalLength: textContent.length,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        output: null,
        error: `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
        durationMs,
      };
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      output: null,
      error: `Failed to fetch URL: ${errorMessage}`,
      durationMs,
    };
  }
}

// ============================================
// HTML Text Extraction
// ============================================

/**
 * Basic HTML-to-text extraction.
 * Strips tags, decodes entities, collapses whitespace.
 * If a selector is provided, attempts basic tag-based extraction.
 */
function extractTextFromHtml(html: string, selector?: string | undefined): string {
  let content = html;

  // If a selector is provided, try to extract that specific tag's content
  if (selector) {
    const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch) {
      const tag = tagMatch[1] as string;
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const matchContent = match[1];
        if (matchContent != null) {
          matches.push(matchContent);
        }
      }
      if (matches.length > 0) {
        content = matches.join('\n\n');
      }
    }
  }

  // Remove script and style blocks
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Convert common block elements to newlines
  content = content.replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, '\n');

  // Convert list items to bullet points
  content = content.replace(/<li[^>]*>/gi, '\n- ');

  // Strip all remaining HTML tags
  content = content.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&#x27;/g, "'");
  content = content.replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  content = content.trim();

  return content;
}
