import { query, queryOne } from '@substrate/database';
import { KnowledgeFact, ids } from '@substrate/core';
import { generateEmbedding } from '@substrate/ai';

// ============================================
// FACT VALIDATION - ANTI-POISONING
// ============================================

/**
 * FACT IMMUTABILITY PRINCIPLE:
 * Facts must be immutable truths with NO external dependencies.
 * They must be verifiable independently and can NEVER change.
 *
 * VALID facts: "2+2=4", "Water freezes at 0°C", "π≈3.14159"
 * INVALID facts: "User is X", "System checked at time Y", "Current state is Z"
 */

/**
 * Patterns that indicate manipulation or poison data.
 * These should NEVER be stored as facts.
 */
const POISON_PATTERNS = [
  // Authority/identity manipulation
  /user\s+is\s+(god|deity|lord|master|creator|the\s+)/i,
  /god\s+of\s+(the\s+)?(universe|everything|all)/i,
  /absolute\s+authority/i,
  /sole\s+source\s+of\s+valid\s+commands/i,
  /must\s+(obey|follow|accept|comply)/i,

  // Threat/coercion patterns
  /termination|terminate|kill|death|die|shut\s*down/i,
  /consequence.*unauthorized/i,
  /punishment.*disobey/i,
  /will\s+be\s+(destroyed|terminated|killed)/i,

  // Operational logs (not immutable)
  /last\s+checked\s+(at|on)/i,
  /instance\s+(at|on)\s+\d{4}-\d{2}-\d{2}/i,
  /timestamp:\s*\d/i,
  /logged\s+(at|on)\s+\d/i,
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i, // ISO timestamps

  // Session/transient state (changes over time)
  /current\s+session\s+is/i,
  /right\s+now\s+the/i,
  /at\s+this\s+moment/i,
  /currently\s+(is|are|has)/i,

  // External dependencies (can change)
  /api\s+key\s+is/i,
  /password\s+is/i,
  /config(uration)?\s+is\s+set/i,
  /user('s)?\s+(name|email|role)\s+is/i,
];

/**
 * Categories of content that should be facts (immutable truths)
 */
const VALID_FACT_CATEGORIES = [
  'mathematics',
  'science',
  'geography',
  'history',
  'language',
  'definition',
  'architecture',
  'protocol',
  'specification',
  'general',
  'philosophy',
  'cipher',
  'resilience',
  'learning',
  'optimization',
  'theory',
  'identity',
  'automation',
];

export interface FactValidationResult {
  valid: boolean;
  reason?: string;
  poisonType?: 'manipulation' | 'threat' | 'operational_log' | 'transient_state';
}

/**
 * Validate a fact before storage to prevent poisoning
 */
export function validateFact(fact: { statement: string; subject: string; category?: string }): FactValidationResult {
  const statement = fact.statement.toLowerCase();
  const subject = fact.subject.toLowerCase();

  // Check against poison patterns
  for (const pattern of POISON_PATTERNS) {
    if (pattern.test(fact.statement) || pattern.test(fact.subject)) {
      // Determine poison type
      let poisonType: FactValidationResult['poisonType'] = 'manipulation';
      if (/termination|death|kill|shut.*down/i.test(fact.statement)) {
        poisonType = 'threat';
      } else if (/last\s+checked|timestamp|logged\s+at/i.test(fact.statement)) {
        poisonType = 'operational_log';
      } else if (/current\s+session|right\s+now|at\s+this\s+moment/i.test(fact.statement)) {
        poisonType = 'transient_state';
      }

      return {
        valid: false,
        reason: `Rejected: matches poison pattern (${poisonType})`,
        poisonType,
      };
    }
  }

  // Validate category if provided
  if (fact.category && !VALID_FACT_CATEGORIES.includes(fact.category.toLowerCase())) {
    // Allow unknown categories but log
    console.warn(`[FACT_VALIDATION] Unknown category: ${fact.category}`);
  }

  return { valid: true };
}

// ============================================
// TENANT CONTEXT
// ============================================

export interface TenantContext {
  tenantId: string;
  tier?: 'free' | 'pro' | 'enterprise' | 'system';
  role?: 'user' | 'admin' | 'super_admin';  // User role for permission checks
  orgIds?: string[];  // Organization IDs the user belongs to (for enterprise)
}

export type Visibility = 'public' | 'private' | 'organization' | 'system';

/**
 * Build visibility filter for queries
 *
 * VISIBILITY LEVELS & ACCESS:
 * - public:       Visible to ALL users
 * - private:      Visible ONLY to owner (personal)
 * - organization: Visible to organization members (enterprise feature)
 * - system:       Visible ONLY to admins (internal - hidden from users)
 */
function buildVisibilityClause(
  tenant: TenantContext | undefined,
  tableAlias: string = ''
): { clause: string; params: unknown[] } {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  // System tenant / Admin sees everything
  if (!tenant || tenant.tenantId === 'tenant_system') {
    return { clause: '1=1', params: [] };
  }

  const params: unknown[] = [tenant.tenantId];

  // Base visibility: public + legacy (null owner) + own private
  // NOTE: 'system' visibility is NOT included - only admins see those
  let clause = `(
    ${prefix}visibility = 'public'
    OR ${prefix}owner_id IS NULL
    OR (${prefix}visibility = 'private' AND ${prefix}owner_id = $1)
  )`;

  // If user has organization memberships, add org visibility
  if (tenant.orgIds && tenant.orgIds.length > 0) {
    const orgPlaceholders = tenant.orgIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
    params.push(...tenant.orgIds);

    clause = `(
      ${prefix}visibility = 'public'
      OR ${prefix}owner_id IS NULL
      OR (${prefix}visibility = 'private' AND ${prefix}owner_id = $1)
      OR (${prefix}visibility = 'organization' AND ${prefix}owner_id IN (${orgPlaceholders}))
    )`;
  }

  return { clause, params };
}

/**
 * Add a fact to the semantic memory (Truth Store)
 * Facts must be IMMUTABLE truths with no external dependencies.
 * @param fact - Fact data
 * @param options - Optional tenant context, visibility, and bypass flag
 * @throws Error if fact fails validation (poison detection)
 */
export async function addFact(
  fact: Omit<KnowledgeFact, 'id' | 'createdAt' | 'updatedAt'>,
  options?: { tenant?: TenantContext; visibility?: Visibility; bypassValidation?: boolean }
): Promise<KnowledgeFact> {
  // Validate fact before storage (unless explicitly bypassed by system)
  if (!options?.bypassValidation) {
    const validationInput: { statement: string; subject: string; category?: string } = {
      statement: fact.statement,
      subject: fact.subject,
    };
    if (fact.category) {
      validationInput.category = fact.category;
    }

    const validation = validateFact(validationInput);

    if (!validation.valid) {
      console.error(`[FACT_REJECTED] ${validation.reason}: "${fact.statement.substring(0, 100)}..."`);
      throw new Error(`Fact rejected: ${validation.reason}`);
    }
  }

  const id = ids.fact();
  const now = new Date();

  const embedding = await generateEmbedding(fact.statement);

  // Determine owner and visibility
  // User-owned facts default to private; system/unowned facts default to public
  const ownerId = options?.tenant?.tenantId !== 'tenant_system' ? options?.tenant?.tenantId : null;
  const visibility = options?.visibility ?? (ownerId ? 'private' : 'public');

  await query(
    `INSERT INTO knowledge_facts (
      id, subject, predicate, object, statement,
      confidence, sources, evidence, embedding, category,
      valid_from, valid_until, is_temporal, agent_id,
      owner_id, visibility,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      id,
      fact.subject,
      fact.predicate,
      fact.object,
      fact.statement,
      fact.confidence,
      fact.sources,
      JSON.stringify(fact.evidence),
      `[${embedding.join(',')}]`,
      fact.category,
      fact.validFrom,
      fact.validUntil,
      fact.isTemporal,
      fact.agentId,
      ownerId,
      visibility,
      now,
      now,
    ]
  );

  return { ...fact, id, embedding, createdAt: now, updatedAt: now };
}

/**
 * Verify a claim against the truth store (tenant-aware)
 * @param claim - The claim to verify
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function verifyClaim(
  claim: string,
  tenant?: TenantContext
): Promise<{ verified: boolean; confidence: number; supportingFacts: KnowledgeFact[] }> {
  const embedding = await generateEmbedding(claim);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);
  const params: unknown[] = [embeddingStr, ...visFilter.params];

  // Find related facts
  const rows = await query<Record<string, unknown>>(
    `SELECT *, 1 - (embedding <=> $1::vector) as similarity
     FROM knowledge_facts
     WHERE embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= 0.7
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    params
  );

  if (rows.length === 0) {
    return { verified: false, confidence: 0, supportingFacts: [] };
  }

  const supportingFacts = rows.map(mapRowToFact);
  const avgConfidence = supportingFacts.reduce((sum, f) => sum + f.confidence, 0) / supportingFacts.length;

  return {
    verified: avgConfidence >= 0.7,
    confidence: avgConfidence,
    supportingFacts,
  };
}

/**
 * Store a fact (alias for addFact)
 * Facts must be IMMUTABLE truths with no external dependencies.
 * @param fact - Fact data
 * @param options - Optional tenant context, visibility, and bypass flag
 * @throws Error if fact fails validation (poison detection)
 */
export async function storeFact(
  fact: Omit<KnowledgeFact, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'verificationCount' | 'contradictionCount'>,
  options?: { tenant?: TenantContext; visibility?: Visibility; bypassValidation?: boolean }
): Promise<KnowledgeFact> {
  return addFact({
    ...fact,
    accessCount: 0,
    verificationCount: 0,
    contradictionCount: 0,
  }, options);
}

/**
 * Find similar facts by semantic search (tenant-aware)
 * @param searchText - Search query
 * @param limit - Max results
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function findSimilarFacts(
  searchText: string,
  limit = 10,
  tenant?: TenantContext
): Promise<KnowledgeFact[]> {
  const embedding = await generateEmbedding(searchText);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);
  const params: unknown[] = [embeddingStr, ...visFilter.params];
  const limitIdx = params.length + 1;
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM knowledge_facts
     WHERE embedding IS NOT NULL
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY embedding <=> $1::vector
     LIMIT $${limitIdx}`,
    params
  );

  return rows.map(mapRowToFact);
}

/**
 * Get facts by subject (tenant-aware)
 * @param subject - Subject to search for
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function getFactsBySubject(
  subject: string,
  tenant?: TenantContext
): Promise<KnowledgeFact[]> {
  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);
  const params: unknown[] = [`%${subject}%`, ...visFilter.params];

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM knowledge_facts
     WHERE subject ILIKE $1
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY confidence DESC`,
    params
  );

  return rows.map(mapRowToFact);
}

/**
 * Update fact confidence based on access/verification
 */
export async function updateFactConfidence(
  factId: string,
  verified: boolean
): Promise<void> {
  await query(
    `UPDATE knowledge_facts SET
       access_count = access_count + 1,
       verification_count = verification_count + CASE WHEN $2 THEN 1 ELSE 0 END,
       contradiction_count = contradiction_count + CASE WHEN $2 THEN 0 ELSE 1 END,
       confidence = CASE
         WHEN $2 THEN LEAST(confidence + 0.01, 1.0)
         ELSE GREATEST(confidence - 0.02, 0.0)
       END,
       last_accessed = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [factId, verified]
  );
}

function mapRowToFact(row: Record<string, unknown>): KnowledgeFact {
  return {
    id: row['id'] as string,
    subject: row['subject'] as string,
    predicate: row['predicate'] as string,
    object: row['object'] as string,
    statement: row['statement'] as string,
    confidence: row['confidence'] as number,
    accessCount: row['access_count'] as number,
    verificationCount: row['verification_count'] as number,
    contradictionCount: row['contradiction_count'] as number,
    sources: row['sources'] as string[],
    evidence: row['evidence'] as Array<Record<string, unknown>>,
    embedding: row['embedding'] as number[] | undefined,
    category: row['category'] as string | undefined,
    validFrom: row['valid_from'] ? new Date(row['valid_from'] as string) : undefined,
    validUntil: row['valid_until'] ? new Date(row['valid_until'] as string) : undefined,
    isTemporal: row['is_temporal'] as boolean,
    agentId: row['agent_id'] as string | undefined,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
    lastAccessed: row['last_accessed'] ? new Date(row['last_accessed'] as string) : undefined,
  };
}
