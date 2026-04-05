/**
 * Universal AI Provider
 *
 * Priority chain: Anthropic API → OpenAI API → Ollama → CLI OAuth
 * All routes should use this instead of hardcoding a provider.
 */

export interface UniversalCompletionRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  model?: string; // override auto-selection
  maxTokens?: number;
}

export interface UniversalCompletionResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Detect which providers are available based on environment.
 */
export function getAvailableProviders(): string[] {
  const providers: string[] = [];
  if (process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK']) providers.push('anthropic');
  if (process.env['OPENAI_API_KEY']) providers.push('openai');
  // Ollama always attempted as fallback
  providers.push('ollama');
  return providers;
}

/**
 * Call the best available AI provider.
 * Falls through the chain until one succeeds.
 */
export async function universalComplete(req: UniversalCompletionRequest): Promise<UniversalCompletionResponse> {
  const maxTokens = req.maxTokens ?? 1024;

  // 1. Anthropic API
  const anthropicKey = process.env['ANTHROPIC_INTENT_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];
  if (anthropicKey) {
    try {
      const model = req.model || 'claude-haiku-4-5';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: req.system, messages: req.messages }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as { content: { text: string }[]; model: string; usage?: { input_tokens: number; output_tokens: number } };
        return {
          text: data.content.filter(b => b.text).map(b => b.text).join(''),
          model: data.model || model,
          provider: 'anthropic',
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
        };
      }
    } catch { /* fall through */ }
  }

  // 2. OpenAI API (or any OpenAI-compatible: DeepSeek, Together, Groq, etc.)
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    try {
      const baseUrl = process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1';
      const model = req.model || process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: { message: { content: string } }[]; model: string; usage?: { prompt_tokens: number; completion_tokens: number } };
        return {
          text: data.choices[0]?.message?.content || '',
          model: data.model || model,
          provider: 'openai',
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
        };
      }
    } catch { /* fall through */ }
  }

  // 3. Google Gemini
  const googleKey = process.env['GOOGLE_API_KEY'];
  if (googleKey) {
    try {
      const model = req.model || process.env['GOOGLE_MODEL'] || 'gemini-2.0-flash';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: req.system }] },
          contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
        return {
          text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
          model,
          provider: 'google',
        };
      }
    } catch { /* fall through */ }
  }

  // 4. Ollama (local)
  const ollamaUrl = process.env['OLLAMA_URL'] || process.env['OLLAMA_BASE_URL'] || 'http://ollama:11434';
  try {
    const model = req.model || process.env['OLLAMA_MODEL'] || 'llama3.2';
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = await res.json() as { message?: { content: string }; model?: string };
      return {
        text: data.message?.content || '',
        model: data.model || model,
        provider: 'ollama',
      };
    }
  } catch { /* fall through */ }

  throw new Error('No AI provider available. Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or OLLAMA_URL.');
}
