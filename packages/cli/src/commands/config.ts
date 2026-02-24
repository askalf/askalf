import type { Command } from 'commander';
import { loadConfig, saveConfig, getConfigPath } from '../config.js';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Manage CLI configuration');

  config
    .command('set <key> <value>')
    .description('Set a configuration value (apiUrl, apiKey)')
    .action((key: string, value: string) => {
      if (key !== 'apiUrl' && key !== 'apiKey') {
        console.error(`Unknown config key: ${key}. Valid keys: apiUrl, apiKey`);
        process.exit(1);
      }
      saveConfig({ [key]: value });
      console.log(`${key} updated.`);
    });

  config
    .command('get [key]')
    .description('Show configuration')
    .action((key?: string) => {
      const cfg = loadConfig();
      if (key) {
        const val = cfg[key as keyof typeof cfg];
        if (val === undefined) {
          console.error(`Unknown config key: ${key}`);
          process.exit(1);
        }
        // Mask API key
        if (key === 'apiKey' && val) {
          console.log(`${val.slice(0, 6)}...${val.slice(-4)}`);
        } else {
          console.log(val);
        }
      } else {
        console.log(`Config file: ${getConfigPath()}`);
        console.log(`API URL:     ${cfg.apiUrl}`);
        console.log(`API Key:     ${cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}...${cfg.apiKey.slice(-4)}` : '(not set)'}`);
      }
    });
}
