/**
 * Built-in Tool: API Call
 * Generic REST API caller supporting GET, POST, PUT, DELETE with configurable headers and body.
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface ApiCallInput {
  url: string;
  method: string;
  headers?: Record<string, string> | undefined;
  body?: unknown | undefined;
}

// ============================================
// Implementation
// ============================================

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 1_048_576; // 1MB

/**
 * Make an HTTP request to an external API.
 *
 * - Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
 * - 30-second timeout
 * - Returns response body and status
 * - Handles JSON and text responses
 */
export async function apiCall(input: ApiCallInput): Promise<ToolResult> {
  const startTime = performance.now();
  const method = input.method.toUpperCase();

  // Validate method
  if (!ALLOWED_METHODS.has(method)) {
    return {
      output: null,
      error: `Unsupported HTTP method: ${input.method}. Allowed: ${Array.from(ALLOWED_METHODS).join(', ')}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

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

  // Build request headers
  const requestHeaders: Record<string, string> = {
    'User-Agent': 'AgentForge/1.0 (api-call tool)',
    ...input.headers,
  };

  // Build request options
  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
    redirect: 'follow',
  };

  // Add body for methods that support it
  if (input.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    if (typeof input.body === 'string') {
      fetchOptions.body = input.body;
    } else {
      fetchOptions.body = JSON.stringify(input.body);
      // Set content-type if not already specified
      if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }
  }

  // Execute with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  fetchOptions.signal = controller.signal;

  try {
    let response: Response;
    try {
      response = await fetch(input.url, fetchOptions);
    } finally {
      clearTimeout(timer);
    }

    // Read response body
    const contentType = response.headers.get('content-type') ?? '';
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;

    if (method === 'HEAD') {
      responseBody = null;
    } else if (contentType.includes('application/json')) {
      try {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE) {
          responseBody = text.slice(0, MAX_RESPONSE_SIZE);
        } else {
          responseBody = JSON.parse(text) as unknown;
        }
      } catch {
        responseBody = await response.text();
      }
    } else {
      const text = await response.text();
      responseBody = text.length > MAX_RESPONSE_SIZE
        ? text.slice(0, MAX_RESPONSE_SIZE)
        : text;
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      output: {
        statusCode: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        url: response.url,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        output: null,
        error: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        durationMs,
      };
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      output: null,
      error: `API call failed: ${errorMessage}`,
      durationMs,
    };
  }
}
