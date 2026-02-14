import { ulid } from 'ulid';

/**
 * Generate a unique ID with optional prefix
 * Uses ULID for time-sortable, unique identifiers
 */
export function generateId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Generate IDs for specific entity types
 */
export const ids = {
  shard: () => generateId('shd'),
  trace: () => generateId('trc'),
  episode: () => generateId('epi'),
  fact: () => generateId('fct'),
  relation: () => generateId('rel'),
  context: () => generateId('ctx'),
  execution: () => generateId('exe'),
  evolution: () => generateId('evo'),
  event: () => generateId('evt'),
  session: () => generateId('ses'),
  message: () => generateId('msg'),
  agent: () => generateId('agt'),
  tenant: () => generateId('tenant'),
  apiKey: () => generateId('key'),
  fork: () => generateId('fork'),
  usage: () => generateId('usg'),
  error: () => generateId('err'),
} as const;
