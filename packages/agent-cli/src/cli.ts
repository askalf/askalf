#!/usr/bin/env node
/**
 * AskAlf Agent CLI
 * Connect local devices to your AskAlf fleet via WebSocket bridge.
 *
 * Usage:
 *   askalf-agent connect <api-key> [--url wss://askalf.org]
 *   askalf-agent daemon                # Run as background service
 *   askalf-agent status                # Check connection status
 *   askalf-agent disconnect            # Disconnect from fleet
 */

import { AgentBridge } from './bridge.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, hostname, platform, type, release } from 'os';
import { execSync, spawn } from 'child_process';

const CONFIG_DIR = join(homedir(), '.askalf');
const CONFIG_FILE = join(CONFIG_DIR, 'agent.json');
const PID_FILE = join(CONFIG_DIR, 'agent.pid');

interface AgentConfig {
  apiKey: string;
  url: string;
  deviceName?: string;
}

function loadConfig(): AgentConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config: AgentConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getDeviceInfo() {
  return {
    hostname: hostname(),
    os: `${type()} ${release()} (${platform()})`,
    capabilities: {
      shell: true,
      filesystem: true,
      git: hasCommand('git'),
      docker: hasCommand('docker'),
      node: hasCommand('node'),
      python: hasCommand('python3') || hasCommand('python'),
    },
  };
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(`${platform() === 'win32' ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function connect(apiKey: string, url: string, deviceName?: string): Promise<void> {
  const device = getDeviceInfo();
  const config: AgentConfig = { apiKey, url, deviceName: deviceName || device.hostname };
  saveConfig(config);

  console.log(`\n  AskAlf Agent v1.0.0`);
  console.log(`  ─────────────────────────`);
  console.log(`  Device:  ${config.deviceName}`);
  console.log(`  OS:      ${device.os}`);
  console.log(`  Server:  ${url}`);
  console.log(`  Caps:    ${Object.entries(device.capabilities).filter(([,v]) => v).map(([k]) => k).join(', ')}`);
  console.log(`  ─────────────────────────\n`);

  const bridge = new AgentBridge({
    apiKey,
    url,
    deviceName: config.deviceName!,
    hostname: device.hostname,
    os: device.os,
    capabilities: device.capabilities,
  });

  // Handle shutdown
  const shutdown = () => {
    console.log('\n  Disconnecting...');
    bridge.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await bridge.connect();
}

async function daemon(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('No configuration found. Run `askalf-agent connect <api-key>` first.');
    process.exit(1);
  }

  // Spawn detached process
  const child = spawn(process.execPath, [process.argv[1]!, 'connect', config.apiKey, '--url', config.url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(child.pid));

  console.log(`Agent daemon started (PID: ${child.pid})`);
  process.exit(0);
}

function status(): void {
  const config = loadConfig();
  if (!config) {
    console.log('Not configured. Run `askalf-agent connect <api-key>` first.');
    return;
  }

  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    try {
      process.kill(parseInt(pid), 0); // Check if process exists
      console.log(`Agent running (PID: ${pid})`);
      console.log(`  Server: ${config.url}`);
      console.log(`  Device: ${config.deviceName}`);
    } catch {
      console.log('Agent not running (stale PID file).');
    }
  } else {
    console.log('Agent not running.');
  }
}

function disconnect(): void {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Agent stopped (PID: ${pid})`);
    } catch {
      console.log('Agent was not running.');
    }
    try { require('fs').unlinkSync(PID_FILE); } catch { /* ignore */ }
  } else {
    console.log('No running agent found.');
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);

// Flags
if (args.includes('--version') || args.includes('-v')) {
  console.log('1.0.0');
  process.exit(0);
}

// If --help/-h is present anywhere, show top-level help regardless of subcommand
const command = (args.includes('--help') || args.includes('-h')) ? undefined : args[0];

switch (command) {
  case 'connect': {
    const apiKey = args[1];
    if (!apiKey) {
      console.error('Usage: askalf-agent connect <api-key> [--url wss://askalf.org] [--name my-device]');
      process.exit(1);
    }
    const urlIdx = args.indexOf('--url');
    const url = urlIdx >= 0 ? args[urlIdx + 1]! : 'wss://askalf.org';
    const nameIdx = args.indexOf('--name');
    const deviceName = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
    connect(apiKey, url, deviceName);
    break;
  }
  case 'daemon':
    daemon();
    break;
  case 'status':
    status();
    break;
  case 'disconnect':
    disconnect();
    break;
  default:
    console.log(`
  AskAlf Agent CLI v1.0.0

  Usage:
    askalf-agent connect <api-key>    Connect this device to your fleet
    askalf-agent daemon               Run as background service
    askalf-agent status               Check connection status
    askalf-agent disconnect           Stop the agent

  Options:
    --url <url>    Server URL (default: wss://askalf.org)
    --name <name>  Device name (default: hostname)
`);
}
