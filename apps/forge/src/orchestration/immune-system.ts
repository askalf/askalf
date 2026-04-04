/**
 * The Immune System — Self-Healing Response Teams
 *
 * When something breaks, the fleet doesn't just detect it — it forms a
 * coordinated response team. Like white blood cells converging on an infection.
 *
 * Detection → Triage → Mobilize → Fix → Verify → Immunize
 *
 * After fixing, the system creates "antibodies" — procedural memories that
 * prevent the same issue from happening again.
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';
import { sendAgentMessage, emitSignal } from './nervous-system.js';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'detected' | 'triaging' | 'responding' | 'fixing' | 'verifying' | 'resolved' | 'immunized';

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detected_by: string;
  trigger: string;           // what triggered the detection
  response_team: string[];   // agent names assigned
  timeline: IncidentEvent[];
  antibody_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface IncidentEvent {
  timestamp: string;
  agent: string;
  action: string;
  detail: string;
}

// Active incidents in memory (persisted to DB)
const activeIncidents = new Map<string, Incident>();

/**
 * Detect and create an incident. Called by Watchdog or any monitor agent.
 */
export async function createIncident(
  title: string,
  severity: IncidentSeverity,
  detectedBy: string,
  trigger: string,
): Promise<Incident> {
  // Check for duplicate — don't create if same title is already active
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM agent_incidents WHERE title = $1 AND status NOT IN ('resolved', 'immunized') LIMIT 1`,
    [title],
  );
  if (existing) {
    const cached = activeIncidents.get(existing.id);
    if (cached) return cached;
  }

  const id = ulid();
  const now = new Date().toISOString();
  const incident: Incident = {
    id, title, severity, status: 'detected',
    detected_by: detectedBy, trigger,
    response_team: [],
    timeline: [{ timestamp: now, agent: detectedBy, action: 'detected', detail: trigger }],
    antibody_id: null,
    created_at: now, resolved_at: null,
  };

  await query(
    `INSERT INTO agent_incidents (id, title, severity, status, detected_by, trigger, response_team, timeline, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [id, title, severity, 'detected', detectedBy, trigger, JSON.stringify([]), JSON.stringify(incident.timeline)],
  );

  activeIncidents.set(id, incident);
  console.log(`[ImmuneSystem] INCIDENT ${severity.toUpperCase()}: ${title} (detected by ${detectedBy})`);

  // Auto-triage and mobilize
  await triageIncident(incident);

  return incident;
}

/**
 * Triage: determine which agents to mobilize based on incident type.
 */
async function triageIncident(incident: Incident): Promise<void> {
  incident.status = 'triaging';

  // Determine response team based on severity and trigger keywords
  const team: string[] = [];
  const trigger = incident.trigger.toLowerCase();

  // Always include Builder for fixes
  team.push('Builder');

  // Route specialists based on what's broken
  if (trigger.includes('security') || trigger.includes('cve') || trigger.includes('vulnerability')) {
    team.push('Security');
  }
  if (trigger.includes('container') || trigger.includes('docker') || trigger.includes('health')) {
    team.push('Watchdog');
  }
  if (trigger.includes('cost') || trigger.includes('budget') || trigger.includes('expensive')) {
    team.push('Cost Optimizer');
  }
  if (trigger.includes('discord') || trigger.includes('community')) {
    team.push('AskAlf Discord Manager');
  }
  if (trigger.includes('github') || trigger.includes('pr') || trigger.includes('issue')) {
    team.push('AskAlf GitHub Manager');
  }
  if (trigger.includes('database') || trigger.includes('postgres') || trigger.includes('query')) {
    team.push('Backup Agent');
  }

  // Critical incidents always get Fleet Chief
  if (incident.severity === 'critical' || incident.severity === 'high') {
    team.push('Fleet Chief');
  }

  incident.response_team = [...new Set(team)];
  incident.status = 'responding';

  // Update DB
  await query(
    `UPDATE agent_incidents SET status = 'responding', response_team = $1, timeline = $2 WHERE id = $3`,
    [JSON.stringify(incident.response_team), JSON.stringify([...incident.timeline, {
      timestamp: new Date().toISOString(),
      agent: 'ImmuneSystem',
      action: 'mobilized',
      detail: `Response team: ${incident.response_team.join(', ')}`,
    }]), incident.id],
  );

  // Notify each team member via the nervous system
  for (const agentName of incident.response_team) {
    await sendAgentMessage(
      'ImmuneSystem', agentName, 'request',
      `INCIDENT: ${incident.title}`,
      `Severity: ${incident.severity}\nTrigger: ${incident.trigger}\nYou are part of the response team: ${incident.response_team.join(', ')}\nCoordinate with the team to resolve this.`,
      { incident_id: incident.id, severity: incident.severity },
      incident.severity === 'critical' ? 1.0 : incident.severity === 'high' ? 0.9 : 0.7,
      true,
    );
  }

  // Create a ticket for Builder to fix
  await query(
    `INSERT INTO agent_tickets (id, title, description, status, priority, assigned_to, agent_name, source, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, 'Builder', $5, 'immune_system', 'selfhosted', NOW(), NOW())`,
    [
      `INC-${incident.id.substring(0, 8)}`,
      `[INCIDENT] ${incident.title}`,
      `Severity: ${incident.severity}\nDetected by: ${incident.detected_by}\nTrigger: ${incident.trigger}\nResponse team: ${incident.response_team.join(', ')}`,
      incident.severity === 'critical' ? 'urgent' : incident.severity === 'high' ? 'high' : 'medium',
      incident.detected_by,
    ],
  );

  // Emit urgency signal
  await emitSignal('immune-system', 'ImmuneSystem', 'urgency',
    incident.severity === 'critical' ? 1.0 : incident.severity === 'high' ? 0.8 : 0.5,
    `Incident: ${incident.title}`,
  );

  console.log(`[ImmuneSystem] Mobilized ${incident.response_team.length} agents for: ${incident.title}`);
}

/**
 * Record a resolution action on an incident.
 */
export async function recordAction(
  incidentId: string,
  agentName: string,
  action: string,
  detail: string,
): Promise<void> {
  const incident = activeIncidents.get(incidentId);
  if (!incident) return;

  incident.timeline.push({
    timestamp: new Date().toISOString(),
    agent: agentName, action, detail,
  });

  await query(
    `UPDATE agent_incidents SET timeline = $1 WHERE id = $2`,
    [JSON.stringify(incident.timeline), incidentId],
  );
}

/**
 * Resolve an incident and create an antibody.
 */
export async function resolveIncident(
  incidentId: string,
  resolvedBy: string,
  resolution: string,
): Promise<void> {
  const incident = activeIncidents.get(incidentId);
  if (!incident) return;

  incident.status = 'resolved';
  incident.resolved_at = new Date().toISOString();

  incident.timeline.push({
    timestamp: incident.resolved_at,
    agent: resolvedBy, action: 'resolved', detail: resolution,
  });

  await query(
    `UPDATE agent_incidents SET status = 'resolved', resolved_at = NOW(), timeline = $1 WHERE id = $2`,
    [JSON.stringify(incident.timeline), incidentId],
  );

  console.log(`[ImmuneSystem] RESOLVED: ${incident.title} by ${resolvedBy}`);

  // Create antibody — procedural memory that prevents recurrence
  await createAntibody(incident, resolution);
}

/**
 * Create an antibody — a procedural memory that prevents the same issue.
 */
async function createAntibody(incident: Incident, resolution: string): Promise<void> {
  const antibodyId = ulid();

  // Store as procedural memory
  await query(
    `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, tenant_id, trigger_pattern, tool_sequence, success_count, confidence, metadata)
     VALUES ($1, 'immune-system', 'selfhosted-admin', 'selfhosted', $2, $3, 1, 0.8, $4)`,
    [
      antibodyId,
      `Incident pattern: ${incident.trigger}`,
      JSON.stringify({
        detection: incident.trigger,
        response_team: incident.response_team,
        resolution,
        severity: incident.severity,
      }),
      JSON.stringify({
        type: 'antibody',
        incident_id: incident.id,
        created_at: new Date().toISOString(),
      }),
    ],
  );

  // Update incident with antibody reference
  incident.antibody_id = antibodyId;
  incident.status = 'immunized';
  await query(
    `UPDATE agent_incidents SET status = 'immunized', antibody_id = $1, timeline = $2 WHERE id = $3`,
    [antibodyId, JSON.stringify([...incident.timeline, {
      timestamp: new Date().toISOString(),
      agent: 'ImmuneSystem',
      action: 'immunized',
      detail: `Antibody created: ${antibodyId}`,
    }]), incident.id],
  );

  // Broadcast to fleet — "this pattern is now protected"
  await sendAgentMessage(
    'ImmuneSystem', null, 'inform',
    `Antibody created for: ${incident.title}`,
    `Pattern: ${incident.trigger}\nResolution: ${resolution}\nThis issue should not recur. If it does, the antibody confidence will increase.`,
    { antibody_id: antibodyId, incident_id: incident.id },
    0.3, false,
  );

  activeIncidents.delete(incident.id);
  console.log(`[ImmuneSystem] ANTIBODY created: ${incident.trigger.substring(0, 60)} → ${resolution.substring(0, 60)}`);
}

/**
 * Check if an antibody exists for a given trigger pattern.
 * Called before creating new incidents to prevent duplicates.
 */
export async function checkAntibody(trigger: string): Promise<{ exists: boolean; resolution?: string }> {
  const antibody = await queryOne<{ trigger_pattern: string; tool_sequence: string }>(
    `SELECT trigger_pattern, tool_sequence::text FROM forge_procedural_memories
     WHERE metadata->>'type' = 'antibody' AND trigger_pattern ILIKE $1
     ORDER BY confidence DESC LIMIT 1`,
    [`%${trigger.substring(0, 50)}%`],
  );

  if (antibody) {
    // Strengthen the antibody (it matched again)
    await query(
      `UPDATE forge_procedural_memories SET success_count = success_count + 1, confidence = LEAST(confidence + 0.05, 1.0)
       WHERE trigger_pattern = $1 AND metadata->>'type' = 'antibody'`,
      [antibody.trigger_pattern],
    );

    try {
      const seq = JSON.parse(antibody.tool_sequence);
      return { exists: true, resolution: seq.resolution };
    } catch {
      return { exists: true };
    }
  }

  return { exists: false };
}

/**
 * Get active incidents.
 */
export async function getActiveIncidents(): Promise<Incident[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM agent_incidents WHERE status NOT IN ('resolved', 'immunized') ORDER BY created_at DESC LIMIT 20`,
  );
  return rows.map(r => ({
    id: r['id'] as string,
    title: r['title'] as string,
    severity: r['severity'] as IncidentSeverity,
    status: r['status'] as IncidentStatus,
    detected_by: r['detected_by'] as string,
    trigger: r['trigger'] as string,
    response_team: (r['response_team'] as string[]) || [],
    timeline: (r['timeline'] as IncidentEvent[]) || [],
    antibody_id: r['antibody_id'] as string | null,
    created_at: r['created_at'] as string,
    resolved_at: r['resolved_at'] as string | null,
  }));
}

/**
 * Get incident stats for the dashboard.
 */
export async function getIncidentStats(): Promise<{
  active: number;
  resolved_24h: number;
  antibodies: number;
  avg_resolution_min: number;
}> {
  const [active, resolved, antibodies, avgTime] = await Promise.all([
    queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_incidents WHERE status NOT IN ('resolved', 'immunized')`),
    queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_incidents WHERE status IN ('resolved', 'immunized') AND resolved_at > NOW() - INTERVAL '24 hours'`),
    queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_procedural_memories WHERE metadata->>'type' = 'antibody'`),
    queryOne<{ avg_min: string }>(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60))::text as avg_min FROM agent_incidents WHERE resolved_at IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'`),
  ]);

  return {
    active: parseInt(active?.count || '0'),
    resolved_24h: parseInt(resolved?.count || '0'),
    antibodies: parseInt(antibodies?.count || '0'),
    avg_resolution_min: parseInt(avgTime?.avg_min || '0'),
  };
}
