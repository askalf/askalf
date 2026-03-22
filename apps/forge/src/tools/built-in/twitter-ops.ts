/**
 * Built-in Tool: Twitter/X Operations
 * Post tweets, threads, reply, search, and analyze engagement via Twitter API v2.
 * Requires Twitter integration credentials (api_key, api_secret, access_token, access_token_secret, bearer_token).
 */

import type { ToolResult } from '../registry.js';
import { createHmac, randomBytes } from 'crypto';

// ============================================
// Types
// ============================================

type TwitterAction = 'post_tweet' | 'post_thread' | 'reply' | 'search' | 'get_mentions' | 'get_profile' | 'delete_tweet' | 'like' | 'retweet';

export interface TwitterOpsInput {
  action: TwitterAction;
  // post_tweet / reply
  text?: string;
  reply_to_id?: string;
  // post_thread
  thread?: string[];
  // search
  query?: string;
  max_results?: number;
  // delete / like / retweet
  tweet_id?: string;
  // get_profile
  username?: string;
}

interface TwitterCredentials {
  api_key: string;
  api_secret: string;
  access_token: string;
  access_token_secret: string;
  bearer_token: string;
}

// ============================================
// OAuth 1.0a Signature (required for write operations)
// ============================================

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const sortedParams = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const paramString = sortedParams.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join('&');
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildOAuthHeader(
  method: string,
  url: string,
  creds: TwitterCredentials,
  extraParams: Record<string, string> = {},
): string {
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.api_key,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.access_token,
    oauth_version: '1.0',
    ...extraParams,
  };

  const signature = generateOAuthSignature(method, url, oauthParams, creds.api_secret, creds.access_token_secret);
  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.entries(oauthParams)
    .filter(([k]) => k.startsWith('oauth_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ============================================
// Credential Resolution
// ============================================

async function getCredentials(): Promise<TwitterCredentials> {
  // Check .env first
  const envCreds: TwitterCredentials = {
    api_key: process.env['TWITTER_API_KEY'] || '',
    api_secret: process.env['TWITTER_API_SECRET'] || '',
    access_token: process.env['TWITTER_ACCESS_TOKEN'] || '',
    access_token_secret: process.env['TWITTER_ACCESS_TOKEN_SECRET'] || '',
    bearer_token: process.env['TWITTER_BEARER_TOKEN'] || '',
  };

  if (envCreds.api_key && envCreds.access_token) return envCreds;

  // Fall back to integration config from DB
  try {
    const { queryOne } = await import('../../database.js');
    const { decryptConfigFields } = await import('../../channels/crypto.js');

    const row = await queryOne<{ config: Record<string, unknown> }>(
      `SELECT config FROM user_integrations WHERE provider = 'twitter' AND status = 'active' LIMIT 1`,
    );

    if (row?.config) {
      const decrypted = decryptConfigFields(
        row.config,
        ['api_secret', 'bearer_token', 'access_token_secret'],
      );
      return {
        api_key: (decrypted['api_key'] as string) || '',
        api_secret: (decrypted['api_secret'] as string) || '',
        access_token: (decrypted['access_token'] as string) || '',
        access_token_secret: (decrypted['access_token_secret'] as string) || '',
        bearer_token: (decrypted['bearer_token'] as string) || '',
      };
    }
  } catch { /* DB not available */ }

  throw new Error('Twitter credentials not configured. Add them in Settings > Integrations > X/Twitter or set TWITTER_* env vars.');
}

// ============================================
// API Calls
// ============================================

const API_V2 = 'https://api.twitter.com/2';

async function postTweet(creds: TwitterCredentials, text: string, replyToId?: string): Promise<{ id: string; text: string }> {
  const url = `${API_V2}/tweets`;
  const body: Record<string, unknown> = { text };
  if (replyToId) body['reply'] = { in_reply_to_tweet_id: replyToId };

  const auth = buildOAuthHeader('POST', url, creds);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`Twitter API ${res.status}: ${err}`);
  }

  const data = await res.json() as { data: { id: string; text: string } };
  return data.data;
}

async function searchTweets(creds: TwitterCredentials, query: string, maxResults: number): Promise<Array<{ id: string; text: string; author_id: string }>> {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(maxResults, 100)),
    'tweet.fields': 'created_at,public_metrics,author_id',
  });

  const res = await fetch(`${API_V2}/tweets/search/recent?${params}`, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`Twitter search ${res.status}: ${err}`);
  }

  const data = await res.json() as { data?: Array<{ id: string; text: string; author_id: string }> };
  return data.data || [];
}

async function getMentions(creds: TwitterCredentials, maxResults: number): Promise<Array<{ id: string; text: string; author_id: string }>> {
  // First get our user ID
  const meRes = await fetch(`${API_V2}/users/me`, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) throw new Error('Failed to get user info');
  const me = await meRes.json() as { data: { id: string } };

  const params = new URLSearchParams({
    max_results: String(Math.min(maxResults, 100)),
    'tweet.fields': 'created_at,public_metrics,author_id',
  });

  const res = await fetch(`${API_V2}/users/${me.data.id}/mentions?${params}`, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Mentions API ${res.status}`);
  const data = await res.json() as { data?: Array<{ id: string; text: string; author_id: string }> };
  return data.data || [];
}

async function getProfile(creds: TwitterCredentials, username?: string): Promise<Record<string, unknown>> {
  const endpoint = username
    ? `${API_V2}/users/by/username/${username}?user.fields=description,public_metrics,created_at,profile_image_url`
    : `${API_V2}/users/me?user.fields=description,public_metrics,created_at,profile_image_url`;

  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Profile API ${res.status}`);
  const data = await res.json() as { data: Record<string, unknown> };
  return data.data;
}

async function deleteTweet(creds: TwitterCredentials, tweetId: string): Promise<boolean> {
  const url = `${API_V2}/tweets/${tweetId}`;
  const auth = buildOAuthHeader('DELETE', url, creds);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': auth },
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

async function likeTweet(creds: TwitterCredentials, tweetId: string): Promise<boolean> {
  const meRes = await fetch(`${API_V2}/users/me`, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) throw new Error('Failed to get user info');
  const me = await meRes.json() as { data: { id: string } };

  const url = `${API_V2}/users/${me.data.id}/likes`;
  const auth = buildOAuthHeader('POST', url, creds);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tweet_id: tweetId }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

async function retweet(creds: TwitterCredentials, tweetId: string): Promise<boolean> {
  const meRes = await fetch(`${API_V2}/users/me`, {
    headers: { 'Authorization': `Bearer ${creds.bearer_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) throw new Error('Failed to get user info');
  const me = await meRes.json() as { data: { id: string } };

  const url = `${API_V2}/users/${me.data.id}/retweets`;
  const auth = buildOAuthHeader('POST', url, creds);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tweet_id: tweetId }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

// ============================================
// Main Handler
// ============================================

export async function twitterOps(input: TwitterOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    const creds = await getCredentials();

    switch (input.action) {
      case 'post_tweet': {
        if (!input.text) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'text is required for post_tweet' };
        if (input.text.length > 280) return { output: null, durationMs: Math.round(performance.now() - startTime), error: `Tweet too long (${input.text.length}/280 chars)` };
        const tweet = await postTweet(creds, input.text);
        return {
          output: { posted: true, id: tweet.id, text: tweet.text, url: `https://x.com/i/status/${tweet.id}` },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'post_thread': {
        if (!input.thread || input.thread.length === 0) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'thread array is required' };
        const tooLong = input.thread.findIndex(t => t.length > 280);
        if (tooLong >= 0) return { output: null, durationMs: Math.round(performance.now() - startTime), error: `Tweet ${tooLong + 1} is too long (${input.thread[tooLong]!.length}/280 chars)` };

        const results: Array<{ id: string; text: string }> = [];
        let replyTo: string | undefined;
        for (const text of input.thread) {
          const tweet = await postTweet(creds, text, replyTo);
          results.push(tweet);
          replyTo = tweet.id;
        }
        return {
          output: { posted: true, tweets: results.length, thread: results, url: `https://x.com/i/status/${results[0]!.id}` },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'reply': {
        if (!input.text || !input.reply_to_id) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'text and reply_to_id are required' };
        const tweet = await postTweet(creds, input.text, input.reply_to_id);
        return {
          output: { replied: true, id: tweet.id, text: tweet.text },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'search': {
        if (!input.query) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'query is required for search' };
        const tweets = await searchTweets(creds, input.query, input.max_results ?? 10);
        return {
          output: { count: tweets.length, tweets },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get_mentions': {
        const mentions = await getMentions(creds, input.max_results ?? 20);
        return {
          output: { count: mentions.length, mentions },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get_profile': {
        const profile = await getProfile(creds, input.username);
        return {
          output: profile,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'delete_tweet': {
        if (!input.tweet_id) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'tweet_id is required' };
        const deleted = await deleteTweet(creds, input.tweet_id);
        return { output: { deleted }, durationMs: Math.round(performance.now() - startTime) };
      }

      case 'like': {
        if (!input.tweet_id) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'tweet_id is required' };
        const liked = await likeTweet(creds, input.tweet_id);
        return { output: { liked }, durationMs: Math.round(performance.now() - startTime) };
      }

      case 'retweet': {
        if (!input.tweet_id) return { output: null, durationMs: Math.round(performance.now() - startTime), error: 'tweet_id is required' };
        const retweeted = await retweet(creds, input.tweet_id);
        return { output: { retweeted }, durationMs: Math.round(performance.now() - startTime) };
      }

      default:
        return { output: null, durationMs: Math.round(performance.now() - startTime), error: `Unknown action: ${input.action}. Valid: post_tweet, post_thread, reply, search, get_mentions, get_profile, delete_tweet, like, retweet` };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : 'Twitter operation failed',
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
