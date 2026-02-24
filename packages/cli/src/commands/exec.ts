import type { Command } from 'commander';
import { getClient } from '../client.js';

export function registerExecCommands(program: Command): void {
  const exec = program.command('exec').description('Manage executions');

  exec
    .command('list')
    .description('List executions')
    .option('-a, --agent <id>', 'Filter by agent ID')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (opts: { agent?: string; status?: string; limit: string }) => {
      const client = getClient();
      const { executions } = await client.executions.list({
        agentId: opts.agent,
        status: opts.status,
        limit: parseInt(opts.limit, 10),
      });

      if (executions.length === 0) {
        console.log('No executions found.');
        return;
      }

      console.log(`${'ID'.padEnd(28)} ${'STATUS'.padEnd(12)} ${'COST'.padEnd(10)} CREATED`);
      console.log('-'.repeat(80));
      for (const e of executions) {
        const cost = `$${parseFloat(e.cost || '0').toFixed(2)}`;
        const created = new Date(e.created_at).toLocaleString();
        console.log(`${e.id.padEnd(28)} ${e.status.padEnd(12)} ${cost.padEnd(10)} ${created}`);
      }
    });

  exec
    .command('get <id>')
    .description('Get execution details')
    .action(async (id: string) => {
      const client = getClient();
      const e = await client.executions.get(id);
      console.log(JSON.stringify(e, null, 2));
    });

  exec
    .command('logs <id>')
    .description('Show execution output')
    .option('-f, --follow', 'Poll for updates until completion')
    .action(async (id: string, opts: { follow?: boolean }) => {
      const client = getClient();

      if (opts.follow) {
        console.log(`Following execution ${id}...`);
        const result = await client.executions.waitForCompletion(id, 2000);
        console.log(`\nStatus: ${result.status}`);
        if (result.output) console.log(`\nOutput:\n${result.output}`);
        if (result.error) console.error(`\nError: ${result.error}`);
      } else {
        const e = await client.executions.get(id);
        console.log(`Status: ${e.status}`);
        if (e.output) console.log(`\nOutput:\n${e.output}`);
        if (e.error) console.error(`\nError: ${e.error}`);
      }
    });

  exec
    .command('cancel <id>')
    .description('Cancel a running execution')
    .action(async (id: string) => {
      const client = getClient();
      await client.executions.cancel(id);
      console.log(`Execution ${id} cancelled.`);
    });
}
