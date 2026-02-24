/**
 * Orcastr8r TypeScript SDK
 * Programmatic access to agents, executions, templates, and fleet
 */

export interface OrcastrConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  model_id: string | null;
  autonomy_level: number;
  enabled_tools: string[];
  created_at: string;
  updated_at: string;
}

export interface Execution {
  id: string;
  agent_id: string;
  status: string;
  input: string;
  output: string | null;
  cost: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  estimated_cost_per_run: string | null;
  required_tools: string[];
}

export interface CreateAgentOptions {
  name: string;
  description?: string;
  systemPrompt: string;
  modelId?: string;
  autonomyLevel?: number;
  enabledTools?: string[];
  maxIterations?: number;
  maxCostPerExecution?: number;
}

export interface RunAgentOptions {
  input?: string;
  metadata?: Record<string, unknown>;
}

export class Orcastr8r {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: OrcastrConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://orcastr8r.com').replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1/forge${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Orcastr8r API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Agents ──

  readonly agents = {
    list: async (): Promise<{ agents: Agent[] }> => {
      return this.fetch('/agents');
    },

    get: async (id: string): Promise<Agent> => {
      return this.fetch(`/agents/${id}`);
    },

    create: async (opts: CreateAgentOptions): Promise<Agent> => {
      return this.fetch('/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: opts.name,
          description: opts.description ?? '',
          systemPrompt: opts.systemPrompt,
          modelId: opts.modelId ?? 'claude-sonnet-4-6',
          autonomyLevel: opts.autonomyLevel ?? 2,
          enabledTools: opts.enabledTools ?? [],
          maxIterations: opts.maxIterations ?? 15,
          maxCostPerExecution: opts.maxCostPerExecution ?? 1.0,
          metadata: { source_layer: 'sdk' },
        }),
      });
    },

    run: async (agentId: string, opts?: RunAgentOptions): Promise<Execution> => {
      return this.fetch('/executions', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          input: opts?.input ?? '',
          metadata: { ...(opts?.metadata ?? {}), source_layer: 'sdk' },
        }),
      });
    },

    delete: async (id: string): Promise<void> => {
      await this.fetch(`/agents/${id}`, { method: 'DELETE' });
    },
  };

  // ── Executions ──

  readonly executions = {
    list: async (params?: { agentId?: string; status?: string; limit?: number }): Promise<{ executions: Execution[] }> => {
      const qs = new URLSearchParams();
      if (params?.agentId) qs.set('agentId', params.agentId);
      if (params?.status) qs.set('status', params.status);
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return this.fetch(`/executions${query ? `?${query}` : ''}`);
    },

    get: async (id: string): Promise<Execution> => {
      return this.fetch(`/executions/${id}`);
    },

    cancel: async (id: string): Promise<void> => {
      await this.fetch(`/executions/${id}/cancel`, { method: 'POST' });
    },

    waitForCompletion: async (id: string, pollInterval = 3000, maxWait = 300000): Promise<Execution> => {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const exec = await this.executions.get(id);
        if (exec.status === 'completed' || exec.status === 'failed') {
          return exec;
        }
        await new Promise(r => setTimeout(r, pollInterval));
      }
      throw new Error(`Execution ${id} did not complete within ${maxWait / 1000}s`);
    },
  };

  // ── Templates ──

  readonly templates = {
    list: async (): Promise<{ templates: Template[] }> => {
      return this.fetch('/templates');
    },

    get: async (id: string): Promise<Template> => {
      return this.fetch(`/templates/${id}`);
    },

    instantiate: async (id: string, overrides?: Record<string, unknown>): Promise<{ agent: Agent }> => {
      return this.fetch(`/templates/${id}/instantiate`, {
        method: 'POST',
        body: JSON.stringify({ overrides }),
      });
    },
  };
}

export default Orcastr8r;
