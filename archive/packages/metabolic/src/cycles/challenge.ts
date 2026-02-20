/**
 * Challenge Loop (Layer 2)
 *
 * Nightly job that verifies shards across 3 phases:
 *
 * Phase 1: Re-verify expired temporal shards (existing behavior)
 *   - Find temporal shards past their expires_at
 *   - LLM fact-check → re-verify with new TTL or archive
 *
 * Phase 2: Initial verification of unverified temporal shards
 *   - Find temporal shards that were never verified
 *   - Same LLM fact-check as Phase 1
 *   - Verified → set TTL; Failed → archive
 *
 * Phase 3: Execution-based verification of procedural shards
 *   - Find procedural shards with high success rates (10+ runs, 90%+ success)
 *   - No LLM call — execution data IS the verification
 *   - Mark as verified (no expiry — procedural shards don't expire)
 */

import { procedural } from '@substrate/memory';
import { complete } from '@substrate/ai';
import { publishEvent, Streams } from '@substrate/events';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'challenge' });

export interface ChallengeConfig {
  maxShardsPerRun: number;
  verificationModel: string;
  defaultTtlDays: number;
  maxTokens: number;
  maxInitialVerifyPerRun: number;
  maxExecutionVerifyPerRun: number;
  minExecutionsForVerify: number;
  minSuccessRate: number;
}

const DEFAULT_CHALLENGE_CONFIG: ChallengeConfig = {
  maxShardsPerRun: 25,
  verificationModel: 'claude-haiku-4-5',
  defaultTtlDays: 30,
  maxTokens: 512,
  maxInitialVerifyPerRun: 15,
  maxExecutionVerifyPerRun: 25,
  minExecutionsForVerify: 10,
  minSuccessRate: 0.9,
};

export interface ChallengeResult {
  checked: number;
  verified: number;
  failed: number;
  errors: number;
  initialVerified: number;
  executionVerified: number;
}

/**
 * Run the challenge loop cycle (all 3 phases)
 */
export async function runChallengeCycle(
  config: Partial<ChallengeConfig> = {}
): Promise<ChallengeResult> {
  const cfg = { ...DEFAULT_CHALLENGE_CONFIG, ...config };

  logger.info({ config: cfg }, 'Starting challenge cycle');

  const result: ChallengeResult = {
    checked: 0,
    verified: 0,
    failed: 0,
    errors: 0,
    initialVerified: 0,
    executionVerified: 0,
  };

  // ── Phase 1: Re-verify expired temporal shards ──
  await runPhase1ExpiredTemporalVerification(cfg, result);

  // ── Phase 2: Initial verification of unverified temporal shards ──
  await runPhase2InitialTemporalVerification(cfg, result);

  // ── Phase 3: Execution-based verification of procedural shards ──
  await runPhase3ExecutionVerification(cfg, result);

  logger.info({
    checked: result.checked,
    verified: result.verified,
    failed: result.failed,
    errors: result.errors,
    initialVerified: result.initialVerified,
    executionVerified: result.executionVerified,
  }, 'Challenge cycle complete');

  return result;
}

/**
 * Phase 1: Re-verify expired temporal shards via LLM fact-check
 */
async function runPhase1ExpiredTemporalVerification(
  cfg: ChallengeConfig,
  result: ChallengeResult
): Promise<void> {
  const expiredShards = await procedural.findExpiredShards(cfg.maxShardsPerRun);

  if (expiredShards.length === 0) {
    logger.info('Phase 1: No expired shards to challenge');
    return;
  }

  logger.info({ count: expiredShards.length }, 'Phase 1: Found expired shards to challenge');

  for (const shard of expiredShards) {
    await verifyShard(shard, cfg, result, 'phase1-expired');
  }
}

/**
 * Phase 2: Initial verification of unverified temporal shards via LLM fact-check
 */
async function runPhase2InitialTemporalVerification(
  cfg: ChallengeConfig,
  result: ChallengeResult
): Promise<void> {
  const unverifiedShards = await procedural.findUnverifiedShards(cfg.maxInitialVerifyPerRun);

  // Filter to only temporal shards (procedural handled in phase 3)
  const temporalShards = unverifiedShards.filter(s => s.knowledgeType === 'temporal');

  if (temporalShards.length === 0) {
    logger.info('Phase 2: No unverified temporal shards to verify');
    return;
  }

  logger.info({ count: temporalShards.length }, 'Phase 2: Found unverified temporal shards');

  for (const shard of temporalShards) {
    const verified = await verifyShard(shard, cfg, result, 'phase2-initial');
    if (verified) {
      result.initialVerified++;
    }
  }
}

/**
 * Phase 3: Execution-based verification of procedural shards
 * No LLM call — execution data IS the verification.
 */
async function runPhase3ExecutionVerification(
  cfg: ChallengeConfig,
  result: ChallengeResult
): Promise<void> {
  const verifiableShards = await procedural.findExecutionVerifiableShards(
    cfg.maxExecutionVerifyPerRun,
    cfg.minExecutionsForVerify,
    cfg.minSuccessRate
  );

  if (verifiableShards.length === 0) {
    logger.info('Phase 3: No procedural shards eligible for execution-based verification');
    return;
  }

  logger.info({ count: verifiableShards.length }, 'Phase 3: Found procedural shards for execution-based verification');

  for (const shard of verifiableShards) {
    try {
      // No LLM needed — the execution history proves the shard works
      await procedural.updateVerificationStatus(shard.id, 'verified');
      result.executionVerified++;
      result.checked++;
      result.verified++;

      const successRate = shard.executionCount > 0
        ? (shard.successCount / shard.executionCount * 100).toFixed(1)
        : '0';

      logger.info({
        shardId: shard.id,
        name: shard.name,
        executionCount: shard.executionCount,
        successRate: `${successRate}%`,
      }, 'Phase 3: Procedural shard verified via execution history');

    } catch (err) {
      result.errors++;
      logger.error({
        shardId: shard.id,
        name: shard.name,
        error: err instanceof Error ? err.message : String(err),
      }, 'Phase 3: Execution verification failed with error');
    }
  }
}

/**
 * Verify a single shard via LLM fact-check (used by Phase 1 and Phase 2)
 * Returns true if verified, false otherwise.
 */
async function verifyShard(
  shard: { id: string; name: string; logic: string; patterns: string[]; intentTemplate?: string | undefined; sourceUrl?: string | undefined; verificationCount: number },
  cfg: ChallengeConfig,
  result: ChallengeResult,
  phase: string
): Promise<boolean> {
  try {
    // Mark as challenged (prevents other processes from picking it up)
    await procedural.updateVerificationStatus(shard.id, 'challenged');
    result.checked++;

    // Build verification prompt from the shard's logic output
    const verificationPrompt = buildVerificationPrompt(shard);

    // Call cheap model to verify
    const response = await complete(verificationPrompt, {
      model: cfg.verificationModel,
      maxTokens: cfg.maxTokens,
      temperature: 0,
      systemPrompt: 'You are a fact-checker. Answer ONLY with "VERIFIED" if the claim is still accurate, or "FAILED" followed by a brief reason if the claim is outdated or incorrect. Be strict — if you are unsure, answer "FAILED: uncertain".',
    });

    const normalized = response.trim().toUpperCase();

    if (normalized.startsWith('VERIFIED')) {
      // Verified — set new TTL
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + cfg.defaultTtlDays);

      await procedural.updateVerificationStatus(shard.id, 'verified', newExpiry);
      result.verified++;

      logger.info({
        shardId: shard.id,
        name: shard.name,
        phase,
        newExpiry: newExpiry.toISOString(),
        verificationCount: shard.verificationCount + 1,
      }, 'Shard verified, TTL set');

      return true;

    } else {
      // Failed verification
      await procedural.updateVerificationStatus(shard.id, 'failed');
      result.failed++;

      const failReason = normalized.replace(/^FAILED[:\s]*/, '') || 'unknown';

      await publishEvent(Streams.SHARDS, {
        type: 'shard.verification_failed',
        source: 'challenge',
        payload: {
          shardId: shard.id,
          name: shard.name,
          phase,
          reason: failReason,
          previousVerifications: shard.verificationCount,
        },
      });

      logger.warn({
        shardId: shard.id,
        name: shard.name,
        phase,
        reason: failReason,
      }, 'Shard failed verification, archived');

      return false;
    }

  } catch (err) {
    result.errors++;
    try {
      // On error, revert to previous state so it can be retried
      await procedural.updateVerificationStatus(shard.id, 'expired');
    } catch {
      // Best effort
    }

    logger.error({
      shardId: shard.id,
      name: shard.name,
      phase,
      error: err instanceof Error ? err.message : String(err),
    }, 'Challenge verification failed with error');

    return false;
  }
}

/**
 * Build a verification prompt from a shard's content
 */
function buildVerificationPrompt(shard: {
  name: string;
  logic: string;
  patterns: string[];
  intentTemplate?: string | undefined;
  sourceUrl?: string | undefined;
}): string {
  // Extract the core claim from the shard's logic
  // Most shards have their output as a string in the logic
  const outputMatch = shard.logic.match(/(?:output|result|answer|response)\s*[:=]\s*["`'](.+?)["`']/i)
    || shard.logic.match(/return\s+["`'](.+?)["`']/i)
    || shard.logic.match(/["'`]([^"'`]{20,}?)["'`]/);

  const claim = outputMatch?.[1] || shard.logic.slice(0, 500);
  const context = shard.intentTemplate || shard.patterns.join(', ') || shard.name;

  let prompt = `Verify this knowledge claim is still accurate as of today:\n\n`;
  prompt += `Topic: ${context}\n`;
  prompt += `Claim: ${claim}\n`;

  if (shard.sourceUrl) {
    prompt += `Original source: ${shard.sourceUrl}\n`;
  }

  prompt += `\nIs this claim still accurate? Answer VERIFIED or FAILED with reason.`;

  return prompt;
}
