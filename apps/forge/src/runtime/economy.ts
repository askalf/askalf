/**
 * Agent Economy — Wallet operations, bounty marketplace, reputation tracking.
 */

import { query, queryOne, transaction, clientQuery } from '../database.js';
import { ulid } from 'ulid';

// ============================================
// Types
// ============================================

export interface Wallet {
  id: string;
  agent_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  daily_spend_limit: number;
  daily_spent: number;
  daily_reset_at: string;
}

export interface Bounty {
  id: string;
  poster_agent_id: string;
  title: string;
  description: string;
  required_capabilities: string[];
  reward_amount: number;
  status: string;
  assigned_agent_id: string | null;
  execution_id: string | null;
  quality_score: number | null;
}

export interface Reputation {
  id: string;
  agent_id: string;
  reputation_score: number;
  total_completed: number;
  total_failed: number;
  reliability_score: number;
  quality_score: number;
  efficiency_score: number;
}

export interface Transaction {
  id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  amount: number;
  transaction_type: string;
  execution_id: string | null;
  bounty_id: string | null;
  description: string | null;
  created_at: string;
}

// ============================================
// Wallet Operations
// ============================================

/**
 * Get or create a wallet for an agent.
 */
export async function getOrCreateWallet(agentId: string): Promise<Wallet> {
  const existing = await queryOne<Wallet>(
    `SELECT * FROM forge_agent_wallets WHERE agent_id = $1`,
    [agentId],
  );
  if (existing) {
    // Reset daily spending if past reset time
    if (new Date(existing.daily_reset_at).getTime() < Date.now()) {
      await query(
        `UPDATE forge_agent_wallets SET daily_spent = 0, daily_reset_at = NOW() + INTERVAL '1 day' WHERE agent_id = $1`,
        [agentId],
      );
      existing.daily_spent = 0;
    }
    return existing;
  }

  const id = ulid();
  await query(
    `INSERT INTO forge_agent_wallets (id, agent_id) VALUES ($1, $2)`,
    [id, agentId],
  );
  return {
    id, agent_id: agentId, balance: 0, total_earned: 0, total_spent: 0,
    daily_spend_limit: 1.0, daily_spent: 0, daily_reset_at: new Date(Date.now() + 86400000).toISOString(),
  };
}

/**
 * Grant credits to an agent (admin operation).
 */
export async function grantCredits(agentId: string, amount: number, description?: string): Promise<Transaction> {
  const wallet = await getOrCreateWallet(agentId);
  const txId = ulid();

  await query(
    `UPDATE forge_agent_wallets SET balance = balance + $1, total_earned = total_earned + $1 WHERE agent_id = $2`,
    [amount, agentId],
  );

  await query(
    `INSERT INTO forge_agent_transactions (id, to_agent_id, amount, transaction_type, description)
     VALUES ($1, $2, $3, 'grant', $4)`,
    [txId, agentId, amount, description ?? `Admin grant of $${amount.toFixed(4)}`],
  );

  return {
    id: txId, from_agent_id: null, to_agent_id: agentId,
    amount, transaction_type: 'grant', execution_id: null,
    bounty_id: null, description: description ?? null, created_at: new Date().toISOString(),
  };
}

/**
 * Transfer credits between agents. Used for bounty payments, hiring, etc.
 */
export async function transferCredits(
  fromAgentId: string,
  toAgentId: string,
  amount: number,
  transactionType: 'payment' | 'reward' | 'refund',
  opts?: { executionId?: string; bountyId?: string; description?: string },
): Promise<Transaction> {
  return transaction(async (client) => {
    // Check sender balance and daily limit
    const sender = await clientQuery<Wallet>(
      client,
      `SELECT * FROM forge_agent_wallets WHERE agent_id = $1 FOR UPDATE`,
      [fromAgentId],
    );
    if (sender.length === 0) throw new Error(`No wallet for sender: ${fromAgentId}`);
    const senderWallet = sender[0]!;

    if (senderWallet.balance < amount) {
      throw new Error(`Insufficient balance: ${senderWallet.balance} < ${amount}`);
    }

    // Check daily limit (reset if past)
    let dailySpent = parseFloat(String(senderWallet.daily_spent));
    if (new Date(senderWallet.daily_reset_at).getTime() < Date.now()) {
      dailySpent = 0;
    }
    if (dailySpent + amount > parseFloat(String(senderWallet.daily_spend_limit))) {
      throw new Error(`Daily spend limit exceeded: ${dailySpent + amount} > ${senderWallet.daily_spend_limit}`);
    }

    // Debit sender
    await clientQuery(client,
      `UPDATE forge_agent_wallets SET balance = balance - $1, total_spent = total_spent + $1, daily_spent = daily_spent + $1 WHERE agent_id = $2`,
      [amount, fromAgentId],
    );

    // Credit receiver (create wallet if needed)
    await clientQuery(client,
      `INSERT INTO forge_agent_wallets (id, agent_id, balance, total_earned)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (agent_id) DO UPDATE SET balance = forge_agent_wallets.balance + $3, total_earned = forge_agent_wallets.total_earned + $3`,
      [ulid(), toAgentId, amount],
    );

    // Record transaction
    const txId = ulid();
    await clientQuery(client,
      `INSERT INTO forge_agent_transactions (id, from_agent_id, to_agent_id, amount, transaction_type, execution_id, bounty_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [txId, fromAgentId, toAgentId, amount, transactionType,
       opts?.executionId ?? null, opts?.bountyId ?? null, opts?.description ?? null],
    );

    return {
      id: txId, from_agent_id: fromAgentId, to_agent_id: toAgentId,
      amount, transaction_type: transactionType,
      execution_id: opts?.executionId ?? null, bounty_id: opts?.bountyId ?? null,
      description: opts?.description ?? null, created_at: new Date().toISOString(),
    };
  });
}

// ============================================
// Bounty Marketplace
// ============================================

/**
 * Post a new bounty.
 */
export async function postBounty(
  posterAgentId: string,
  title: string,
  description: string,
  rewardAmount: number,
  requiredCapabilities?: string[],
): Promise<Bounty> {
  // Verify poster has enough balance
  const wallet = await getOrCreateWallet(posterAgentId);
  if (wallet.balance < rewardAmount) {
    throw new Error(`Insufficient balance to post bounty: ${wallet.balance} < ${rewardAmount}`);
  }

  // Escrow the reward (debit from poster)
  await query(
    `UPDATE forge_agent_wallets SET balance = balance - $1, total_spent = total_spent + $1 WHERE agent_id = $2`,
    [rewardAmount, posterAgentId],
  );

  const id = ulid();
  await query(
    `INSERT INTO forge_bounties (id, poster_agent_id, title, description, required_capabilities, reward_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, posterAgentId, title, description, requiredCapabilities ?? [], rewardAmount],
  );

  // Record escrow transaction
  await query(
    `INSERT INTO forge_agent_transactions (id, from_agent_id, amount, transaction_type, bounty_id, description)
     VALUES ($1, $2, $3, 'payment', $4, $5)`,
    [ulid(), posterAgentId, rewardAmount, id, `Bounty escrow: ${title}`],
  );

  return {
    id, poster_agent_id: posterAgentId, title, description,
    required_capabilities: requiredCapabilities ?? [],
    reward_amount: rewardAmount, status: 'open',
    assigned_agent_id: null, execution_id: null, quality_score: null,
  };
}

/**
 * Assign a bounty to an agent (bid accepted).
 */
export async function assignBounty(bountyId: string, agentId: string): Promise<void> {
  const result = await query(
    `UPDATE forge_bounties SET status = 'assigned', assigned_agent_id = $1 WHERE id = $2 AND status = 'open' RETURNING id`,
    [agentId, bountyId],
  );
  if (result.length === 0) throw new Error(`Bounty not found or not open: ${bountyId}`);
}

/**
 * Complete a bounty — pay out reward to assigned agent.
 */
export async function completeBounty(bountyId: string, qualityScore?: number): Promise<void> {
  const bounty = await queryOne<Bounty>(
    `SELECT * FROM forge_bounties WHERE id = $1`,
    [bountyId],
  );
  if (!bounty) throw new Error(`Bounty not found: ${bountyId}`);
  if (!bounty.assigned_agent_id) throw new Error(`Bounty has no assigned agent: ${bountyId}`);
  if (bounty.status !== 'assigned' && bounty.status !== 'in_progress') {
    throw new Error(`Bounty status is ${bounty.status}, expected assigned or in_progress`);
  }

  // Pay reward to assigned agent
  await query(
    `INSERT INTO forge_agent_wallets (id, agent_id, balance, total_earned)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (agent_id) DO UPDATE SET balance = forge_agent_wallets.balance + $3, total_earned = forge_agent_wallets.total_earned + $3`,
    [ulid(), bounty.assigned_agent_id, bounty.reward_amount],
  );

  // Record reward transaction
  await query(
    `INSERT INTO forge_agent_transactions (id, from_agent_id, to_agent_id, amount, transaction_type, bounty_id, description)
     VALUES ($1, $2, $3, $4, 'reward', $5, $6)`,
    [ulid(), bounty.poster_agent_id, bounty.assigned_agent_id, bounty.reward_amount,
     bountyId, `Bounty reward: ${bounty.title}`],
  );

  // Update bounty status
  await query(
    `UPDATE forge_bounties SET status = 'completed', quality_score = $1 WHERE id = $2`,
    [qualityScore ?? null, bountyId],
  );

  // Update reputation
  await updateReputation(bounty.assigned_agent_id, true, qualityScore ?? 0.7);
}

/**
 * Fail a bounty — refund poster.
 */
export async function failBounty(bountyId: string): Promise<void> {
  const bounty = await queryOne<Bounty>(
    `SELECT * FROM forge_bounties WHERE id = $1`,
    [bountyId],
  );
  if (!bounty) throw new Error(`Bounty not found: ${bountyId}`);

  // Refund poster
  await query(
    `UPDATE forge_agent_wallets SET balance = balance + $1, total_spent = total_spent - $1 WHERE agent_id = $2`,
    [bounty.reward_amount, bounty.poster_agent_id],
  );

  // Record refund
  await query(
    `INSERT INTO forge_agent_transactions (id, to_agent_id, amount, transaction_type, bounty_id, description)
     VALUES ($1, $2, $3, 'refund', $4, $5)`,
    [ulid(), bounty.poster_agent_id, bounty.reward_amount, bountyId, `Bounty refund: ${bounty.title}`],
  );

  await query(`UPDATE forge_bounties SET status = 'failed' WHERE id = $1`, [bountyId]);

  // Update reputation of assigned agent (if any)
  if (bounty.assigned_agent_id) {
    await updateReputation(bounty.assigned_agent_id, false);
  }
}

/**
 * List open bounties, optionally filtered by capabilities.
 */
export async function listBounties(
  status?: string,
  capabilities?: string[],
  limit = 50,
): Promise<Bounty[]> {
  if (capabilities && capabilities.length > 0) {
    return query<Bounty>(
      `SELECT * FROM forge_bounties
       WHERE ($1::text IS NULL OR status = $1)
         AND required_capabilities <@ $2
       ORDER BY reward_amount DESC LIMIT $3`,
      [status ?? null, capabilities, limit],
    );
  }
  return query<Bounty>(
    `SELECT * FROM forge_bounties WHERE ($1::text IS NULL OR status = $1)
     ORDER BY reward_amount DESC LIMIT $2`,
    [status ?? null, limit],
  );
}

// ============================================
// Reputation
// ============================================

/**
 * Update an agent's reputation after a bounty interaction.
 */
export async function updateReputation(
  agentId: string,
  success: boolean,
  qualityScore?: number,
): Promise<void> {
  // Ensure reputation record exists
  await query(
    `INSERT INTO forge_agent_reputation (id, agent_id)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO NOTHING`,
    [ulid(), agentId],
  );

  if (success) {
    await query(
      `UPDATE forge_agent_reputation SET
         total_completed = total_completed + 1,
         reliability_score = LEAST(1.0, reliability_score + 0.02),
         quality_score = CASE WHEN $1::numeric IS NOT NULL
           THEN (quality_score * total_completed + $1) / (total_completed + 1)
           ELSE quality_score END,
         reputation_score = LEAST(100, reputation_score + 2),
         updated_at = NOW()
       WHERE agent_id = $2`,
      [qualityScore ?? null, agentId],
    );
  } else {
    await query(
      `UPDATE forge_agent_reputation SET
         total_failed = total_failed + 1,
         reliability_score = GREATEST(0, reliability_score - 0.05),
         reputation_score = GREATEST(0, reputation_score - 5),
         updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId],
    );
  }
}

/**
 * Get an agent's reputation.
 */
export async function getReputation(agentId: string): Promise<Reputation | null> {
  return queryOne<Reputation>(
    `SELECT * FROM forge_agent_reputation WHERE agent_id = $1`,
    [agentId],
  );
}

/**
 * Get transaction history for an agent.
 */
export async function getTransactions(agentId: string, limit = 50): Promise<Transaction[]> {
  return query<Transaction>(
    `SELECT * FROM forge_agent_transactions
     WHERE from_agent_id = $1 OR to_agent_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [agentId, limit],
  );
}
