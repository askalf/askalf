import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { getClient } from '../client.js';

interface AgentManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
  };
  spec: {
    description?: string;
    systemPrompt: string;
    model?: string;
    autonomyLevel?: number;
    maxCostPerExecution?: number;
    maxIterations?: number;
    tools?: string[];
    schedule?: {
      interval?: string;
      cron?: string;
    };
  };
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Apply a YAML configuration file (config-as-code)')
    .requiredOption('-f, --file <path>', 'YAML file to apply')
    .action(async (opts: { file: string }) => {
      const raw = readFileSync(opts.file, 'utf-8');

      // Support multi-document YAML (--- separators)
      const docs = raw.split(/^---$/m).filter(s => s.trim());

      const client = getClient();
      let created = 0;

      for (const doc of docs) {
        const manifest = parse(doc) as AgentManifest;

        if (!manifest.kind || manifest.kind !== 'Agent') {
          console.warn(`Skipping unknown kind: ${manifest.kind ?? 'undefined'}`);
          continue;
        }

        const agent = await client.agents.create({
          name: manifest.metadata.name,
          description: manifest.spec.description,
          systemPrompt: manifest.spec.systemPrompt,
          modelId: manifest.spec.model,
          autonomyLevel: manifest.spec.autonomyLevel,
          enabledTools: manifest.spec.tools,
          maxIterations: manifest.spec.maxIterations,
          maxCostPerExecution: manifest.spec.maxCostPerExecution,
        });

        console.log(`agent/${agent.name} created (${agent.id})`);
        created++;
      }

      console.log(`\n${created} resource(s) applied.`);
    });
}
