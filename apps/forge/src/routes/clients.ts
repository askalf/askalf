/**
 * Client Management Routes — Revenue Mode
 * Agencies and freelancers manage clients, track billable work, generate invoices.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  // ── Clients CRUD ──

  app.get('/api/v1/forge/clients', { preHandler: [authMiddleware] }, async (request) => {
    const userId = request.userId!;
    const clients = await query(
      `SELECT * FROM forge_clients WHERE owner_id = $1 AND status != 'archived' ORDER BY name`,
      [userId],
    );
    return { clients };
  });

  app.post('/api/v1/forge/clients', { preHandler: [authMiddleware] }, async (request, reply) => {
    const userId = request.userId!;
    const body = request.body as { name?: string; email?: string; company?: string; billing_rate_hourly?: number; billing_markup?: number; notes?: string };
    if (!body.name) return reply.status(400).send({ error: 'name is required' });

    const id = ulid();
    await query(
      `INSERT INTO forge_clients (id, owner_id, name, email, company, billing_rate_hourly, billing_markup, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, body.name, body.email ?? null, body.company ?? null, body.billing_rate_hourly ?? null, body.billing_markup ?? 1.0, body.notes ?? null],
    );
    return reply.status(201).send({ id, name: body.name });
  });

  app.put('/api/v1/forge/clients/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const userId = request.userId!;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const allowed = ['name', 'email', 'company', 'billing_rate_hourly', 'billing_markup', 'notes', 'status'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        vals.push(body[key]);
        idx++;
      }
    }
    if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    sets.push(`updated_at = NOW()`);
    vals.push(id, userId);
    await query(`UPDATE forge_clients SET ${sets.join(', ')} WHERE id = $${idx} AND owner_id = $${idx + 1}`, vals);
    return { ok: true };
  });

  app.delete('/api/v1/forge/clients/:id', { preHandler: [authMiddleware] }, async (request) => {
    const userId = request.userId!;
    const { id } = request.params as { id: string };
    await query(`UPDATE forge_clients SET status = 'archived', updated_at = NOW() WHERE id = $1 AND owner_id = $2`, [id, userId]);
    return { ok: true };
  });

  // ── Projects ──

  app.get('/api/v1/forge/clients/:clientId/projects', { preHandler: [authMiddleware] }, async (request) => {
    const { clientId } = request.params as { clientId: string };
    const projects = await query(
      `SELECT * FROM forge_client_projects WHERE client_id = $1 AND status != 'archived' ORDER BY name`,
      [clientId],
    );
    return { projects };
  });

  app.post('/api/v1/forge/clients/:clientId/projects', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = request.body as { name?: string; description?: string; budget_cap?: number };
    if (!body.name) return reply.status(400).send({ error: 'name is required' });

    const id = ulid();
    await query(
      `INSERT INTO forge_client_projects (id, client_id, name, description, budget_cap)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, clientId, body.name, body.description ?? null, body.budget_cap ?? null],
    );
    return reply.status(201).send({ id, name: body.name });
  });

  // ── Invoices ──

  app.get('/api/v1/forge/invoices', { preHandler: [authMiddleware] }, async (request) => {
    const userId = request.userId!;
    const invoices = await query(
      `SELECT i.*, c.name as client_name, cp.name as project_name
       FROM forge_invoices i
       JOIN forge_clients c ON c.id = i.client_id
       LEFT JOIN forge_client_projects cp ON cp.id = i.project_id
       WHERE c.owner_id = $1
       ORDER BY i.created_at DESC`,
      [userId],
    );
    return { invoices };
  });

  app.post('/api/v1/forge/invoices/generate', { preHandler: [authMiddleware] }, async (request, reply) => {
    const userId = request.userId!;
    const body = request.body as { client_id: string; project_id?: string; period_start: string; period_end: string };

    if (!body.client_id || !body.period_start || !body.period_end) {
      return reply.status(400).send({ error: 'client_id, period_start, and period_end are required' });
    }

    // Verify client ownership
    const client = await queryOne<{ id: string; billing_markup: string }>(
      `SELECT id, billing_markup FROM forge_clients WHERE id = $1 AND owner_id = $2`,
      [body.client_id, userId],
    );
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    const markup = parseFloat(client.billing_markup) || 1.0;

    // Aggregate billable executions
    const params: unknown[] = [body.client_id, body.period_start, body.period_end];
    let whereProject = '';
    if (body.project_id) {
      params.push(body.project_id);
      whereProject = ` AND e.client_project_id = $${params.length}`;
    }
    const executions = await query<{ agent_name: string; total_cost: string; exec_count: string }>(
      `SELECT a.name as agent_name, COALESCE(SUM(e.cost), 0)::text as total_cost, COUNT(*)::text as exec_count
       FROM forge_executions e
       JOIN forge_agents a ON a.id = e.agent_id
       WHERE e.is_billable = true
         AND e.client_project_id IN (SELECT id FROM forge_client_projects WHERE client_id = $1)
         AND e.started_at >= $2 AND e.started_at < $3
         ${whereProject}
       GROUP BY a.name
       ORDER BY total_cost DESC`,
      params,
    );

    const totalAiCost = executions.reduce((s, e) => s + parseFloat(e.total_cost), 0);
    const totalBillable = totalAiCost * markup;
    const execCount = executions.reduce((s, e) => s + parseInt(e.exec_count), 0);

    const lineItems = executions.map(e => ({
      agent: e.agent_name,
      executions: parseInt(e.exec_count),
      aiCost: parseFloat(e.total_cost),
      billable: parseFloat(e.total_cost) * markup,
    }));

    const id = ulid();
    await query(
      `INSERT INTO forge_invoices (id, client_id, project_id, period_start, period_end, total_ai_cost, total_billable, execution_count, line_items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, body.client_id, body.project_id ?? null, body.period_start, body.period_end, totalAiCost, totalBillable, execCount, JSON.stringify(lineItems)],
    );

    return reply.status(201).send({
      id,
      totalAiCost,
      totalBillable,
      executionCount: execCount,
      markup,
      lineItems,
    });
  });

  app.put('/api/v1/forge/invoices/:id/status', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status: string };
    if (!['draft', 'sent', 'paid', 'void'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid status' });
    }
    await query(`UPDATE forge_invoices SET status = $1, updated_at = NOW() WHERE id = $2`, [body.status, id]);
    return { ok: true };
  });

  // ── Revenue Summary ──

  app.get('/api/v1/forge/revenue/summary', { preHandler: [authMiddleware] }, async (request) => {
    const userId = request.userId!;

    const [totalRevenue, activeClients, pendingInvoices] = await Promise.all([
      queryOne<{ total: string }>(`SELECT COALESCE(SUM(total_billable), 0)::text as total FROM forge_invoices i JOIN forge_clients c ON c.id = i.client_id WHERE c.owner_id = $1 AND i.status = 'paid'`, [userId]),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_clients WHERE owner_id = $1 AND status = 'active'`, [userId]),
      queryOne<{ count: string; total: string }>(`SELECT COUNT(*)::text as count, COALESCE(SUM(total_billable), 0)::text as total FROM forge_invoices i JOIN forge_clients c ON c.id = i.client_id WHERE c.owner_id = $1 AND i.status IN ('draft', 'sent')`, [userId]),
    ]);

    return {
      totalRevenue: parseFloat(totalRevenue?.total ?? '0'),
      activeClients: parseInt(activeClients?.count ?? '0'),
      pendingInvoices: parseInt(pendingInvoices?.count ?? '0'),
      pendingTotal: parseFloat(pendingInvoices?.total ?? '0'),
    };
  });
}
