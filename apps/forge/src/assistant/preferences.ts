/**
 * Preference Tracker
 * Learns and manages user preferences over time from interaction signals.
 * Preferences are stored as JSONB in the forge_user_assistants table and
 * include items like preferred model, provider, timezone, communication style, etc.
 */

import type pg from 'pg';

type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

type QueryOneFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T | null>;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Well-known preference keys. The JSONB column can hold arbitrary keys,
 * but these are the ones the system actively tracks and uses.
 */
export interface AssistantPreferences {
  preferredModel?: string;
  preferredProvider?: string;
  timezone?: string;
  language?: string;
  communicationStyle?: string;
  maxBudgetPerDay?: number;
  defaultAutonomyLevel?: number;
  enableNotifications?: boolean;
  [key: string]: unknown;
}

export interface InteractionSignal {
  category: string;
  value: unknown;
  timestamp: string;
}

interface UserAssistantPreferencesRow {
  preferences: AssistantPreferences;
  learned_patterns: InteractionSignal[];
}

// ── Preference tracker ──────────────────────────────────────────────────────

export class PreferenceTracker {
  private readonly query: QueryFn;
  private readonly queryOne: QueryOneFn;

  constructor(query: QueryFn, queryOne: QueryOneFn) {
    this.query = query;
    this.queryOne = queryOne;
  }

  /**
   * Record an interaction signal that may influence learned preferences.
   * Signals are appended to the learned_patterns JSONB array and can later
   * be aggregated to derive preference values.
   *
   * Common categories:
   *  - "model_choice"   : user explicitly chose a model
   *  - "provider_choice" : user explicitly chose a provider
   *  - "style_feedback"  : user gave feedback on communication style
   *  - "timezone_hint"   : detected timezone from interaction timestamp
   *  - "language_hint"   : detected language from user input
   */
  async trackInteraction(
    ownerId: string,
    category: string,
    value: unknown,
  ): Promise<void> {
    const signal: InteractionSignal = {
      category,
      value,
      timestamp: new Date().toISOString(),
    };

    // Append to learned_patterns array. We keep the last 200 signals to
    // prevent unbounded growth while retaining enough data for preference
    // inference.
    await this.query(
      `UPDATE forge_user_assistants
       SET learned_patterns = (
         SELECT jsonb_agg(elem)
         FROM (
           SELECT elem
           FROM jsonb_array_elements(
             learned_patterns || $1::jsonb
           ) AS elem
           ORDER BY elem->>'timestamp' DESC
           LIMIT 200
         ) sub
       )
       WHERE owner_id = $2`,
      [JSON.stringify(signal), ownerId],
    );
  }

  /**
   * Get the current preferences for the owner.
   * Returns the preferences JSONB object from forge_user_assistants.
   */
  async getPreferences(ownerId: string): Promise<AssistantPreferences | null> {
    const row = await this.queryOne<UserAssistantPreferencesRow>(
      `SELECT preferences, learned_patterns
       FROM forge_user_assistants
       WHERE owner_id = $1`,
      [ownerId],
    );

    if (!row) {
      return null;
    }

    return row.preferences;
  }

  /**
   * Update a single preference key. This performs a targeted JSONB merge
   * on the preferences column, preserving all other keys.
   */
  async updatePreference(
    ownerId: string,
    key: string,
    value: unknown,
  ): Promise<AssistantPreferences | null> {
    const patch: Record<string, unknown> = {};
    patch[key] = value;

    const row = await this.queryOne<UserAssistantPreferencesRow>(
      `UPDATE forge_user_assistants
       SET preferences = preferences || $1::jsonb
       WHERE owner_id = $2
       RETURNING preferences, learned_patterns`,
      [JSON.stringify(patch), ownerId],
    );

    if (!row) {
      return null;
    }

    return row.preferences;
  }

  /**
   * Replace all preferences at once. Useful for bulk settings updates
   * from a UI preferences panel.
   */
  async setPreferences(
    ownerId: string,
    preferences: AssistantPreferences,
  ): Promise<AssistantPreferences | null> {
    const row = await this.queryOne<UserAssistantPreferencesRow>(
      `UPDATE forge_user_assistants
       SET preferences = $1::jsonb
       WHERE owner_id = $2
       RETURNING preferences, learned_patterns`,
      [JSON.stringify(preferences), ownerId],
    );

    if (!row) {
      return null;
    }

    return row.preferences;
  }

  /**
   * Retrieve the raw interaction signals (learned_patterns) for analysis.
   * Optionally filter by category.
   */
  async getInteractionSignals(
    ownerId: string,
    category?: string,
  ): Promise<InteractionSignal[]> {
    const row = await this.queryOne<UserAssistantPreferencesRow>(
      `SELECT preferences, learned_patterns
       FROM forge_user_assistants
       WHERE owner_id = $1`,
      [ownerId],
    );

    if (!row) {
      return [];
    }

    const patterns: InteractionSignal[] = Array.isArray(row.learned_patterns)
      ? row.learned_patterns
      : [];

    if (category !== undefined) {
      return patterns.filter((s) => s.category === category);
    }

    return patterns;
  }
}
