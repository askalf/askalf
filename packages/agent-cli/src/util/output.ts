import chalk from 'chalk';

export function info(msg: string): void {
  console.log(chalk.blue('ℹ'), msg);
}

export function success(msg: string): void {
  console.log(chalk.green('✔'), msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠'), msg);
}

export function error(msg: string): void {
  console.error(chalk.red('✖'), msg);
}

export function step(n: number, total: number, msg: string): void {
  console.log(chalk.dim(`[${n}/${total}]`), msg);
}

export function header(msg: string): void {
  console.log();
  console.log(chalk.bold.white(msg));
  console.log(chalk.dim('─'.repeat(Math.min(msg.length + 4, 60))));
}

export function cost(tokens: { input: number; output: number }, costUsd: number, turns: number): void {
  console.log();
  console.log(chalk.dim('─'.repeat(40)));
  console.log(chalk.dim('Tokens:'), `${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out`);
  console.log(chalk.dim('Cost:'), chalk.yellow(`$${costUsd.toFixed(4)}`));
  console.log(chalk.dim('Turns:'), turns);
  console.log(chalk.dim('─'.repeat(40)));
}

export function action(tool: string, detail?: string): void {
  const label = chalk.cyan(`[${tool}]`);
  console.log(label, detail ?? '');
}
