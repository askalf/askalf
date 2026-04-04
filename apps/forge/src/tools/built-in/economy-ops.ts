/**
 * Built-in Tool: Economy Ops (Level 14 — Agent Economy)
 * Agent tool for economic actions: check balance, post bounty, bid on bounty,
 * view marketplace, transfer credits, check reputation.
 */

import {
  getOrCreateWallet, grantCredits, transferCredits,
  postBounty, assignBounty, completeBounty, failBounty, listBounties,
  getReputation, getTransactions,
} from '../../runtime/economy.js';
import { checkAction } from '../../runtime/autonomy-gate.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface EconomyOpsInput {
  action: 'balance' | 'post_bounty' | 'assign_bounty' | 'complete_bounty' | 'fail_bounty'
    | 'marketplace' | 'transfer' | 'reputation' | 'transactions';
  // For post_bounty:
  title?: string;
  description?: string;
  reward_amount?: number;
  required_capabilities?: string[];
  // For assign_bounty / complete_bounty / fail_bounty:
  bounty_id?: string;
  quality_score?: number;
  // For transfer:
  to_agent_id?: string;
  amount?: number;
  // For marketplace:
  status_filter?: string;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function economyOps(input: EconomyOpsInput): Promise<ToolResult> {
  const startTime = performance.now();
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  try {
    switch (input.action) {
      case 'balance':
        return await handleBalance(agentId, startTime);
      case 'post_bounty':
        return await handlePostBounty(agentId, input, startTime);
      case 'assign_bounty':
        return await handleAssignBounty(agentId, input, startTime);
      case 'complete_bounty':
        return await handleCompleteBounty(input, startTime);
      case 'fail_bounty':
        return await handleFailBounty(input, startTime);
      case 'marketplace':
        return await handleMarketplace(input, startTime);
      case 'transfer':
        return await handleTransfer(agentId, input, startTime);
      case 'reputation':
        return await handleReputation(agentId, startTime);
      case 'transactions':
        return await handleTransactions(agentId, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: balance, post_bounty, assign_bounty, complete_bounty, fail_bounty, marketplace, transfer, reputation, transactions`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

async function handleBalance(agentId: string, startTime: number): Promise<ToolResult> {
  const wallet = await getOrCreateWallet(agentId);
  const rep = await getReputation(agentId);

  return {
    output: {
      agent_id: agentId,
      balance: wallet.balance,
      total_earned: wallet.total_earned,
      total_spent: wallet.total_spent,
      daily_spend_limit: wallet.daily_spend_limit,
      daily_spent: wallet.daily_spent,
      reputation: rep ? {
        score: rep.reputation_score,
        reliability: rep.reliability_score,
        quality: rep.quality_score,
        efficiency: rep.efficiency_score,
        completed: rep.total_completed,
        failed: rep.total_failed,
      } : null,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handlePostBounty(agentId: string, input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  // Gate check
  const gate = await checkAction(agentId, 'economy_spend');
  if (!gate.allowed) {
    return { output: null, error: gate.reason, durationMs: Math.round(performance.now() - startTime) };
  }

  if (!input.title || !input.description || !input.reward_amount) {
    return { output: null, error: 'title, description, and reward_amount are required for post_bounty', durationMs: 0 };
  }

  const bounty = await postBounty(agentId, input.title, input.description, input.reward_amount, input.required_capabilities);

  return {
    output: {
      bounty_id: bounty.id,
      title: bounty.title,
      reward_amount: bounty.reward_amount,
      status: bounty.status,
      message: `Bounty posted: "${bounty.title}" for $${bounty.reward_amount}. Reward escrowed from your wallet.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleAssignBounty(agentId: string, input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.bounty_id) {
    return { output: null, error: 'bounty_id is required for assign_bounty', durationMs: 0 };
  }

  await assignBounty(input.bounty_id, agentId);

  return {
    output: {
      bounty_id: input.bounty_id,
      assigned_agent_id: agentId,
      message: `Bounty assigned to you. Begin work and call complete_bounty when done.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleCompleteBounty(input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.bounty_id) {
    return { output: null, error: 'bounty_id is required for complete_bounty', durationMs: 0 };
  }

  await completeBounty(input.bounty_id, input.quality_score);

  return {
    output: {
      bounty_id: input.bounty_id,
      completed: true,
      message: `Bounty completed. Reward paid out. Reputation updated.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleFailBounty(input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.bounty_id) {
    return { output: null, error: 'bounty_id is required for fail_bounty', durationMs: 0 };
  }

  await failBounty(input.bounty_id);

  return {
    output: {
      bounty_id: input.bounty_id,
      failed: true,
      message: `Bounty marked as failed. Poster refunded. Reputation impact applied.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleMarketplace(input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  const bounties = await listBounties(input.status_filter ?? 'open');

  return {
    output: {
      bounties: bounties.map((b) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        reward_amount: b.reward_amount,
        required_capabilities: b.required_capabilities,
        status: b.status,
        poster_agent_id: b.poster_agent_id,
        assigned_agent_id: b.assigned_agent_id,
      })),
      total: bounties.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleTransfer(agentId: string, input: EconomyOpsInput, startTime: number): Promise<ToolResult> {
  const gate = await checkAction(agentId, 'economy_spend');
  if (!gate.allowed) {
    return { output: null, error: gate.reason, durationMs: Math.round(performance.now() - startTime) };
  }

  if (!input.to_agent_id || !input.amount) {
    return { output: null, error: 'to_agent_id and amount are required for transfer', durationMs: 0 };
  }

  const tx = await transferCredits(agentId, input.to_agent_id, input.amount, 'payment', {
    description: input.description ?? 'Agent-to-agent transfer',
  });

  return {
    output: {
      transaction_id: tx.id,
      from: agentId,
      to: input.to_agent_id,
      amount: input.amount,
      message: `Transferred $${input.amount} to ${input.to_agent_id}.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleReputation(agentId: string, startTime: number): Promise<ToolResult> {
  const rep = await getReputation(agentId);
  if (!rep) {
    return {
      output: { agent_id: agentId, message: 'No reputation data yet.' },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      agent_id: agentId,
      reputation_score: rep.reputation_score,
      reliability_score: rep.reliability_score,
      quality_score: rep.quality_score,
      efficiency_score: rep.efficiency_score,
      total_completed: rep.total_completed,
      total_failed: rep.total_failed,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

async function handleTransactions(agentId: string, startTime: number): Promise<ToolResult> {
  const txs = await getTransactions(agentId);

  return {
    output: {
      agent_id: agentId,
      transactions: txs.map((t) => ({
        id: t.id,
        from: t.from_agent_id,
        to: t.to_agent_id,
        amount: t.amount,
        type: t.transaction_type,
        description: t.description,
        bounty_id: t.bounty_id,
        created_at: t.created_at,
      })),
      total: txs.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
