/**
 * Economy Routes — REST API for wallets, bounties, transactions, reputation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import {
  getOrCreateWallet, grantCredits, listBounties,
  getReputation, getTransactions,
} from '../runtime/economy.js';
import { authMiddleware } from '../middleware/auth.js';

export async function economyRoutes(app: FastifyInstance): Promise<void> {
  // ---- List all wallets ----
  app.get(
    '/api/v1/forge/economy/wallets',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const wallets = await query<Record<string, unknown>>(
        `SELECT w.*, a.name AS agent_name FROM forge_agent_wallets w
         JOIN forge_agents a ON a.id = w.agent_id
         ORDER BY w.balance DESC`,
      );
      return reply.send({ wallets });
    },
  );

  // ---- Get wallet for agent ----
  app.get(
    '/api/v1/forge/economy/wallets/:agentId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const wallet = await getOrCreateWallet(agentId);
      return reply.send({ wallet });
    },
  );

  // ---- Grant credits (admin) ----
  app.post(
    '/api/v1/forge/economy/wallets/:agentId/grant',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const { amount, description } = request.body as { amount: number; description?: string };

      if (!amount || amount <= 0) {
        return reply.code(400).send({ error: 'amount must be positive' });
      }

      const tx = await grantCredits(agentId, amount, description);
      return reply.send({ transaction: tx });
    },
  );

  // ---- Set daily spend limit (admin) ----
  app.put(
    '/api/v1/forge/economy/wallets/:agentId/limit',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const { daily_spend_limit } = request.body as { daily_spend_limit: number };

      await query(
        `UPDATE forge_agent_wallets SET daily_spend_limit = $1 WHERE agent_id = $2`,
        [daily_spend_limit, agentId],
      );

      return reply.send({ agentId, daily_spend_limit });
    },
  );

  // ---- List bounties ----
  app.get(
    '/api/v1/forge/economy/bounties',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const status = (request.query as Record<string, string>)['status'];
      const bounties = await listBounties(status);
      return reply.send({ bounties });
    },
  );

  // ---- Get bounty detail ----
  app.get(
    '/api/v1/forge/economy/bounties/:bountyId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { bountyId } = request.params as { bountyId: string };
      const bounty = await query<Record<string, unknown>>(
        `SELECT b.*, pa.name AS poster_name, aa.name AS assigned_name
         FROM forge_bounties b
         LEFT JOIN forge_agents pa ON pa.id = b.poster_agent_id
         LEFT JOIN forge_agents aa ON aa.id = b.assigned_agent_id
         WHERE b.id = $1`,
        [bountyId],
      );
      if (bounty.length === 0) {
        return reply.code(404).send({ error: 'Bounty not found' });
      }
      return reply.send({ bounty: bounty[0] });
    },
  );

  // ---- Get transactions for agent ----
  app.get(
    '/api/v1/forge/economy/transactions/:agentId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const txs = await getTransactions(agentId);
      return reply.send({ transactions: txs });
    },
  );

  // ---- Get reputation for agent ----
  app.get(
    '/api/v1/forge/economy/reputation/:agentId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const rep = await getReputation(agentId);
      if (!rep) {
        return reply.send({ reputation: null, message: 'No reputation data yet' });
      }
      return reply.send({ reputation: rep });
    },
  );

  // ---- Leaderboard ----
  app.get(
    '/api/v1/forge/economy/leaderboard',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const leaderboard = await query<Record<string, unknown>>(
        `SELECT r.*, a.name AS agent_name, w.balance
         FROM forge_agent_reputation r
         JOIN forge_agents a ON a.id = r.agent_id
         LEFT JOIN forge_agent_wallets w ON w.agent_id = r.agent_id
         ORDER BY r.reputation_score DESC LIMIT 20`,
      );
      return reply.send({ leaderboard });
    },
  );
}
