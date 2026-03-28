/**
 * Onboarding Routes
 * Wizard completion tracking and platform configuration for new users
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query } from '../database.js';
import { substrateQuery, substrateQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

function extractUserId(request: FastifyRequest): string | null {
  return (request as unknown as { userId?: string }).userId || null;
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/onboarding/status
   */
  app.get(
    '/api/v1/forge/onboarding/status',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const row = await substrateQueryOne<{ onboarding_completed_at: string | null }>(
        'SELECT onboarding_completed_at FROM users WHERE id = $1',
        [userId],
      );

      // Check if Anthropic key is configured (env or platform_settings)
      const hasAnthropicKey = !!process.env['ANTHROPIC_API_KEY'];

      return {
        completed: !!row?.onboarding_completed_at,
        hasAnthropicKey,
      };
    },
  );

  /**
   * POST /api/v1/forge/onboarding/complete
   */
  app.post(
    '/api/v1/forge/onboarding/complete',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as { workspace_name?: string; theme?: string; use_case?: string; marketplace_enabled?: boolean } | null;
      const workspaceName = body?.workspace_name?.trim();
      const theme = body?.theme?.trim();
      const useCase = body?.use_case?.trim();

      // Update tenant name and use-case if provided
      if (workspaceName && workspaceName.length > 0) {
        const userRow = await substrateQueryOne<{ tenant_id: string }>(
          'SELECT tenant_id FROM users WHERE id = $1',
          [userId],
        );
        if (userRow) {
          await substrateQuery(
            'UPDATE tenants SET use_case = $1 WHERE id = $2',
            [useCase || null, userRow.tenant_id],
          ).catch(() => {});
          await substrateQuery(
            'UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2',
            [workspaceName, userRow.tenant_id],
          );
        }
      }

      // Save theme preference + mark onboarding as complete
      const validThemes = ['dark', 'light', 'system'];
      const themeValue = theme && validThemes.includes(theme) ? theme : null;
      await substrateQuery(
        'UPDATE users SET onboarding_completed_at = NOW(), theme_preference = COALESCE($2, theme_preference), updated_at = NOW() WHERE id = $1',
        [userId, themeValue],
      );

      // Provision use-case agents if selected
      if (useCase && useCase !== 'custom') {
        const userTenant = await substrateQueryOne<{ tenant_id: string }>('SELECT tenant_id FROM users WHERE id = $1', [userId]);
        await provisionUseCaseAgents(userId, useCase, userTenant?.tenant_id);
      }

      // Save marketplace preference
      if (body?.marketplace_enabled !== undefined) {
        await query(
          `UPDATE forge_preferences SET value = $2, key = 'marketplace_enabled', updated_at = NOW() WHERE user_id = $1`,
          [userId, String(body.marketplace_enabled)],
        ).catch(() => {});
      }

      return { success: true };
    },
  );

  /**
   * GET /api/v1/forge/onboarding/ollama-status — Check if Ollama is available
   */
  app.get(
    '/api/v1/forge/onboarding/ollama-status',
    { preHandler: [authMiddleware] },
    async () => {
      const ollamaUrl = process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_HOST'] || 'http://ollama:11434';
      try {
        const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { available: false, models: [] };
        const data = await res.json() as { models?: { name: string }[] };
        return {
          available: true,
          url: ollamaUrl,
          models: (data.models || []).map(m => m.name),
        };
      } catch {
        return { available: false, models: [] };
      }
    },
  );

  /**
   * POST /api/v1/forge/onboarding/api-key
   * Save Anthropic API key to platform_settings (persists across restarts)
   * and set it in process.env immediately for the intent parser.
   */
  app.post(
    '/api/v1/forge/onboarding/api-key',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as { key: string; provider?: string } | null;
      const apiKey = body?.key?.trim();
      if (!apiKey) {
        return reply.status(400).send({ error: 'API key is required' });
      }

      const provider = body?.provider || 'anthropic';
      const envName = provider === 'openai' ? 'OPENAI_API_KEY'
        : provider === 'google' ? 'GOOGLE_AI_KEY'
        : 'ANTHROPIC_API_KEY';

      // Test the key before saving
      if (provider === 'openai') {
        try {
          const testRes = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (!testRes.ok) {
            const err = await testRes.json().catch(() => ({})) as { error?: { message?: string } };
            return reply.status(400).send({
              error: `Invalid OpenAI key: ${err.error?.message || testRes.statusText}`,
            });
          }
        } catch (err) {
          return reply.status(400).send({
            error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
        }
      }

      if (provider === 'anthropic') {
        try {
          const testRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          });
          if (!testRes.ok) {
            const err = await testRes.json().catch(() => ({})) as { error?: { message?: string } };
            return reply.status(400).send({
              error: `Invalid API key: ${err.error?.message || testRes.statusText}`,
            });
          }
        } catch (err) {
          return reply.status(400).send({
            error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
        }
      }

      // Save to platform_settings (persists across container restarts)
      await substrateQuery(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [envName, apiKey],
      );

      // Set in process.env immediately (no restart needed)
      process.env[envName] = apiKey;

      return { success: true, provider, envName };
    },
  );
}

// Use-case → agent definitions for auto-provisioning
const USE_CASE_AGENTS: Record<string, { name: string; type: string; description: string; system_prompt: string; tools: string[] }[]> = {
  'software-dev': [
    { name: 'Builder', type: 'dev', description: 'Writes, tests, and ships code', system_prompt: 'You are a software builder. Write clean, tested code.', tools: ['code_edit', 'shell', 'git_ops'] },
    { name: 'Reviewer', type: 'dev', description: 'Reviews PRs and code quality', system_prompt: 'You review code for quality, security, and correctness.', tools: ['code_edit', 'git_ops'] },
    { name: 'Security', type: 'security', description: 'Scans for vulnerabilities', system_prompt: 'You scan code and infrastructure for security issues.', tools: ['shell', 'web_search'] },
    { name: 'Monitor', type: 'monitor', description: 'Patrols system health', system_prompt: 'You monitor system health and create tickets for issues.', tools: ['shell', 'ticket_ops'] },
  ],
  'devops': [
    { name: 'Ops', type: 'dev', description: 'Manages deployments and infra', system_prompt: 'You manage infrastructure and deployments.', tools: ['shell', 'docker_ops'] },
    { name: 'Security', type: 'security', description: 'Audits security posture', system_prompt: 'You audit security across infrastructure.', tools: ['shell', 'web_search'] },
    { name: 'Monitor', type: 'monitor', description: 'Monitors systems 24/7', system_prompt: 'You monitor uptime, performance, and health.', tools: ['shell', 'ticket_ops'] },
  ],
  'marketing': [
    { name: 'Content Writer', type: 'content', description: 'Creates marketing content', system_prompt: 'You write compelling marketing copy.', tools: ['web_search', 'code_edit'] },
    { name: 'SEO Analyst', type: 'research', description: 'Tracks SEO and rankings', system_prompt: 'You analyze SEO metrics and suggest improvements.', tools: ['web_search'] },
    { name: 'Social Media Monitor', type: 'monitor', description: 'Monitors brand mentions', system_prompt: 'You monitor social media for brand mentions.', tools: ['web_search', 'twitter_ops'] },
  ],
  'support': [
    { name: 'Support Agent', type: 'worker', description: 'Handles support tickets', system_prompt: 'You handle customer support queries.', tools: ['web_search', 'ticket_ops'] },
    { name: 'FAQ Builder', type: 'content', description: 'Builds knowledge base articles', system_prompt: 'You create FAQ and help documentation.', tools: ['code_edit', 'web_search'] },
  ],
  'research': [
    { name: 'Research Analyst', type: 'research', description: 'Deep-dives into topics', system_prompt: 'You conduct thorough research and analysis.', tools: ['web_search', 'memory_store'] },
    { name: 'Report Writer', type: 'content', description: 'Generates reports', system_prompt: 'You write comprehensive analytical reports.', tools: ['web_search', 'code_edit'] },
    { name: 'Trend Monitor', type: 'monitor', description: 'Monitors trends and changes', system_prompt: 'You track industry trends and flag changes.', tools: ['web_search', 'ticket_ops'] },
  ],
  'ecommerce': [
    { name: 'Inventory Monitor', type: 'monitor', description: 'Tracks inventory levels', system_prompt: 'You monitor inventory and alert on low stock.', tools: ['web_search', 'ticket_ops'] },
    { name: 'Review Responder', type: 'worker', description: 'Responds to customer reviews', system_prompt: 'You respond professionally to customer reviews.', tools: ['web_search'] },
  ],
  'agency': [
    { name: 'Client Manager', type: 'worker', description: 'Manages client projects', system_prompt: 'You manage client relationships and projects.', tools: ['ticket_ops', 'memory_store'] },
    { name: 'Report Generator', type: 'content', description: 'Generates client reports', system_prompt: 'You create professional client reports.', tools: ['web_search', 'code_edit'] },
  ],
  'personal': [
    { name: 'Scheduler', type: 'worker', description: 'Manages your calendar and routines', system_prompt: 'You help manage schedules, set reminders, and organize daily routines.', tools: ['web_search', 'memory_store'] },
    { name: 'Researcher', type: 'research', description: 'Researches topics on demand', system_prompt: 'You research topics thoroughly and summarize findings.', tools: ['web_search', 'memory_store'] },
    { name: 'Budget Coach', type: 'worker', description: 'Tracks spending and budgets', system_prompt: 'You help track spending, create budgets, and find ways to save money.', tools: ['web_search', 'memory_store'] },
    { name: 'Planner', type: 'worker', description: 'Plans projects and goals', system_prompt: 'You help plan projects, set goals, and break them into actionable steps.', tools: ['web_search', 'memory_store'] },
  ],
  'health': [
    { name: 'Fitness Coach', type: 'worker', description: 'Creates workout plans', system_prompt: 'You create personalized workout plans based on goals and fitness level.', tools: ['web_search', 'memory_store'] },
    { name: 'Meal Planner', type: 'worker', description: 'Plans healthy meals', system_prompt: 'You plan nutritious meals within budget and dietary preferences.', tools: ['web_search', 'memory_store'] },
    { name: 'Wellness Tracker', type: 'monitor', description: 'Tracks wellness goals', system_prompt: 'You track health goals, sleep, hydration, and wellness habits.', tools: ['memory_store', 'ticket_ops'] },
    { name: 'Health Researcher', type: 'research', description: 'Researches health topics', system_prompt: 'You research health, nutrition, and wellness topics with evidence-based information.', tools: ['web_search', 'memory_store'] },
  ],
  'home': [
    { name: 'Home Manager', type: 'worker', description: 'Manages household tasks', system_prompt: 'You manage household tasks, maintenance schedules, and home projects.', tools: ['web_search', 'memory_store'] },
    { name: 'Pet Care Scheduler', type: 'worker', description: 'Manages pet care routines', system_prompt: 'You track pet care: vet appointments, feeding schedules, medications.', tools: ['memory_store', 'ticket_ops'] },
    { name: 'Family Planner', type: 'worker', description: 'Coordinates family activities', system_prompt: 'You coordinate family schedules, events, and activities.', tools: ['web_search', 'memory_store'] },
    { name: 'Project Tracker', type: 'monitor', description: 'Tracks home projects', system_prompt: 'You track home improvement projects, budgets, and timelines.', tools: ['memory_store', 'ticket_ops'] },
  ],
  'learning': [
    { name: 'Study Planner', type: 'worker', description: 'Creates study schedules', system_prompt: 'You create study plans, track progress, and optimize learning schedules.', tools: ['web_search', 'memory_store'] },
    { name: 'Researcher', type: 'research', description: 'Deep-dives into topics', system_prompt: 'You research topics in depth and create comprehensive summaries.', tools: ['web_search', 'memory_store'] },
    { name: 'Note Organizer', type: 'content', description: 'Organizes notes and knowledge', system_prompt: 'You organize notes, create summaries, and build knowledge maps.', tools: ['memory_store'] },
    { name: 'Progress Tracker', type: 'monitor', description: 'Tracks learning goals', system_prompt: 'You track learning milestones, certifications, and skill development.', tools: ['memory_store', 'ticket_ops'] },
  ],
  'travel': [
    { name: 'Trip Planner', type: 'worker', description: 'Plans trips and itineraries', system_prompt: 'You plan trips: destinations, flights, hotels, activities, and logistics.', tools: ['web_search', 'memory_store'] },
    { name: 'Researcher', type: 'research', description: 'Researches destinations', system_prompt: 'You research destinations, local culture, safety, and travel tips.', tools: ['web_search', 'memory_store'] },
    { name: 'Budget Tracker', type: 'monitor', description: 'Tracks travel budget', system_prompt: 'You track travel expenses, find deals, and manage trip budgets.', tools: ['web_search', 'memory_store'] },
    { name: 'Itinerary Builder', type: 'content', description: 'Builds detailed itineraries', system_prompt: 'You create day-by-day itineraries with times, locations, and reservations.', tools: ['web_search', 'memory_store'] },
  ],
  'finance': [
    { name: 'Finance Analyst', type: 'research', description: 'Analyzes financial data', system_prompt: 'You analyze financial data and spot trends.', tools: ['web_search', 'memory_store'] },
    { name: 'Auditor', type: 'monitor', description: 'Monitors financial compliance', system_prompt: 'You audit for financial compliance and flag issues.', tools: ['web_search', 'ticket_ops'] },
  ],
};

async function provisionUseCaseAgents(userId: string, useCase: string, tenantId?: string): Promise<void> {
  const agents = USE_CASE_AGENTS[useCase];
  if (!agents?.length) return;

  const tid = tenantId || 'selfhosted';
  for (const agent of agents) {
    const id = ulid();
    const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      await query(
        `INSERT INTO forge_agents (id, owner_id, tenant_id, name, slug, description, system_prompt, type, model_id, autonomy_level, enabled_tools, status, is_internal, dispatch_enabled, metadata)
         VALUES ($1, $2, $10, $3, $4, $5, $6, $7, 'claude-sonnet-4-6', 2, $8, 'active', false, false, $9)
         ON CONFLICT DO NOTHING`,
        [id, userId, agent.name, slug, agent.description, agent.system_prompt, agent.type, agent.tools, JSON.stringify({ source: 'onboarding', use_case: useCase }), tid],
      );
    } catch (err) {
      console.warn(`[Onboarding] Failed to provision agent "${agent.name}":`, err);
    }
  }
}
