#!/usr/bin/env node

/**
 * o8r — Orcastr8r CLI
 * Manage agents, executions, templates, and fleet from the command line
 */

import { Command } from 'commander';
import { registerAgentCommands } from './commands/agent.js';
import { registerExecCommands } from './commands/exec.js';
import { registerTemplateCommands } from './commands/template.js';
import { registerFleetCommands } from './commands/fleet.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerConfigCommands } from './commands/config.js';

const program = new Command();

program
  .name('o8r')
  .description('Orcastr8r CLI — AI Agent Orchestration Platform')
  .version('1.0.0');

registerAgentCommands(program);
registerExecCommands(program);
registerTemplateCommands(program);
registerFleetCommands(program);
registerApplyCommand(program);
registerConfigCommands(program);

program.parse();
