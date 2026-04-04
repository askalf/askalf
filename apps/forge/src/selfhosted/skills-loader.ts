/**
 * Skills Loader — Reads markdown skill files from skills/ directory
 * and syncs them to the forge_agent_templates table.
 *
 * Skill files use YAML frontmatter for configuration and markdown body
 * for the system prompt / instructions.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query } from '../database.js';
import { initializeLogger } from '@askalf/observability';
import { invalidatePlatformContext } from '../runtime/platform-context.js';

const logger = initializeLogger().child({ component: 'skills-loader' });

interface SkillFrontmatter {
  name: string;
  slug: string;
  category: string;
  model?: string;
  max_iterations?: number;
  max_cost?: number;
  tools?: string[];
}

interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const fmRaw = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  // Simple YAML parser for flat key-value pairs + arrays
  const fm: Record<string, unknown> = {};
  let currentKey = '';
  for (const line of fmRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('- ') && currentKey) {
      const arr = fm[currentKey] as string[] | undefined;
      if (Array.isArray(arr)) {
        arr.push(trimmed.slice(2).trim());
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    currentKey = key;

    if (value === '') {
      // Might be start of array
      fm[key] = [];
    } else {
      // Parse numbers
      const num = Number(value);
      if (!isNaN(num) && value !== '') {
        fm[key] = num;
      } else {
        fm[key] = value;
      }
    }
  }

  const frontmatter = fm as unknown as SkillFrontmatter;
  if (!frontmatter.name || !frontmatter.slug || !frontmatter.category) {
    return null;
  }

  return { frontmatter, body };
}

export async function loadSkills(): Promise<void> {
  const skillsDir = join(process.env['WORKSPACE_ROOT'] ?? '/workspace', 'skills');

  let files: string[];
  try {
    files = (await readdir(skillsDir)).filter(f => f.endsWith('.md'));
  } catch {
    logger.info('[Skills] No skills/ directory found, skipping skill sync');
    return;
  }

  if (files.length === 0) {
    logger.info('[Skills] No skill files found in skills/');
    return;
  }

  let synced = 0;
  for (const file of files) {
    try {
      const content = await readFile(join(skillsDir, file), 'utf-8');
      const skill = parseSkillMarkdown(content);
      if (!skill) {
        logger.warn(`[Skills] Failed to parse ${file} — missing frontmatter`);
        continue;
      }

      const { frontmatter: fm, body } = skill;
      const templateId = `tmpl_${fm.slug.replace(/-/g, '_')}`;

      const agentConfig = JSON.stringify({
        model: fm.model ?? 'claude-sonnet-4-6',
        systemPrompt: body,
        autonomyLevel: 2,
        maxIterations: fm.max_iterations ?? 15,
        maxCostPerExecution: fm.max_cost ?? 1.00,
      });

      const tools = fm.tools ?? [];

      await query(
        `INSERT INTO forge_agent_templates (id, name, slug, category, description, agent_config, required_tools, estimated_cost_per_run, is_active, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, NOW(), NOW())
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           agent_config = EXCLUDED.agent_config,
           required_tools = EXCLUDED.required_tools,
           estimated_cost_per_run = EXCLUDED.estimated_cost_per_run,
           updated_at = NOW()`,
        [
          templateId,
          fm.name,
          fm.slug,
          fm.category,
          body.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ?? fm.name,
          agentConfig,
          tools,
          fm.max_cost ?? 1.00,
          synced,
        ],
      );

      synced++;
    } catch (err) {
      logger.warn(`[Skills] Error loading ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info(`[Skills] Synced ${synced}/${files.length} skill(s) from skills/ directory`);

  // Invalidate platform context cache so intent parser and sessions pick up new skills
  if (synced > 0) {
    invalidatePlatformContext();
  }
}
