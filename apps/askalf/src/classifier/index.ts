/**
 * Rule-Based Prompt Classifier
 * Analyzes user prompts and routes to the best provider.
 * Phase 1: keyword matching. Phase 2: could use a small model.
 */

import type { ProviderChoice } from '../providers/types.js';

const CODE_KEYWORDS = [
  'code', 'debug', 'function', 'error', 'bug', 'refactor', 'typescript', 'javascript',
  'python', 'rust', 'go', 'java', 'sql', 'api', 'endpoint', 'database', 'schema',
  'migration', 'test', 'unit test', 'dockerfile', 'docker', 'nginx', 'deploy',
  'compile', 'build', 'lint', 'regex', 'algorithm', 'data structure', 'class',
  'interface', 'type', 'import', 'export', 'async', 'await', 'promise',
  'git', 'commit', 'merge', 'branch', 'pull request', 'ci', 'cd',
  'html', 'css', 'react', 'node', 'express', 'fastify', 'next',
  'fix', 'implement', 'optimize', 'performance', 'memory leak', 'stack trace',
];

const CREATIVE_KEYWORDS = [
  'write', 'story', 'poem', 'creative', 'brainstorm', 'imagine', 'fiction',
  'essay', 'blog', 'article', 'copy', 'slogan', 'tagline', 'marketing',
  'narrative', 'character', 'plot', 'dialogue', 'script', 'screenplay',
  'song', 'lyrics', 'metaphor', 'analogy', 'describe', 'paint a picture',
  'compose', 'draft', 'rewrite', 'tone', 'voice', 'style',
];

/**
 * Classify a prompt and return the recommended provider.
 * Returns claude for code/technical, openai for creative, claude as default.
 */
export function classifyPrompt(prompt: string, defaultProvider?: string, defaultModel?: string): ProviderChoice {
  const lower = prompt.toLowerCase();

  let codeScore = 0;
  let creativeScore = 0;

  for (const kw of CODE_KEYWORDS) {
    if (lower.includes(kw)) codeScore++;
  }

  for (const kw of CREATIVE_KEYWORDS) {
    if (lower.includes(kw)) creativeScore++;
  }

  // If user has a default preference and scores are tied, use their preference
  if (codeScore === 0 && creativeScore === 0 && defaultProvider && defaultProvider !== 'auto') {
    return {
      provider: defaultProvider,
      model: defaultModel || (defaultProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-5-20250929'),
      classified: true,
    };
  }

  if (creativeScore > codeScore) {
    return {
      provider: 'openai',
      model: 'gpt-4o',
      classified: true,
    };
  }

  // Default: Claude for code, technical, and general queries
  return {
    provider: 'claude',
    model: 'claude-sonnet-4-5-20250929',
    classified: true,
  };
}
