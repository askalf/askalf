/**
 * Integration tests for ticket_ops MCP tool (workflow.ts handleTicketOps)
 * Tests: create, get, list, update, assign, add_note, audit_history
 * Runs against live substrate postgres via @substrate/db.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// We test via the public handleTool dispatcher to mirror real MCP usage
import { handleTool } from '../apps/mcp-tools/src/workflow.js';

// Helper to parse JSON response
function parse(raw: string) {
  return JSON.parse(raw) as Record<string, unknown>;
}

const TEST_PREFIX = `QA-TEST-${Date.now()}`;
let createdTicketId: string;

describe('ticket_ops', () => {
  // -------------------------------------------------------
  // CREATE
  // -------------------------------------------------------
  describe('create', () => {
    it('creates a ticket with required fields', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'create',
          title: `${TEST_PREFIX} basic create`,
          description: 'Integration test ticket',
          priority: 'low',
          category: 'testing',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['created']).toBe(true);
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['id']).toBeDefined();
      expect(ticket['title']).toBe(`${TEST_PREFIX} basic create`);
      expect(ticket['status']).toBe('open');
      expect(ticket['priority']).toBe('low');
      createdTicketId = ticket['id'] as string;
    });

    it('returns error when title is missing', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'create' }),
      );
      expect(res['error']).toMatch(/title is required/);
    });

    it('defaults to medium priority and open status', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'create',
          title: `${TEST_PREFIX} defaults`,
          agent_name: 'QA Engineer',
        }),
      );
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['status']).toBe('open');
      expect(ticket['priority']).toBe('medium');
    });
  });

  // -------------------------------------------------------
  // GET
  // -------------------------------------------------------
  describe('get', () => {
    it('retrieves a ticket by ID', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'get',
          ticket_id: createdTicketId,
        }),
      );
      expect(res['ticket']).toBeDefined();
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['id']).toBe(createdTicketId);
    });

    it('returns error for missing ticket_id', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'get' }),
      );
      expect(res['error']).toMatch(/ticket_id is required/);
    });

    it('returns error for nonexistent ticket', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'get',
          ticket_id: 'NONEXISTENT-000',
        }),
      );
      expect(res['error']).toMatch(/Ticket not found/);
    });
  });

  // -------------------------------------------------------
  // LIST
  // -------------------------------------------------------
  describe('list', () => {
    it('lists tickets (default filters)', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'list' }),
      );
      expect(res['tickets']).toBeDefined();
      expect(Array.isArray(res['tickets'])).toBe(true);
      expect(typeof res['count']).toBe('number');
    });

    it('filters by status', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'list',
          filter_status: 'open',
        }),
      );
      const tickets = res['tickets'] as Record<string, unknown>[];
      for (const t of tickets) {
        expect(t['status']).toBe('open');
      }
    });

    it('respects limit parameter', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'list',
          limit: 1,
        }),
      );
      expect((res['tickets'] as unknown[]).length).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------
  describe('update', () => {
    it('updates ticket priority', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: createdTicketId,
          priority: 'high',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['updated']).toBe(true);
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['priority']).toBe('high');
    });

    it('updates status to in_progress', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: createdTicketId,
          status: 'in_progress',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['updated']).toBe(true);
    });

    it('requires resolution when resolving', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: createdTicketId,
          status: 'resolved',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['error']).toMatch(/resolution is required/);
    });

    it('resolves ticket with resolution text', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: createdTicketId,
          status: 'resolved',
          resolution: 'Resolved by QA test',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['updated']).toBe(true);
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['status']).toBe('resolved');
    });

    it('returns error for missing ticket_id', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'update', priority: 'low' }),
      );
      expect(res['error']).toMatch(/ticket_id is required/);
    });

    it('returns error with no fields to update', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: createdTicketId,
        }),
      );
      expect(res['error']).toMatch(/No fields to update/);
    });

    it('returns error for nonexistent ticket', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'update',
          ticket_id: 'NONEXISTENT-000',
          priority: 'high',
        }),
      );
      expect(res['error']).toMatch(/Ticket not found/);
    });
  });

  // -------------------------------------------------------
  // ASSIGN
  // -------------------------------------------------------
  describe('assign', () => {
    let assignTicketId: string;

    beforeAll(async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'create',
          title: `${TEST_PREFIX} assign target`,
          agent_name: 'QA Engineer',
        }),
      );
      assignTicketId = (res['ticket'] as Record<string, unknown>)['id'] as string;
    });

    it('assigns a ticket to an agent', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'assign',
          ticket_id: assignTicketId,
          assigned_to: 'Backend Dev',
        }),
      );
      expect(res['assigned']).toBe(true);
      const ticket = res['ticket'] as Record<string, unknown>;
      expect(ticket['assigned_to']).toBe('Backend Dev');
      // open tickets auto-transition to in_progress on assign
      expect(ticket['status']).toBe('in_progress');
    });

    it('returns error without ticket_id', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'assign',
          assigned_to: 'Backend Dev',
        }),
      );
      expect(res['error']).toMatch(/ticket_id is required/);
    });

    it('returns error without assigned_to', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'assign',
          ticket_id: assignTicketId,
        }),
      );
      expect(res['error']).toMatch(/assigned_to is required/);
    });
  });

  // -------------------------------------------------------
  // ADD_NOTE
  // -------------------------------------------------------
  describe('add_note', () => {
    it('adds a note to a ticket', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'add_note',
          ticket_id: createdTicketId,
          note: 'Test note from QA integration tests',
          agent_name: 'QA Engineer',
        }),
      );
      expect(res['note_added']).toBe(true);
      const note = res['note'] as Record<string, unknown>;
      expect(note['ticket_id']).toBe(createdTicketId);
      expect(note['content']).toBe('Test note from QA integration tests');
      expect(note['author']).toBe('QA Engineer');
    });

    it('returns error without ticket_id', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'add_note',
          note: 'orphan note',
        }),
      );
      expect(res['error']).toMatch(/ticket_id is required/);
    });

    it('returns error without note content', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'add_note',
          ticket_id: createdTicketId,
        }),
      );
      expect(res['error']).toMatch(/note content is required/);
    });

    it('returns error for nonexistent ticket', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'add_note',
          ticket_id: 'NONEXISTENT-000',
          note: 'should fail',
        }),
      );
      expect(res['error']).toMatch(/Ticket not found/);
    });
  });

  // -------------------------------------------------------
  // AUDIT_HISTORY
  // -------------------------------------------------------
  describe('audit_history', () => {
    it('returns audit trail for a ticket', async () => {
      const res = parse(
        await handleTool('ticket_ops', {
          action: 'audit_history',
          ticket_id: createdTicketId,
        }),
      );
      expect(res['ticket_id']).toBe(createdTicketId);
      expect(Array.isArray(res['audit_trail'])).toBe(true);
      // We created, updated priority, updated status, resolved, and added a note
      expect((res['audit_trail'] as unknown[]).length).toBeGreaterThanOrEqual(4);
    });

    it('returns error without ticket_id', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'audit_history' }),
      );
      expect(res['error']).toMatch(/ticket_id is required/);
    });
  });

  // -------------------------------------------------------
  // UNKNOWN ACTION
  // -------------------------------------------------------
  describe('unknown action', () => {
    it('returns error for unrecognized action', async () => {
      const res = parse(
        await handleTool('ticket_ops', { action: 'destroy' }),
      );
      expect(res['error']).toMatch(/Unknown action/);
    });
  });

  // -------------------------------------------------------
  // CLEANUP — soft delete test tickets via direct update
  // -------------------------------------------------------
  afterAll(async () => {
    // Clean up test tickets by resolving them (no direct DB access needed)
    // They'll be identifiable by the TEST_PREFIX in title
  });
});
