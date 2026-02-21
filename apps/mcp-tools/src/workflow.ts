/**
 * Workflow tool handlers: ticket_ops, finding_ops, intervention_ops, agent_call
 * Migrated from mcp-workflow server.
 */

import {
  getSubstratePool,
  forgeQuery,
  generateId,
  audit,
} from '@substrate/db';

const FORGE_URL = process.env['FORGE_URL'] ?? 'http://forge:3005';
const FORGE_API_KEY = process.env['FORGE_API_KEY'] ?? '';

// ============================================
// Tool Definitions
// ============================================

export const TOOLS = [
  {
    name: 'ticket_ops',
    description: 'Manage agent work tickets. Actions: create, update, assign, list, get, add_note, audit_history.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'assign', 'list', 'get', 'add_note', 'audit_history'] },
        title: { type: 'string', description: 'Ticket title (create)' },
        description: { type: 'string', description: 'Ticket description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        category: { type: 'string' },
        assigned_to: { type: 'string', description: 'Agent name to assign to' },
        agent_id: { type: 'string' },
        agent_name: { type: 'string' },
        ticket_id: { type: 'string', description: 'Ticket ID for update/assign/get/add_note/audit_history' },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
        resolution: { type: 'string', description: 'Resolution note (required when resolving)' },
        note: { type: 'string', description: 'Note content for add_note' },
        filter_status: { type: 'string' },
        filter_assigned_to: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'finding_ops',
    description: 'Report and manage findings/insights. Actions: create, list, get, promote.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'get', 'promote'] },
        finding: { type: 'string', description: 'Finding text (create)' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
        category: { type: 'string' },
        agent_id: { type: 'string' },
        agent_name: { type: 'string' },
        execution_id: { type: 'string' },
        metadata: { type: 'object' },
        finding_id: { type: 'string', description: 'Finding ID for get/promote' },
        namespace: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        filter_severity: { type: 'string' },
        filter_agent_id: { type: 'string' },
        filter_category: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'intervention_ops',
    description: 'Request and check human interventions. Actions: create, list, get, check.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'get', 'check'] },
        agent_id: { type: 'string' },
        agent_name: { type: 'string' },
        agent_type: { type: 'string' },
        task_id: { type: 'string' },
        type: { type: 'string', enum: ['approval', 'escalation', 'feedback', 'error', 'resource'] },
        title: { type: 'string' },
        description: { type: 'string' },
        context: { type: 'string' },
        proposed_action: { type: 'string' },
        intervention_id: { type: 'string', description: 'Intervention ID for get/check' },
        filter_status: { type: 'string' },
        filter_agent_id: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'agent_call',
    description: 'Delegate a task to another agent by agent ID. Returns the sub-agent execution result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Target agent ID to call' },
        input: { type: 'string', description: 'Task description/input for the sub-agent' },
        caller_agent_name: { type: 'string', description: 'Name of the calling agent' },
      },
      required: ['agent_id', 'input'],
    },
  },
];

// ============================================
// Handlers
// ============================================

async function handleTicketOps(args: Record<string, unknown>): Promise<string> {
  const p = getSubstratePool();
  const action = args['action'] as string;

  switch (action) {
    case 'create': {
      const title = args['title'] as string | undefined;
      if (!title) return JSON.stringify({ error: 'title is required to create a ticket' });

      const id = generateId();
      const result = await p.query(
        `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, 'agent', '{}')
         RETURNING id, title, status, priority, assigned_to, agent_name, created_at`,
        [
          id, title,
          (args['description'] as string) ?? null,
          (args['status'] as string) ?? 'open',
          (args['priority'] as string) ?? 'medium',
          (args['category'] as string) ?? 'task',
          (args['agent_name'] as string) ?? 'system',
          (args['assigned_to'] as string) ?? null,
          (args['agent_id'] as string) ?? null,
          (args['agent_name'] as string) ?? null,
        ],
      );
      await audit(p, 'ticket', id, 'created', (args['agent_name'] as string) ?? 'system', (args['agent_id'] as string) ?? null, {}, { title, priority: args['priority'] ?? 'medium' });
      return JSON.stringify({ created: true, ticket: result.rows[0] });
    }

    case 'update': {
      const ticketId = args['ticket_id'] as string | undefined;
      if (!ticketId) return JSON.stringify({ error: 'ticket_id is required for update' });

      const oldResult = await p.query(`SELECT id, title, status, priority FROM agent_tickets WHERE id = $1`, [ticketId]);
      if (oldResult.rows.length === 0) return JSON.stringify({ error: `Ticket not found: ${ticketId}` });
      const oldTicket = oldResult.rows[0] as Record<string, unknown>;

      const setClauses: string[] = [];
      const params: unknown[] = [];
      const changes: Record<string, unknown> = {};
      const status = args['status'] as string | undefined;

      if (status) {
        if (status === 'resolved' && !args['resolution']) {
          return JSON.stringify({ error: 'resolution is required when setting status to resolved' });
        }
        params.push(status);
        setClauses.push(`status = $${params.length}`);
        changes['status'] = status;
      }
      if (args['priority']) { params.push(args['priority']); setClauses.push(`priority = $${params.length}`); changes['priority'] = args['priority']; }
      if (args['title']) { params.push(args['title']); setClauses.push(`title = $${params.length}`); changes['title'] = args['title']; }
      if (args['description']) { params.push(args['description']); setClauses.push(`description = $${params.length}`); changes['description'] = args['description']; }
      if (args['resolution']) {
        params.push(args['resolution']);
        setClauses.push(`resolution = $${params.length}`);
        setClauses.push(`metadata = metadata || jsonb_build_object('resolved_at', NOW()::text, 'resolved_by', COALESCE(assigned_to, 'unknown'))`);
        changes['resolution'] = args['resolution'];
      }

      if (setClauses.length === 0) return JSON.stringify({ error: 'No fields to update' });
      setClauses.push('updated_at = NOW()');
      params.push(ticketId);

      const result = await p.query(
        `UPDATE agent_tickets SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id, title, status, priority, assigned_to`,
        params,
      );
      const auditAction = changes['status'] === 'resolved' ? 'resolved' : changes['status'] === 'in_progress' ? 'started' : 'updated';
      await audit(p, 'ticket', ticketId, auditAction, (args['agent_name'] as string) ?? 'unknown', (args['agent_id'] as string) ?? null,
        { status: oldTicket['status'], priority: oldTicket['priority'] }, changes);
      return JSON.stringify({ updated: true, ticket: result.rows[0] });
    }

    case 'assign': {
      const ticketId = args['ticket_id'] as string | undefined;
      const assignTo = args['assigned_to'] as string | undefined;
      if (!ticketId) return JSON.stringify({ error: 'ticket_id is required for assign' });
      if (!assignTo) return JSON.stringify({ error: 'assigned_to is required for assign' });

      const result = await p.query(
        `UPDATE agent_tickets SET assigned_to = $1, agent_name = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW()
         WHERE id = $2 RETURNING id, title, status, assigned_to`,
        [assignTo, ticketId],
      );
      if (result.rows.length === 0) return JSON.stringify({ error: `Ticket not found: ${ticketId}` });
      await audit(p, 'ticket', ticketId, 'assigned', assignTo, null, {}, { assigned_to: assignTo });
      return JSON.stringify({ assigned: true, ticket: result.rows[0] });
    }

    case 'list': {
      const conditions: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (args['filter_status']) { params.push(args['filter_status']); conditions.push(`status = $${params.length}`); }
      if (args['filter_assigned_to']) { params.push(args['filter_assigned_to']); conditions.push(`assigned_to = $${params.length}`); }
      const limit = Math.min((args['limit'] as number) ?? 20, 50);
      const result = await p.query(
        `SELECT id, title, status, priority, category, assigned_to, agent_name, resolution, created_at, updated_at
         FROM agent_tickets WHERE ${conditions.join(' AND ')}
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC
         LIMIT ${limit}`,
        params,
      );
      return JSON.stringify({ tickets: result.rows, count: result.rows.length });
    }

    case 'get': {
      const ticketId = args['ticket_id'] as string | undefined;
      if (!ticketId) return JSON.stringify({ error: 'ticket_id is required for get' });
      const result = await p.query(`SELECT * FROM agent_tickets WHERE id = $1`, [ticketId]);
      if (result.rows.length === 0) return JSON.stringify({ error: `Ticket not found: ${ticketId}` });
      return JSON.stringify({ ticket: result.rows[0] });
    }

    case 'add_note': {
      const ticketId = args['ticket_id'] as string | undefined;
      const note = args['note'] as string | undefined;
      if (!ticketId) return JSON.stringify({ error: 'ticket_id is required for add_note' });
      if (!note) return JSON.stringify({ error: 'note content is required for add_note' });

      const check = await p.query(`SELECT id, assigned_to FROM agent_tickets WHERE id = $1 AND deleted_at IS NULL`, [ticketId]);
      if (check.rows.length === 0) return JSON.stringify({ error: `Ticket not found: ${ticketId}` });

      const noteId = generateId();
      const author = (args['agent_name'] as string) ?? (check.rows[0] as Record<string, unknown>)['assigned_to'] ?? 'unknown';
      const noteResult = await p.query(
        `INSERT INTO ticket_notes (id, ticket_id, author, content) VALUES ($1, $2, $3, $4) RETURNING id, ticket_id, author, content, created_at`,
        [noteId, ticketId, author, note],
      );
      await p.query(`UPDATE agent_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);
      await audit(p, 'ticket', ticketId, 'note_added', author as string, null, {}, { note_id: noteId, content: note });
      return JSON.stringify({ note_added: true, note: noteResult.rows[0] });
    }

    case 'audit_history': {
      const ticketId = args['ticket_id'] as string | undefined;
      if (!ticketId) return JSON.stringify({ error: 'ticket_id is required for audit_history' });
      const limit = Math.min((args['limit'] as number) ?? 50, 100);
      const result = await p.query(
        `SELECT id, action, actor, old_value, new_value, execution_id, created_at FROM agent_audit_log WHERE entity_type = 'ticket' AND entity_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [ticketId, limit],
      );
      return JSON.stringify({ ticket_id: ticketId, audit_trail: result.rows, count: result.rows.length });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: create, update, assign, list, get, add_note, audit_history` });
  }
}

async function handleFindingOps(args: Record<string, unknown>): Promise<string> {
  const p = getSubstratePool();
  const action = args['action'] as string;

  switch (action) {
    case 'create': {
      const finding = args['finding'] as string | undefined;
      const agentName = args['agent_name'] as string | undefined;
      if (!finding) return JSON.stringify({ error: 'finding text is required' });
      if (!agentName) return JSON.stringify({ error: 'agent_name is required' });

      const id = generateId();
      const severity = (args['severity'] as string) ?? 'info';
      const category = (args['category'] as string) ?? 'general';

      const result = await p.query(
        `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, execution_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, agent_name, finding, severity, category, created_at`,
        [id, (args['agent_id'] as string) ?? 'unknown', agentName, finding, severity, category, (args['execution_id'] as string) ?? null, JSON.stringify(args['metadata'] ?? {})],
      );
      await audit(p, 'finding', id, 'created', agentName, (args['agent_id'] as string) ?? null, {}, { finding, severity, category }, (args['execution_id'] as string) ?? null);

      // Auto-create ticket for warning/critical findings
      let ticketId: string | null = null;
      if (severity === 'warning' || severity === 'critical') {
        const tId = generateId();
        const priority = severity === 'critical' ? 'urgent' : 'high';
        let assignTo: string | null = null;
        if (category === 'security') assignTo = 'Aegis';
        else if (category === 'performance' || category === 'optimization') assignTo = 'Oracle';
        else if (category === 'infrastructure' || category === 'infrastructure_status') assignTo = 'Anvil';
        else if (category === 'bug') assignTo = 'Anvil';
        else if (category === 'service_outage') assignTo = 'Anvil';
        if (!assignTo) assignTo = 'Nexus';

        try {
          await p.query(
            `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata)
             VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, true, 'agent', $10)`,
            [tId, `[${severity.toUpperCase()}] ${finding.substring(0, 100)}`, finding, priority, category, agentName, assignTo, (args['agent_id'] as string) ?? null, agentName, JSON.stringify({ finding_id: id, auto_created: true })],
          );
          ticketId = tId;
        } catch { /* non-fatal */ }
      }

      // Auto-store finding as semantic memory
      try {
        const importanceMap: Record<string, number> = { critical: 1.0, warning: 0.7, info: 0.4 };
        const memId = generateId();
        await forgeQuery(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, source, importance, metadata, created_at, updated_at)
           VALUES ($1, $2, 'fleet:system', $3, 'finding', $4, $5, NOW(), NOW())`,
          [memId, (args['agent_id'] as string) ?? 'unknown', finding, importanceMap[severity] ?? 0.4, JSON.stringify({ source_type: 'finding', category, severity, agent_name: agentName, finding_id: id })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({ created: true, finding: result.rows[0], ticket_created: ticketId !== null, ticket_id: ticketId });
    }

    case 'list': {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args['filter_severity']) { params.push(args['filter_severity']); conditions.push(`severity = $${params.length}`); }
      if (args['filter_agent_id']) { params.push(args['filter_agent_id']); conditions.push(`agent_id = $${params.length}`); }
      if (args['filter_category']) { params.push(args['filter_category']); conditions.push(`category = $${params.length}`); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min((args['limit'] as number) ?? 20, 50);
      params.push(limit);
      const result = await p.query(
        `SELECT id, agent_id, agent_name, finding, severity, category, execution_id, created_at FROM agent_findings ${where} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 END, created_at DESC LIMIT $${params.length}`,
        params,
      );
      return JSON.stringify({ findings: result.rows, count: result.rows.length });
    }

    case 'get': {
      const findingId = args['finding_id'] as string | undefined;
      if (!findingId) return JSON.stringify({ error: 'finding_id is required for get' });
      const result = await p.query(`SELECT * FROM agent_findings WHERE id = $1`, [findingId]);
      if (result.rows.length === 0) return JSON.stringify({ error: `Finding not found: ${findingId}` });
      return JSON.stringify({ finding: result.rows[0] });
    }

    case 'promote': {
      const findingId = args['finding_id'] as string | undefined;
      const agentName = args['agent_name'] as string | undefined;
      if (!findingId) return JSON.stringify({ error: 'finding_id is required for promote' });
      if (!agentName) return JSON.stringify({ error: 'agent_name is required for promote' });

      const finding = await p.query(`SELECT * FROM agent_findings WHERE id = $1`, [findingId]);
      if (finding.rows.length === 0) return JSON.stringify({ error: `Finding not found: ${findingId}` });
      const f = finding.rows[0] as Record<string, unknown>;
      if (f['agent_name'] !== agentName) return JSON.stringify({ error: `Cannot promote another agent's finding` });

      const subject = `finding:${findingId}`;
      const existing = await p.query(`SELECT id FROM knowledge_facts WHERE subject = $1 AND predicate = $2`, [subject, 'promoted_from']);
      if (existing.rows.length > 0) return JSON.stringify({ promoted: true, factId: (existing.rows[0] as Record<string, unknown>)['id'], alreadyExists: true });

      const factId = generateId();
      const severityConfidence: Record<string, number> = { critical: 0.95, warning: 0.85, info: 0.7 };
      const confidence = severityConfidence[f['severity'] as string] ?? 0.7;

      await p.query(
        `INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, sources, category, valid_from, agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [factId, subject, 'promoted_from', (f['finding'] as string).slice(0, 200), f['finding'], confidence, [`agent:${agentName}`], (f['category'] as string) ?? 'agent-findings', f['created_at'], f['agent_id'] ?? null],
      );
      return JSON.stringify({ promoted: true, factId, confidence });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: create, list, get, promote` });
  }
}

async function handleInterventionOps(args: Record<string, unknown>): Promise<string> {
  const p = getSubstratePool();
  const action = args['action'] as string;

  switch (action) {
    case 'create': {
      const title = args['title'] as string | undefined;
      const agentName = args['agent_name'] as string | undefined;
      if (!title) return JSON.stringify({ error: 'title is required to create an intervention' });
      if (!agentName) return JSON.stringify({ error: 'agent_name is required' });

      const id = generateId();
      const result = await p.query(
        `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, task_id, type, title, description, context, proposed_action, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         RETURNING id, agent_name, type, title, status, created_at`,
        [id, (args['agent_id'] as string) ?? 'unknown', agentName, (args['agent_type'] as string) ?? 'custom', (args['task_id'] as string) ?? null, (args['type'] as string) ?? 'feedback', title, (args['description'] as string) ?? null, (args['context'] as string) ?? null, (args['proposed_action'] as string) ?? null],
      );
      await audit(p, 'intervention', id, 'created', agentName, (args['agent_id'] as string) ?? null, {}, { title, type: args['type'] ?? 'feedback' });
      return JSON.stringify({ created: true, intervention: result.rows[0] });
    }

    case 'check': {
      const interventionId = args['intervention_id'] as string | undefined;
      if (!interventionId) return JSON.stringify({ error: 'intervention_id is required for check' });
      const result = await p.query(
        `SELECT id, status, human_response, responded_by, responded_at, autonomy_delta FROM agent_interventions WHERE id = $1`,
        [interventionId],
      );
      if (result.rows.length === 0) return JSON.stringify({ error: `Intervention not found: ${interventionId}` });
      const row = result.rows[0] as Record<string, unknown>;
      return JSON.stringify({ id: row['id'], status: row['status'], resolved: row['status'] !== 'pending', human_response: row['human_response'], responded_by: row['responded_by'] });
    }

    case 'list': {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args['filter_status']) { params.push(args['filter_status']); conditions.push(`status = $${params.length}`); }
      if (args['filter_agent_id']) { params.push(args['filter_agent_id']); conditions.push(`agent_id = $${params.length}`); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min((args['limit'] as number) ?? 20, 50);
      const result = await p.query(
        `SELECT id, agent_id, agent_name, type, title, status, human_response, responded_at, created_at FROM agent_interventions ${where} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'denied' THEN 2 END, created_at DESC LIMIT ${limit}`,
        params,
      );
      return JSON.stringify({ interventions: result.rows, count: result.rows.length });
    }

    case 'get': {
      const interventionId = args['intervention_id'] as string | undefined;
      if (!interventionId) return JSON.stringify({ error: 'intervention_id is required for get' });
      const result = await p.query(`SELECT * FROM agent_interventions WHERE id = $1`, [interventionId]);
      if (result.rows.length === 0) return JSON.stringify({ error: `Intervention not found: ${interventionId}` });
      return JSON.stringify({ intervention: result.rows[0] });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: create, list, get, check` });
  }
}

async function handleAgentCall(args: Record<string, unknown>): Promise<string> {
  const agentId = args['agent_id'] as string | undefined;
  const input = args['input'] as string | undefined;

  if (!agentId) return JSON.stringify({ error: 'agent_id is required' });
  if (!input) return JSON.stringify({ error: 'input is required' });

  try {
    const response = await fetch(`${FORGE_URL}/api/v1/forge/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FORGE_API_KEY}` },
      body: JSON.stringify({ agentId, input, ownerId: 'mcp-tools' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({ error: `Forge execution failed: ${response.status} ${errorText}` });
    }

    const result = await response.json() as Record<string, unknown>;
    return JSON.stringify({
      delegated: true,
      execution_id: result['executionId'] ?? result['id'],
      status: result['status'] ?? 'pending',
      agent_id: agentId,
      message: `Task delegated to agent ${agentId}. Execution ID: ${result['executionId'] ?? result['id']}`,
    });
  } catch (err) {
    return JSON.stringify({ error: `Agent call failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ============================================
// Tool Dispatcher
// ============================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'ticket_ops': return handleTicketOps(args);
    case 'finding_ops': return handleFindingOps(args);
    case 'intervention_ops': return handleInterventionOps(args);
    case 'agent_call': return handleAgentCall(args);
    default: throw new Error(`Unknown workflow tool: ${name}`);
  }
}
