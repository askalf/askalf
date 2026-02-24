import type { Command } from 'commander';
import { getClient } from '../client.js';

export function registerAgentCommands(program: Command): void {
  const agent = program.command('agent').description('Manage agents');

  agent
    .command('list')
    .description('List all agents')
    .action(async () => {
      const client = getClient();
      const { agents } = await client.agents.list();
      if (agents.length === 0) {
        console.log('No agents found.');
        return;
      }
      console.log(`${'NAME'.padEnd(30)} ${'STATUS'.padEnd(12)} ${'MODEL'.padEnd(25)} ID`);
      console.log('-'.repeat(90));
      for (const a of agents) {
        console.log(
          `${(a.name ?? '').padEnd(30)} ${a.status.padEnd(12)} ${(a.model_id ?? 'default').padEnd(25)} ${a.id}`
        );
      }
    });

  agent
    .command('get <id>')
    .description('Get agent details')
    .action(async (id: string) => {
      const client = getClient();
      const a = await client.agents.get(id);
      console.log(JSON.stringify(a, null, 2));
    });

  agent
    .command('create')
    .description('Create an agent from YAML file')
    .requiredOption('-f, --file <path>', 'YAML file path')
    .action(async (opts: { file: string }) => {
      const { readFileSync } = await import('node:fs');
      const { parse } = await import('yaml');
      const raw = readFileSync(opts.file, 'utf-8');
      const spec = parse(raw) as {
        metadata?: { name: string };
        spec?: {
          systemPrompt?: string;
          model?: string;
          autonomyLevel?: number;
          tools?: string[];
          maxIterations?: number;
          maxCostPerExecution?: number;
          description?: string;
        };
      };

      const client = getClient();
      const agent = await client.agents.create({
        name: spec.metadata?.name ?? 'unnamed-agent',
        description: spec.spec?.description,
        systemPrompt: spec.spec?.systemPrompt ?? '',
        modelId: spec.spec?.model,
        autonomyLevel: spec.spec?.autonomyLevel,
        enabledTools: spec.spec?.tools,
        maxIterations: spec.spec?.maxIterations,
        maxCostPerExecution: spec.spec?.maxCostPerExecution,
      });
      console.log(`Agent created: ${agent.name} (${agent.id})`);
    });

  agent
    .command('run <id>')
    .description('Run an agent')
    .option('-i, --input <text>', 'Input prompt')
    .action(async (id: string, opts: { input?: string }) => {
      const client = getClient();
      const exec = await client.agents.run(id, { input: opts.input });
      console.log(`Execution started: ${exec.id}`);
      console.log(`Status: ${exec.status}`);
    });

  agent
    .command('delete <id>')
    .description('Delete an agent')
    .action(async (id: string) => {
      const client = getClient();
      await client.agents.delete(id);
      console.log(`Agent ${id} deleted.`);
    });
}
