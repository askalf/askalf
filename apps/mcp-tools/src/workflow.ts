/**
 * Workflow tool handlers: ticket_ops, finding_ops, intervention_ops, agent_call
 * Migrated from mcp-workflow server.
 */

import {
  getSubstratePool,
  getForgePool,
  forgeQuery,
  generateId,
  audit,
} from '@askalf/db';

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
  {
    name: 'proposal_ops',
    description: 'Manage change proposals (code review pipeline). Actions: create, submit, review, list, get, apply, revise.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['create', 'submit', 'review', 'list', 'get', 'apply', 'revise'] },
        proposal_id: { type: 'string', description: 'Proposal ID (submit/review/get/apply/revise)' },
        proposal_type: { type: 'string', enum: ['prompt_revision', 'code_change', 'config_change', 'schema_change'], description: 'Type of change (create)' },
        title: { type: 'string', description: 'Proposal title (create)' },
        description: { type: 'string', description: 'Detailed reasoning (create/revise)' },
        author_agent_id: { type: 'string', description: 'Author agent ID (create)' },
        target_agent_id: { type: 'string', description: 'Target agent ID for prompt/config changes (create)' },
        file_changes: { type: 'array', description: 'Array of {path, action, old_content, new_content, diff} (create/revise)' },
        config_changes: { type: 'object', description: '{key: {old, new}} for config changes (create/revise)' },
        prompt_revision_id: { type: 'string', description: 'Link to existing prompt revision (create)' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Risk classification (create)' },
        required_reviews: { type: 'number', description: 'Number of required approvals (create, default 1)' },
        execution_id: { type: 'string', description: 'Execution context (create)' },
        verdict: { type: 'string', enum: ['approve', 'reject', 'request_changes', 'comment'], description: 'Review verdict (review)' },
        comment: { type: 'string', description: 'Review comment (review)' },
        suggestions: { type: 'array', description: 'Inline suggestions [{file, line, suggestion}] (review)' },
        analysis: { type: 'object', description: 'Automated analysis results (review)' },
        reviewer_agent_id: { type: 'string', description: 'Reviewer agent ID (review)' },
        filter_status: { type: 'string', description: 'Filter by status (list)' },
        filter_author: { type: 'string', description: 'Filter by author agent ID (list)' },
        filter_type: { type: 'string', description: 'Filter by proposal type (list)' },
        agent_name: { type: 'string' },
        agent_id: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
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

      // Auto-create ticket only for critical findings (with dedup)
      let ticketId: string | null = null;
      if (severity === 'critical') {
        // Dedup: skip if an open/in_progress ticket already exists for same category from same agent
        const existing = await p.query(
          `SELECT id FROM agent_tickets WHERE status IN ('open', 'in_progress') AND category = $1 AND created_by = $2 LIMIT 1`,
          [category, agentName],
        );
        if (existing.rows.length === 0) {
          const tId = generateId();
          let assignTo: string | null = null;
          if (category === 'security') assignTo = 'Aegis';
          else if (category === 'performance' || category === 'optimization') assignTo = 'Oracle';
          else if (category === 'infrastructure' || category === 'infrastructure_status') assignTo = 'DevOps';
          else if (category === 'bug') assignTo = 'Backend Dev';
          else if (category === 'service_outage') assignTo = 'DevOps';
          if (!assignTo) assignTo = 'Nexus';

          try {
            await p.query(
              `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata)
               VALUES ($1, $2, $3, 'open', 'urgent', $4, $5, $6, $7, $8, true, 'agent', $9)`,
              [tId, `[CRITICAL] ${finding.substring(0, 100)}`, finding, category, agentName, assignTo, (args['agent_id'] as string) ?? null, agentName, JSON.stringify({ finding_id: id, auto_created: true })],
            );
            ticketId = tId;
          } catch { /* non-fatal */ }
        }
      }

      // Auto-store finding as semantic memory (only if valid agent_id provided)
      const findingAgentId = args['agent_id'] as string | undefined;
      if (findingAgentId) {
        try {
          const importanceMap: Record<string, number> = { critical: 1.0, warning: 0.7, info: 0.4 };
          const memId = generateId();
          await forgeQuery(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, source, importance, metadata, created_at, updated_at)
             VALUES ($1, $2, 'fleet:system', $3, 'finding', $4, $5, NOW(), NOW())`,
            [memId, findingAgentId, finding, importanceMap[severity] ?? 0.4, JSON.stringify({ source_type: 'finding', category, severity, agent_name: agentName, finding_id: id })],
          );
        } catch { /* non-fatal */ }
      }

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
// Proposal Ops Handler
// ============================================

async function handleProposalOps(args: Record<string, unknown>): Promise<string> {
  const fp = getForgePool();
  const action = args['action'] as string;

  switch (action) {
    case 'create': {
      const title = args['title'] as string | undefined;
      const proposalType = args['proposal_type'] as string | undefined;
      const authorAgentId = args['author_agent_id'] as string | undefined;
      if (!title) return JSON.stringify({ error: 'title is required' });
      if (!proposalType) return JSON.stringify({ error: 'proposal_type is required' });
      if (!authorAgentId) return JSON.stringify({ error: 'author_agent_id is required' });

      const validTypes = ['prompt_revision', 'code_change', 'config_change', 'schema_change'];
      if (!validTypes.includes(proposalType)) {
        return JSON.stringify({ error: `proposal_type must be one of: ${validTypes.join(', ')}` });
      }

      const id = generateId();
      const riskLevel = (args['risk_level'] as string) ?? 'low';
      const requiredReviews = (args['required_reviews'] as number) ?? 1;

      const result = await fp.query(
        `INSERT INTO forge_change_proposals (
          id, proposal_type, title, description, author_agent_id,
          prompt_revision_id, file_changes, config_changes,
          target_agent_id, status, required_reviews, risk_level,
          execution_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12)
        RETURNING id, proposal_type, title, status, risk_level, created_at`,
        [
          id, proposalType, title,
          (args['description'] as string) ?? null,
          authorAgentId,
          (args['prompt_revision_id'] as string) ?? null,
          JSON.stringify(args['file_changes'] ?? []),
          JSON.stringify(args['config_changes'] ?? {}),
          (args['target_agent_id'] as string) ?? null,
          requiredReviews,
          riskLevel,
          (args['execution_id'] as string) ?? null,
        ],
      );

      // Audit in forge DB
      try {
        await fp.query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, 'system:forge', $2, $3, $4, $5)`,
          [generateId(), 'proposal.created', 'proposal', id, JSON.stringify({ title, proposal_type: proposalType, risk_level: riskLevel, author_agent_id: authorAgentId })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({ created: true, proposal: result.rows[0] });
    }

    case 'submit': {
      const proposalId = args['proposal_id'] as string | undefined;
      if (!proposalId) return JSON.stringify({ error: 'proposal_id is required' });

      const existing = await fp.query(
        `SELECT id, status, title, author_agent_id FROM forge_change_proposals WHERE id = $1`,
        [proposalId],
      );
      if (existing.rows.length === 0) return JSON.stringify({ error: `Proposal not found: ${proposalId}` });
      const proposal = existing.rows[0] as Record<string, unknown>;

      if (proposal['status'] !== 'draft' && proposal['status'] !== 'revision_requested') {
        return JSON.stringify({ error: `Cannot submit proposal in status '${proposal['status']}'. Must be 'draft' or 'revision_requested'` });
      }

      const result = await fp.query(
        `UPDATE forge_change_proposals SET status = 'pending_review', updated_at = now()
         WHERE id = $1 RETURNING id, title, status, updated_at`,
        [proposalId],
      );

      try {
        await fp.query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, 'system:forge', $2, $3, $4, $5)`,
          [generateId(), 'proposal.submitted', 'proposal', proposalId, JSON.stringify({ title: proposal['title'], from_status: proposal['status'] })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({ submitted: true, proposal: result.rows[0] });
    }

    case 'review': {
      const proposalId = args['proposal_id'] as string | undefined;
      const reviewerAgentId = args['reviewer_agent_id'] as string | undefined;
      const verdict = args['verdict'] as string | undefined;
      if (!proposalId) return JSON.stringify({ error: 'proposal_id is required' });
      if (!reviewerAgentId) return JSON.stringify({ error: 'reviewer_agent_id is required' });
      if (!verdict) return JSON.stringify({ error: 'verdict is required' });

      const validVerdicts = ['approve', 'reject', 'request_changes', 'comment'];
      if (!validVerdicts.includes(verdict)) {
        return JSON.stringify({ error: `verdict must be one of: ${validVerdicts.join(', ')}` });
      }

      // Verify proposal exists and is pending review
      const existing = await fp.query(
        `SELECT id, status, title, required_reviews FROM forge_change_proposals WHERE id = $1`,
        [proposalId],
      );
      if (existing.rows.length === 0) return JSON.stringify({ error: `Proposal not found: ${proposalId}` });
      const proposal = existing.rows[0] as Record<string, unknown>;
      if (proposal['status'] !== 'pending_review') {
        return JSON.stringify({ error: `Cannot review proposal in status '${proposal['status']}'. Must be 'pending_review'` });
      }

      // Insert the review
      const reviewId = generateId();
      const reviewResult = await fp.query(
        `INSERT INTO forge_proposal_reviews (id, proposal_id, reviewer_agent_id, verdict, comment, suggestions, analysis)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, proposal_id, verdict, created_at`,
        [
          reviewId, proposalId, reviewerAgentId, verdict,
          (args['comment'] as string) ?? null,
          JSON.stringify(args['suggestions'] ?? []),
          JSON.stringify(args['analysis'] ?? {}),
        ],
      );

      // Check if verdict changes proposal status
      let newProposalStatus: string | null = null;
      if (verdict === 'reject') {
        newProposalStatus = 'rejected';
      } else if (verdict === 'request_changes') {
        newProposalStatus = 'revision_requested';
      } else if (verdict === 'approve') {
        // Count approvals to see if threshold met
        const approvals = await fp.query(
          `SELECT COUNT(*) as count FROM forge_proposal_reviews WHERE proposal_id = $1 AND verdict = 'approve'`,
          [proposalId],
        );
        const approvalCount = parseInt((approvals.rows[0] as Record<string, unknown>)['count'] as string, 10);
        if (approvalCount >= (proposal['required_reviews'] as number)) {
          newProposalStatus = 'approved';
        }
      }

      if (newProposalStatus) {
        await fp.query(
          `UPDATE forge_change_proposals SET status = $1, updated_at = now() WHERE id = $2`,
          [newProposalStatus, proposalId],
        );
      }

      try {
        await fp.query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, 'system:forge', $2, $3, $4, $5)`,
          [generateId(), 'proposal.reviewed', 'proposal', proposalId, JSON.stringify({ review_id: reviewId, verdict, reviewer: reviewerAgentId, new_status: newProposalStatus })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({
        reviewed: true,
        review: reviewResult.rows[0],
        proposal_status: newProposalStatus ?? proposal['status'],
      });
    }

    case 'list': {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (args['filter_status']) { params.push(args['filter_status']); conditions.push(`p.status = $${params.length}`); }
      if (args['filter_author']) { params.push(args['filter_author']); conditions.push(`p.author_agent_id = $${params.length}`); }
      if (args['filter_type']) { params.push(args['filter_type']); conditions.push(`p.proposal_type = $${params.length}`); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min((args['limit'] as number) ?? 20, 50);

      const result = await fp.query(
        `SELECT p.id, p.proposal_type, p.title, p.status, p.risk_level,
                p.author_agent_id, a.name as author_name,
                p.required_reviews, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id) as review_count,
                (SELECT COUNT(*) FROM forge_proposal_reviews r WHERE r.proposal_id = p.id AND r.verdict = 'approve') as approval_count
         FROM forge_change_proposals p
         LEFT JOIN forge_agents a ON a.id = p.author_agent_id
         ${where}
         ORDER BY CASE p.status
           WHEN 'pending_review' THEN 0
           WHEN 'draft' THEN 1
           WHEN 'revision_requested' THEN 2
           WHEN 'approved' THEN 3
           WHEN 'applied' THEN 4
           WHEN 'rejected' THEN 5
           WHEN 'closed' THEN 6
         END, p.created_at DESC
         LIMIT ${limit}`,
        params,
      );
      return JSON.stringify({ proposals: result.rows, count: result.rows.length });
    }

    case 'get': {
      const proposalId = args['proposal_id'] as string | undefined;
      if (!proposalId) return JSON.stringify({ error: 'proposal_id is required' });

      const proposalResult = await fp.query(
        `SELECT p.*, a.name as author_name, ta.name as target_agent_name
         FROM forge_change_proposals p
         LEFT JOIN forge_agents a ON a.id = p.author_agent_id
         LEFT JOIN forge_agents ta ON ta.id = p.target_agent_id
         WHERE p.id = $1`,
        [proposalId],
      );
      if (proposalResult.rows.length === 0) return JSON.stringify({ error: `Proposal not found: ${proposalId}` });

      const reviewsResult = await fp.query(
        `SELECT r.*, a.name as reviewer_name
         FROM forge_proposal_reviews r
         LEFT JOIN forge_agents a ON a.id = r.reviewer_agent_id
         WHERE r.proposal_id = $1
         ORDER BY r.created_at ASC`,
        [proposalId],
      );

      return JSON.stringify({
        proposal: proposalResult.rows[0],
        reviews: reviewsResult.rows,
      });
    }

    case 'apply': {
      const proposalId = args['proposal_id'] as string | undefined;
      if (!proposalId) return JSON.stringify({ error: 'proposal_id is required' });

      const existing = await fp.query(
        `SELECT id, status, title, risk_level FROM forge_change_proposals WHERE id = $1`,
        [proposalId],
      );
      if (existing.rows.length === 0) return JSON.stringify({ error: `Proposal not found: ${proposalId}` });
      const proposal = existing.rows[0] as Record<string, unknown>;

      if (proposal['status'] !== 'approved') {
        return JSON.stringify({ error: `Cannot apply proposal in status '${proposal['status']}'. Must be 'approved'` });
      }

      // For high/critical risk, check for checkpoint approval
      const riskLevel = proposal['risk_level'] as string;
      if (riskLevel === 'high' || riskLevel === 'critical') {
        // Check if a checkpoint exists and is approved
        const checkpoint = await fp.query(
          `SELECT id, status FROM forge_checkpoints WHERE owner_id = $1 AND status = 'approved'
           ORDER BY created_at DESC LIMIT 1`,
          [proposalId],
        );
        if (checkpoint.rows.length === 0) {
          return JSON.stringify({
            error: `High/critical risk proposal requires checkpoint approval. Create a checkpoint for this proposal first.`,
            needs_checkpoint: true,
            risk_level: riskLevel,
          });
        }
      }

      const result = await fp.query(
        `UPDATE forge_change_proposals SET status = 'applied', applied_at = now(), updated_at = now()
         WHERE id = $1 RETURNING id, title, status, applied_at`,
        [proposalId],
      );

      try {
        await fp.query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, 'system:forge', $2, $3, $4, $5)`,
          [generateId(), 'proposal.applied', 'proposal', proposalId, JSON.stringify({ title: proposal['title'], risk_level: riskLevel })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({ applied: true, proposal: result.rows[0] });
    }

    case 'revise': {
      const proposalId = args['proposal_id'] as string | undefined;
      if (!proposalId) return JSON.stringify({ error: 'proposal_id is required' });

      const existing = await fp.query(
        `SELECT id, status, title FROM forge_change_proposals WHERE id = $1`,
        [proposalId],
      );
      if (existing.rows.length === 0) return JSON.stringify({ error: `Proposal not found: ${proposalId}` });
      const proposal = existing.rows[0] as Record<string, unknown>;

      if (proposal['status'] !== 'draft' && proposal['status'] !== 'revision_requested') {
        return JSON.stringify({ error: `Cannot revise proposal in status '${proposal['status']}'. Must be 'draft' or 'revision_requested'` });
      }

      const setClauses: string[] = ['updated_at = now()'];
      const params: unknown[] = [];

      if (args['title']) { params.push(args['title']); setClauses.push(`title = $${params.length}`); }
      if (args['description']) { params.push(args['description']); setClauses.push(`description = $${params.length}`); }
      if (args['file_changes']) { params.push(JSON.stringify(args['file_changes'])); setClauses.push(`file_changes = $${params.length}`); }
      if (args['config_changes']) { params.push(JSON.stringify(args['config_changes'])); setClauses.push(`config_changes = $${params.length}`); }
      if (args['risk_level']) { params.push(args['risk_level']); setClauses.push(`risk_level = $${params.length}`); }

      if (params.length === 0) return JSON.stringify({ error: 'No fields to revise' });

      // Reset to draft after revision
      setClauses.push(`status = 'draft'`);
      params.push(proposalId);

      const result = await fp.query(
        `UPDATE forge_change_proposals SET ${setClauses.join(', ')} WHERE id = $${params.length}
         RETURNING id, title, status, updated_at`,
        params,
      );

      try {
        await fp.query(
          `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details)
           VALUES ($1, 'system:forge', $2, $3, $4, $5)`,
          [generateId(), 'proposal.revised', 'proposal', proposalId, JSON.stringify({ title: proposal['title'] })],
        );
      } catch { /* non-fatal */ }

      return JSON.stringify({ revised: true, proposal: result.rows[0] });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: create, submit, review, list, get, apply, revise` });
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
    case 'proposal_ops': return handleProposalOps(args);
    default: throw new Error(`Unknown workflow tool: ${name}`);
  }
}
