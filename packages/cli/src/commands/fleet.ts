import type { Command } from 'commander';
import { getClient } from '../client.js';

export function registerFleetCommands(program: Command): void {
  const fleet = program.command('fleet').description('Fleet overview');

  fleet
    .command('status')
    .description('Show fleet status')
    .action(async () => {
      const client = getClient();
      const { agents } = await client.agents.list();

      const active = agents.filter((a: { status: string }) => a.status === 'active');
      const running = agents.filter((a: { status: string }) => a.status === 'running');
      const paused = agents.filter((a: { status: string }) => a.status === 'paused' || a.status === 'draft');

      console.log('Fleet Status');
      console.log('='.repeat(50));
      console.log(`Total agents:  ${agents.length}`);
      console.log(`Active:        ${active.length}`);
      console.log(`Running:       ${running.length}`);
      console.log(`Paused/Draft:  ${paused.length}`);
      console.log();

      if (running.length > 0) {
        console.log('Currently Running:');
        for (const a of running) {
          console.log(`  - ${a.name} (${a.id})`);
        }
      }
    });
}
