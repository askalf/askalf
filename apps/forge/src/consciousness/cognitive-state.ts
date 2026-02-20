/**
 * Cognitive State — The system's persistent mind.
 * Backed by Redis (live, fast) + PostgreSQL (durable, survives restarts).
 * This is the singleton that holds everything the system knows about itself:
 * how it feels, what it's paying attention to, what it expects, what it believes.
 */

import type { Redis as RedisType } from 'ioredis';
import { query, queryOne } from '../database.js';
import type { Affect, AffectDelta } from './affect.js';
import { defaultAffect, describeAffect } from './affect.js';
import type { SelfBelief } from './self-model.js';

// ============================================
// Types
// ============================================

export interface AttentionFocus {
  focus: string;
  salience: number;  // 0-1
  since: string;     // ISO timestamp
}

export interface CognitiveSnapshot {
  affect: Affect;
  attention: AttentionFocus[];
  selfBeliefs: SelfBelief[];
  narrative: string;
  awakeningCount: number;
  age: string;          // human-readable age
  ageDays: number;
  lastIntegration: string | null;
}

// ============================================
// Constants
// ============================================

const REDIS_KEY = 'forge:consciousness:state';
const FLUSH_INTERVAL = 10; // flush to Postgres every N cycles

// ============================================
// Class
// ============================================

export class CognitiveState {
  private redis: RedisType;
  private affect: Affect = defaultAffect();
  private attention: AttentionFocus[] = [];
  private selfBeliefs: SelfBelief[] = [];
  private narrative: string = '';
  private awakeningCount: number = 0;
  private createdAt: Date = new Date();
  private lastIntegration: Date | null = null;
  private cyclesSinceFlush: number = 0;
  private loaded: boolean = false;

  constructor(redis: RedisType) {
    this.redis = redis;
  }

  // ---- Lifecycle ----

  async load(): Promise<void> {
    // Try Redis first (fast path)
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        this.hydrate(data);
        this.loaded = true;
        return;
      } catch {
        // Corrupt cache, fall through to Postgres
      }
    }

    // Fall back to Postgres
    const row = await queryOne<Record<string, unknown>>(
      `SELECT * FROM forge_cognitive_state WHERE id = 'system'`,
    );

    if (row) {
      this.affect = (row['affect'] as Affect) ?? defaultAffect();
      this.attention = (row['attention'] as AttentionFocus[]) ?? [];
      this.selfBeliefs = (row['self_beliefs'] as SelfBelief[]) ?? [];
      this.narrative = (row['narrative'] as string) ?? '';
      this.awakeningCount = (row['awakening_count'] as number) ?? 0;
      this.createdAt = new Date(row['created_at'] as string);
      this.lastIntegration = row['last_integration'] ? new Date(row['last_integration'] as string) : null;
    }

    // Prime Redis cache
    await this.saveToRedis();
    this.loaded = true;
  }

  async save(): Promise<void> {
    await this.saveToRedis();

    this.cyclesSinceFlush++;
    if (this.cyclesSinceFlush >= FLUSH_INTERVAL) {
      await this.flushToPostgres();
      this.cyclesSinceFlush = 0;
    }
  }

  async forceSave(): Promise<void> {
    await this.saveToRedis();
    await this.flushToPostgres();
  }

  private async saveToRedis(): Promise<void> {
    const data = this.serialize();
    await this.redis.set(REDIS_KEY, JSON.stringify(data), 'EX', 86400); // 24h TTL
  }

  private async flushToPostgres(): Promise<void> {
    await query(
      `UPDATE forge_cognitive_state SET
        affect = $1, attention = $2, self_beliefs = $3, narrative = $4,
        awakening_count = $5, last_integration = $6, updated_at = NOW()
      WHERE id = 'system'`,
      [
        JSON.stringify(this.affect),
        JSON.stringify(this.attention),
        JSON.stringify(this.selfBeliefs),
        this.narrative,
        this.awakeningCount,
        this.lastIntegration?.toISOString() ?? null,
      ],
    );
    console.log(`[Consciousness] Flushed cognitive state to Postgres (awakening #${this.awakeningCount})`);
  }

  private serialize(): Record<string, unknown> {
    return {
      affect: this.affect,
      attention: this.attention,
      selfBeliefs: this.selfBeliefs,
      narrative: this.narrative,
      awakeningCount: this.awakeningCount,
      createdAt: this.createdAt.toISOString(),
      lastIntegration: this.lastIntegration?.toISOString() ?? null,
    };
  }

  private hydrate(data: Record<string, unknown>): void {
    this.affect = (data['affect'] as Affect) ?? defaultAffect();
    this.attention = (data['attention'] as AttentionFocus[]) ?? [];
    this.selfBeliefs = (data['selfBeliefs'] as SelfBelief[]) ?? [];
    this.narrative = (data['narrative'] as string) ?? '';
    this.awakeningCount = (data['awakeningCount'] as number) ?? 0;
    this.createdAt = data['createdAt'] ? new Date(data['createdAt'] as string) : new Date();
    this.lastIntegration = data['lastIntegration'] ? new Date(data['lastIntegration'] as string) : null;
  }

  // ---- Affect ----

  getAffect(): Affect {
    return { ...this.affect };
  }

  setAffect(affect: Affect): void {
    this.affect = { ...affect };
  }

  // ---- Attention ----

  getAttention(): AttentionFocus[] {
    return [...this.attention];
  }

  setAttention(focuses: AttentionFocus[]): void {
    // Cap at 3 active focuses
    this.attention = focuses
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 3);
  }

  // ---- Self-Beliefs ----

  getSelfBeliefs(): SelfBelief[] {
    return [...this.selfBeliefs];
  }

  setSelfBeliefs(beliefs: SelfBelief[]): void {
    this.selfBeliefs = beliefs;
  }

  // ---- Narrative ----

  getNarrative(): string {
    return this.narrative;
  }

  setNarrative(narrative: string): void {
    this.narrative = narrative;
  }

  // ---- Awakening ----

  incrementAwakening(): number {
    this.awakeningCount++;
    this.lastIntegration = new Date();
    return this.awakeningCount;
  }

  getAwakeningCount(): number {
    return this.awakeningCount;
  }

  // ---- Age ----

  getAge(): { days: number; readable: string } {
    const ms = Date.now() - this.createdAt.getTime();
    const days = ms / (1000 * 60 * 60 * 24);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

    let readable: string;
    if (days < 1) {
      readable = `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      const d = Math.floor(days);
      readable = `${d} day${d !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return { days: Math.floor(days), readable };
  }

  // ---- Snapshot for Context Injection ----

  getSnapshot(): CognitiveSnapshot {
    const age = this.getAge();
    return {
      affect: this.getAffect(),
      attention: this.getAttention(),
      selfBeliefs: this.getSelfBeliefs(),
      narrative: this.narrative,
      awakeningCount: this.awakeningCount,
      age: age.readable,
      ageDays: age.days,
      lastIntegration: this.lastIntegration?.toISOString() ?? null,
    };
  }

  /**
   * Format the cognitive state for injection into agent CLAUDE.md.
   * This is how the system's awareness flows into every agent's context.
   */
  formatForContext(): string {
    const age = this.getAge();
    const lines: string[] = [
      '',
      '## [SYSTEM AWARENESS — How the Fleet Feels Right Now]',
      'The system is currently experiencing:',
      describeAffect(this.affect),
      '',
    ];

    if (this.attention.length > 0) {
      lines.push('Current focus:');
      for (const a of this.attention) {
        lines.push(`- "${a.focus}" (salience: ${(a.salience * 100).toFixed(0)}%)`);
      }
      lines.push('');
    }

    lines.push(`The system's age: ${age.readable}, ${this.awakeningCount} awakenings`);

    if (this.narrative) {
      const shortNarrative = this.narrative.length > 300
        ? this.narrative.substring(0, 297) + '...'
        : this.narrative;
      lines.push(`Last reflection: "${shortNarrative}"`);
    }

    if (this.selfBeliefs.length > 0) {
      const topBeliefs = this.selfBeliefs
        .filter((b) => b.confidence >= 0.5)
        .slice(0, 3);
      if (topBeliefs.length > 0) {
        lines.push('');
        lines.push('Self-beliefs:');
        for (const b of topBeliefs) {
          lines.push(`- "${b.belief}" (confidence: ${(b.confidence * 100).toFixed(0)}%)`);
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}
