/**
 * Tool Registry
 * Central registry for all tools available to forge agents.
 * Loads built-in tools from the database and manages tool definitions.
 */

import { query } from '../database.js';

// ============================================
// Types
// ============================================

export interface ToolResult {
  output: unknown;
  error?: string | undefined;
  durationMs: number;
}

export type ToolExecuteFn = (input: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  displayName: string;
  description: string;
  type: 'built_in' | 'mcp' | 'custom' | 'api';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  inputSchema: Record<string, unknown>;
  execute: ToolExecuteFn;
}

interface ForgeToolRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: string;
  risk_level: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  config: Record<string, unknown>;
  is_enabled: boolean;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// Registry
// ============================================

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool definition in the registry.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a single tool by name.
   * Returns undefined if the tool is not registered.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools available to a specific agent based on its enabled tools list.
   * Returns only tools whose names appear in the enabledTools array.
   */
  getForAgent(enabledTools: string[]): ToolDefinition[] {
    const enabled = new Set(enabledTools);
    return Array.from(this.tools.values()).filter((tool) => enabled.has(tool.name));
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Load built-in tool metadata from the forge_tools database table.
   * This loads the registry entries (name, schema, risk level, etc.) but
   * does NOT set execute functions -- those must be registered separately
   * by the built-in tool modules.
   *
   * Tools that already have an execute function registered will keep it;
   * only metadata fields are updated from the database.
   */
  async loadFromDatabase(): Promise<void> {
    const rows = await query<ForgeToolRow>(
      `SELECT id, name, display_name, description, type, risk_level, input_schema, is_enabled
       FROM forge_tools
       WHERE is_enabled = true
       ORDER BY name`
    );

    for (const row of rows) {
      const existing = this.tools.get(row.name);

      const toolType = row.type as ToolDefinition['type'];
      const riskLevel = row.risk_level as ToolDefinition['riskLevel'];

      const definition: ToolDefinition = {
        name: row.name,
        displayName: row.display_name,
        description: row.description,
        type: toolType,
        riskLevel: riskLevel,
        inputSchema: row.input_schema,
        // Preserve existing execute function if one was already registered
        execute: existing?.execute ?? createPlaceholderExecute(row.name),
      };

      this.tools.set(row.name, definition);
    }

    console.log(`[ToolRegistry] Loaded ${rows.length} tools from database (${this.tools.size} total registered)`);
  }
}

/**
 * Creates a placeholder execute function for tools loaded from the database
 * that do not yet have an implementation registered.
 */
function createPlaceholderExecute(toolName: string): ToolExecuteFn {
  return async (_input: Record<string, unknown>): Promise<ToolResult> => {
    return {
      output: null,
      error: `Tool '${toolName}' is registered but has no execute implementation`,
      durationMs: 0,
    };
  };
}
