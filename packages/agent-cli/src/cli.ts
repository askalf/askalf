#!/usr/bin/env node

import { Command } from 'commander';
import { authInteractive, showAuthStatus } from './auth.js';
import { run } from './run.js';
import { checkPlatform } from './platform/index.js';
import { loadConfig, saveConfig } from './util/config.js';
import { isWhisperInstalled, setupWhisper } from './voice/index.js';
import * as output from './util/output.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('askalf-agent')
  .description('Open source computer-use agent — control your computer with natural language')
  .version('0.1.0');

program
  .command('auth')
  .description('Configure authentication (API key or Claude OAuth)')
  .option('--status', 'Show current auth status')
  .action(async (opts) => {
    if (opts.status) {
      await showAuthStatus();
    } else {
      await authInteractive();
    }
  });

program
  .command('run')
  .description('Run the agent with a natural language prompt')
  .argument('<prompt>', 'What you want the agent to do')
  .option('-m, --model <model>', 'Model to use')
  .option('-b, --budget <amount>', 'Max budget in USD')
  .option('-t, --turns <count>', 'Max turns')
  .option('-v, --voice', 'Use voice input (microphone → whisper transcription)')
  .action(async (prompt, opts) => {
    // Apply CLI overrides to config
    if (opts.model || opts.budget || opts.turns) {
      const overrides: Record<string, unknown> = {};
      if (opts.model) overrides['model'] = opts.model;
      if (opts.budget) overrides['maxBudgetUsd'] = parseFloat(opts.budget);
      if (opts.turns) overrides['maxTurns'] = parseInt(opts.turns, 10);
      await saveConfig(overrides);
    }

    await run(prompt, { voice: opts.voice });
  });

program
  .command('check')
  .description('Check platform dependencies and capabilities')
  .action(async () => {
    output.header('Platform Check');

    const check = await checkPlatform();

    console.log();
    console.log(chalk.dim('Platform:'), check.platform);
    console.log(chalk.dim('Display:'), check.displayServer);
    console.log();

    const icon = (ok: boolean) => ok ? chalk.green('✔') : chalk.red('✖');

    console.log(icon(check.screenshot.available), 'Screenshot:', check.screenshot.tool);
    console.log(icon(check.mouse.available), 'Mouse control:', check.mouse.tool);
    console.log(icon(check.keyboard.available), 'Keyboard control:', check.keyboard.tool);
    console.log(icon(check.claudeCli), 'Claude CLI:', check.claudeCli ? 'installed' : 'not found');
    console.log();

    const whisperReady = await isWhisperInstalled();
    console.log(icon(whisperReady), 'Voice (whisper.cpp):', whisperReady ? 'installed' : 'not found — run: askalf-agent voice-setup');
    console.log();

    if (check.missingDeps.length > 0) {
      output.warn(`Missing dependencies: ${check.missingDeps.join(', ')}`);
      if (check.installHint) {
        output.info(`Install with: ${check.installHint}`);
      }
    } else {
      output.success('All dependencies available!');
    }

    const config = await loadConfig();
    console.log();
    console.log(chalk.dim('Auth mode:'), config.authMode ?? 'not configured');
    console.log(chalk.dim('Model:'), config.model);
    console.log(chalk.dim('Budget:'), `$${config.maxBudgetUsd.toFixed(2)}`);
    console.log(chalk.dim('Max turns:'), config.maxTurns);
    console.log(chalk.dim('Guardrails:'), chalk.green('active'));
  });

program
  .command('voice-setup')
  .description('Download whisper.cpp binary and speech model for voice control')
  .option('--model <size>', 'Model size: tiny, base, small, medium', 'base')
  .action(async (opts) => {
    const validModels = ['tiny', 'base', 'small', 'medium'] as const;
    const model = opts.model as typeof validModels[number];
    if (!validModels.includes(model)) {
      output.error(`Invalid model: ${opts.model}. Choose: ${validModels.join(', ')}`);
      process.exit(1);
    }
    await setupWhisper(model);
  });

program
  .command('config')
  .description('Update configuration')
  .option('-m, --model <model>', 'Default model')
  .option('-b, --budget <amount>', 'Default max budget in USD')
  .option('-t, --turns <count>', 'Default max turns')
  .action(async (opts) => {
    const updates: Record<string, unknown> = {};
    if (opts.model) updates['model'] = opts.model;
    if (opts.budget) updates['maxBudgetUsd'] = parseFloat(opts.budget);
    if (opts.turns) updates['maxTurns'] = parseInt(opts.turns, 10);

    if (Object.keys(updates).length === 0) {
      const config = await loadConfig();
      output.header('Current Configuration');
      console.log(JSON.stringify(config, null, 2));
    } else {
      const config = await saveConfig(updates);
      output.success('Configuration updated');
      console.log(JSON.stringify(config, null, 2));
    }
  });

program.parse();
