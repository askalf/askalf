/**
 * Model Availability Test Script
 *
 * Tests each OpenAI and Anthropic model to verify API connectivity
 * Run with: npx tsx scripts/test-models.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load production env
dotenv.config({ path: resolve(__dirname, '../.env.production') });

const TEST_PROMPT = 'Respond with just the word "OK" and nothing else.';

interface TestResult {
  model: string;
  provider: string;
  apiModelId: string;
  success: boolean;
  responsePreview?: string;
  error?: string;
  latencyMs: number;
}

// Models to test - OpenAI
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini', apiModel: 'gpt-4o-mini' },
  { id: 'gpt-4o', apiModel: 'gpt-4o' },
  { id: 'gpt-4.1', apiModel: 'gpt-4.1' },
  { id: 'gpt-5-mini', apiModel: 'gpt-5-mini' },
  { id: 'gpt-5', apiModel: 'gpt-5' },
  { id: 'o4-mini', apiModel: 'o4-mini' },
  { id: 'o1', apiModel: 'o1' },
  { id: 'o3', apiModel: 'o3' },
  { id: 'o3-pro', apiModel: 'o3-pro' },
];

// Models to test - Anthropic
const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-4-5', apiModel: 'claude-haiku-4-5-20251001' },
  { id: 'claude-sonnet-4', apiModel: 'claude-sonnet-4-20250514' },
  { id: 'claude-sonnet-4-5', apiModel: 'claude-sonnet-4-5-20250929' },
  { id: 'claude-opus-4-5', apiModel: 'claude-opus-4-5-20251101' },
];

async function testOpenAIModel(
  client: OpenAI,
  modelId: string,
  apiModel: string
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Reasoning models (o1, o3, o4) don't support temperature parameter
    const isReasoningModel = apiModel.startsWith('o1') || apiModel.startsWith('o3') || apiModel.startsWith('o4');

    const params: Parameters<typeof client.chat.completions.create>[0] = {
      model: apiModel,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_completion_tokens: 50,
    };

    // Only add temperature for non-reasoning models
    if (!isReasoningModel) {
      params.temperature = 0;
    }

    const response = await client.chat.completions.create(params);

    const content = response.choices[0]?.message?.content ?? '';
    return {
      model: modelId,
      provider: 'openai',
      apiModelId: apiModel,
      success: true,
      responsePreview: content.slice(0, 100),
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      model: modelId,
      provider: 'openai',
      apiModelId: apiModel,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

async function testAnthropicModel(
  client: Anthropic,
  modelId: string,
  apiModel: string
): Promise<TestResult> {
  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: apiModel,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_tokens: 50,
      temperature: 0,
    });

    let content = '';
    if (response.content && response.content.length > 0) {
      const textBlock = response.content.find((c) => c.type === 'text');
      if (textBlock && 'text' in textBlock) {
        content = textBlock.text;
      }
    }

    return {
      model: modelId,
      provider: 'anthropic',
      apiModelId: apiModel,
      success: true,
      responsePreview: content.slice(0, 100),
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      model: modelId,
      provider: 'anthropic',
      apiModelId: apiModel,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('MODEL AVAILABILITY TEST');
  console.log('='.repeat(80));
  console.log();

  const results: TestResult[] = [];

  // Initialize OpenAI
  const openaiKey = process.env['OPENAI_API_KEY'];
  let openaiClient: OpenAI | null = null;
  if (openaiKey) {
    openaiClient = new OpenAI({ apiKey: openaiKey });
    console.log('✓ OpenAI client initialized');
  } else {
    console.log('✗ OpenAI API key not found (OPENAI_API_KEY)');
  }

  // Initialize Anthropic
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  let anthropicClient: Anthropic | null = null;
  if (anthropicKey) {
    anthropicClient = new Anthropic({ apiKey: anthropicKey });
    console.log('✓ Anthropic client initialized');
  } else {
    console.log('✗ Anthropic API key not found (ANTHROPIC_API_KEY)');
  }

  console.log();
  console.log('-'.repeat(80));
  console.log('TESTING OPENAI MODELS');
  console.log('-'.repeat(80));

  if (openaiClient) {
    for (const model of OPENAI_MODELS) {
      process.stdout.write(`  Testing ${model.id} (${model.apiModel})... `);
      const result = await testOpenAIModel(openaiClient, model.id, model.apiModel);
      results.push(result);

      if (result.success) {
        console.log(`✓ OK (${result.latencyMs}ms) - "${result.responsePreview}"`);
      } else {
        console.log(`✗ FAILED - ${result.error?.slice(0, 60)}`);
      }
    }
  } else {
    console.log('  Skipped - no API key');
  }

  console.log();
  console.log('-'.repeat(80));
  console.log('TESTING ANTHROPIC MODELS');
  console.log('-'.repeat(80));

  if (anthropicClient) {
    for (const model of ANTHROPIC_MODELS) {
      process.stdout.write(`  Testing ${model.id} (${model.apiModel})... `);
      const result = await testAnthropicModel(anthropicClient, model.id, model.apiModel);
      results.push(result);

      if (result.success) {
        console.log(`✓ OK (${result.latencyMs}ms) - "${result.responsePreview}"`);
      } else {
        console.log(`✗ FAILED - ${result.error?.slice(0, 60)}`);
      }
    }
  } else {
    console.log('  Skipped - no API key');
  }

  // Summary
  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`Total tested: ${results.length}`);
  console.log(`  ✓ Successful: ${successCount}`);
  console.log(`  ✗ Failed: ${failCount}`);

  if (failCount > 0) {
    console.log();
    console.log('Failed models:');
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.model} (${r.provider}): ${r.error}`);
    }
  }

  console.log();
  console.log('Working models that should be enabled in ModelSelector:');
  for (const r of results.filter((r) => r.success)) {
    console.log(`  - ${r.model} (${r.provider})`);
  }
}

main().catch(console.error);
