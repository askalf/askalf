import type { Command } from 'commander';
import { getClient } from '../client.js';

export function registerTemplateCommands(program: Command): void {
  const template = program.command('template').description('Browse and use templates');

  template
    .command('list')
    .description('List available templates')
    .action(async () => {
      const client = getClient();
      const { templates } = await client.templates.list();

      if (templates.length === 0) {
        console.log('No templates available.');
        return;
      }

      // Group by category
      const grouped: Record<string, typeof templates> = {};
      for (const t of templates) {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category]!.push(t);
      }

      for (const [category, tmpls] of Object.entries(grouped)) {
        console.log(`\n${category.toUpperCase()}`);
        console.log('-'.repeat(60));
        for (const t of tmpls) {
          const cost = t.estimated_cost_per_run
            ? `$${parseFloat(t.estimated_cost_per_run).toFixed(2)}`
            : 'Free';
          console.log(`  ${t.slug.padEnd(25)} ${cost.padEnd(8)} ${t.description}`);
        }
      }
    });

  template
    .command('use <slug>')
    .description('Create an agent from a template')
    .option('-n, --name <name>', 'Custom agent name')
    .action(async (slug: string, opts: { name?: string }) => {
      const client = getClient();
      const { templates } = await client.templates.list();
      const tmpl = templates.find(t => t.slug === slug || t.id === slug);

      if (!tmpl) {
        console.error(`Template "${slug}" not found. Run 'o8r template list' to see available templates.`);
        process.exit(1);
      }

      const { agent } = await client.templates.instantiate(tmpl.id, opts.name ? { name: opts.name } : undefined);
      console.log(`Agent created from template "${tmpl.name}": ${agent.name} (${agent.id})`);
    });
}
