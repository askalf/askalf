#!/usr/bin/env node
/**
 * AskAlf Agent CLI v2.4.0
 * Connect local devices to your AskAlf fleet via WebSocket bridge.
 *
 * Usage:
 *   askalf-agent connect <api-key> [--url wss://askalf.org] [--name my-device]
 *   askalf-agent daemon                # Run as background daemon
 *   askalf-agent install-service       # Install as OS service (systemd/launchd/Windows)
 *   askalf-agent uninstall-service     # Remove OS service
 *   askalf-agent status                # Check connection status
 *   askalf-agent disconnect            # Stop the agent
 */

import { AgentBridge, scanCapabilities } from './bridge.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir, hostname, platform, type, release } from 'os';
import { execSync, spawn } from 'child_process';

const VERSION = '2.4.1';
const CONFIG_DIR = join(homedir(), '.askalf');
const CONFIG_FILE = join(CONFIG_DIR, 'agent.json');
const PID_FILE = join(CONFIG_DIR, 'agent.pid');
const SERVICE_NAME = 'askalf-agent';

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
  const caps = scanCapabilities();
  return {
    hostname: hostname(),
    os: `${type()} ${release()} (${platform()})`,
    capabilities: caps,
    tools: caps['tools'] as string[],
  };
}

async function connect(apiKey: string, url: string, deviceName?: string): Promise<void> {
  const device = getDeviceInfo();
  const config: AgentConfig = { apiKey, url, deviceName: deviceName || device.hostname };
  saveConfig(config);

  console.log(`\n  AskAlf Agent v${VERSION}`);
  console.log(`  ${'─'.repeat(35)}`);
  console.log(`  Device:   ${config.deviceName}`);
  console.log(`  OS:       ${device.os}`);
  console.log(`  CPU:      ${device.capabilities['cpu_cores']} cores (${(device.capabilities['cpu_model'] as string || '').substring(0, 50)})`);
  console.log(`  Memory:   ${device.capabilities['memory_free_mb']}MB free / ${device.capabilities['memory_total_mb']}MB total`);
  console.log(`  Node:     ${process.version}`);
  console.log(`  Server:   ${url}`);
  console.log(`  Workers:  ${device.capabilities['max_workers']} concurrent`);
  console.log(`  Timeout:  10 minutes`);
  console.log(`  Tools:    ${device.tools.join(', ')}`);
  console.log(`  Claude:   ${device.capabilities['claude_cli'] ? 'Available' : 'Not found — install with: npm i -g @anthropic-ai/claude-code'}`);
  console.log(`  ${'─'.repeat(35)}\n`);

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

  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    try {
      process.kill(parseInt(pid), 0);
      console.log(`Agent already running (PID: ${pid}). Use 'askalf-agent disconnect' to stop it first.`);
      process.exit(0);
    } catch { /* not running, continue */ }
  }

  const args = [process.argv[1]!, 'connect', config.apiKey, '--url', config.url];
  if (config.deviceName) args.push('--name', config.deviceName);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(child.pid));

  console.log(`  AskAlf Agent daemon started`);
  console.log(`  PID:    ${child.pid}`);
  console.log(`  Server: ${config.url}`);
  console.log(`  Device: ${config.deviceName || hostname()}`);
  console.log(`\n  Use 'askalf-agent status' to check, 'askalf-agent disconnect' to stop.`);
  process.exit(0);
}

function status(): void {
  const config = loadConfig();
  if (!config) {
    console.log('  Not configured. Run `askalf-agent connect <api-key>` first.');
    return;
  }

  console.log(`\n  AskAlf Agent v${VERSION}`);
  console.log(`  Server: ${config.url}`);
  console.log(`  Device: ${config.deviceName || hostname()}`);

  // Check daemon PID
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    try {
      process.kill(parseInt(pid), 0);
      console.log(`  Daemon:  Running (PID: ${pid})`);
    } catch {
      console.log('  Daemon:  Not running (stale PID file)');
    }
  } else {
    console.log('  Daemon:  Not running');
  }

  // Check OS service
  const os = platform();
  if (os === 'linux') {
    try {
      const result = execSync(`systemctl is-active ${SERVICE_NAME} 2>/dev/null`, { encoding: 'utf8' }).trim();
      console.log(`  Service: ${result} (systemd)`);
    } catch {
      console.log('  Service: Not installed');
    }
  } else if (os === 'darwin') {
    try {
      const plist = join(homedir(), `Library/LaunchAgents/org.askalf.agent.plist`);
      console.log(`  Service: ${existsSync(plist) ? 'Installed (launchd)' : 'Not installed'}`);
    } catch {
      console.log('  Service: Not installed');
    }
  } else if (os === 'win32') {
    try {
      execSync(`sc query ${SERVICE_NAME}`, { stdio: 'ignore' });
      console.log('  Service: Installed (Windows Service)');
    } catch {
      console.log('  Service: Not installed');
    }
  }
  console.log('');
}

function disconnect(): void {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`  Agent stopped (PID: ${pid})`);
    } catch {
      console.log('  Agent was not running.');
    }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  } else {
    console.log('  No running daemon found.');
  }
}

function installService(): void {
  const config = loadConfig();
  if (!config) {
    console.error('  No configuration found. Run `askalf-agent connect <api-key>` first to save config.');
    process.exit(1);
  }

  const os = platform();
  const agentPath = process.argv[1]!;
  const nodePath = process.execPath;

  if (os === 'linux') {
    installSystemd(nodePath, agentPath, config);
  } else if (os === 'darwin') {
    installLaunchd(nodePath, agentPath, config);
  } else if (os === 'win32') {
    installWindowsService(nodePath, agentPath, config);
  } else {
    console.error(`  Unsupported platform: ${os}. Use 'askalf-agent daemon' instead.`);
    process.exit(1);
  }
}

function installSystemd(nodePath: string, agentPath: string, config: AgentConfig): void {
  const args = [agentPath, 'connect', config.apiKey, '--url', config.url];
  if (config.deviceName) args.push('--name', config.deviceName);

  const unit = `[Unit]
Description=AskAlf Agent — AI Workforce Device Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${args.join(' ')}
Restart=always
RestartSec=10
Environment=NODE_ENV=production
WorkingDirectory=${homedir()}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;
  const isRoot = process.getuid?.() === 0;

  if (!isRoot) {
    // Try user service instead
    const userUnitDir = join(homedir(), '.config/systemd/user');
    const userUnitPath = join(userUnitDir, `${SERVICE_NAME}.service`);

    try {
      mkdirSync(userUnitDir, { recursive: true });
      writeFileSync(userUnitPath, unit);
      execSync(`systemctl --user daemon-reload`, { stdio: 'inherit' });
      execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'inherit' });
      execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'inherit' });
      console.log(`\n  Service installed (user systemd)`);
      console.log(`  Unit:   ${userUnitPath}`);
      console.log(`  Status: systemctl --user status ${SERVICE_NAME}`);
      console.log(`  Logs:   journalctl --user -u ${SERVICE_NAME} -f`);
      console.log(`  Stop:   systemctl --user stop ${SERVICE_NAME}`);
    } catch (err) {
      console.error(`  Failed to install user service: ${err instanceof Error ? err.message : err}`);
      console.log(`\n  Try running with sudo for system-wide install:`);
      console.log(`  sudo askalf-agent install-service`);
    }
    return;
  }

  try {
    writeFileSync(unitPath, unit);
    execSync('systemctl daemon-reload', { stdio: 'inherit' });
    execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
    execSync(`systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });
    console.log(`\n  Service installed (systemd)`);
    console.log(`  Unit:   ${unitPath}`);
    console.log(`  Status: systemctl status ${SERVICE_NAME}`);
    console.log(`  Logs:   journalctl -u ${SERVICE_NAME} -f`);
    console.log(`  Stop:   systemctl stop ${SERVICE_NAME}`);
  } catch (err) {
    console.error(`  Failed to install service: ${err instanceof Error ? err.message : err}`);
  }
}

function installLaunchd(nodePath: string, agentPath: string, config: AgentConfig): void {
  const args = [agentPath, 'connect', config.apiKey, '--url', config.url];
  if (config.deviceName) args.push('--name', config.deviceName);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.askalf.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
${args.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(CONFIG_DIR, 'agent.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(CONFIG_DIR, 'agent.err')}</string>
</dict>
</plist>
`;

  const plistDir = join(homedir(), 'Library/LaunchAgents');
  const plistPath = join(plistDir, 'org.askalf.agent.plist');

  try {
    mkdirSync(plistDir, { recursive: true });
    writeFileSync(plistPath, plist);
    execSync(`launchctl load ${plistPath}`, { stdio: 'inherit' });
    console.log(`\n  Service installed (launchd)`);
    console.log(`  Plist:  ${plistPath}`);
    console.log(`  Logs:   tail -f ${join(CONFIG_DIR, 'agent.log')}`);
    console.log(`  Stop:   launchctl unload ${plistPath}`);
  } catch (err) {
    console.error(`  Failed to install service: ${err instanceof Error ? err.message : err}`);
  }
}

function installWindowsService(nodePath: string, agentPath: string, config: AgentConfig): void {
  const args = [agentPath, 'connect', config.apiKey, '--url', config.url];
  if (config.deviceName) args.push('--name', config.deviceName);

  // Check for nssm
  let hasNssm = false;
  try { execSync('where nssm', { stdio: 'ignore' }); hasNssm = true; } catch { /* not found */ }

  if (hasNssm) {
    try {
      execSync(`nssm install ${SERVICE_NAME} "${nodePath}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: 'inherit' });
      execSync(`nssm set ${SERVICE_NAME} AppDirectory "${homedir()}"`, { stdio: 'inherit' });
      execSync(`nssm set ${SERVICE_NAME} Description "AskAlf Agent — AI Workforce Device Bridge"`, { stdio: 'inherit' });
      execSync(`nssm start ${SERVICE_NAME}`, { stdio: 'inherit' });
      console.log(`\n  Service installed (Windows Service via nssm)`);
      console.log(`  Name:   ${SERVICE_NAME}`);
      console.log(`  Status: nssm status ${SERVICE_NAME}`);
      console.log(`  Stop:   nssm stop ${SERVICE_NAME}`);
    } catch (err) {
      console.error(`  Failed to install service: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // Fallback: create a VBS + BAT wrapper so the agent runs hidden (no terminal window)
  mkdirSync(CONFIG_DIR, { recursive: true });
  const batPath = join(CONFIG_DIR, 'agent-service.bat');
  const vbsPath = join(CONFIG_DIR, 'agent-service.vbs');
  const batLines = [
    '@echo off',
    `"${nodePath}" ${args.map(a => '"' + a + '"').join(' ')}`,
  ];
  writeFileSync(batPath, batLines.join('\r\n') + '\r\n');
  // VBS launcher hides the console window
  writeFileSync(vbsPath, `CreateObject("WScript.Shell").Run """${batPath}""", 0, False\r\n`);

  try {
    const trArg = '"' + vbsPath + '"';
    execSync(
      `schtasks /create /tn "${SERVICE_NAME}" /tr ${trArg} /sc onlogon /rl highest /f`,
      { stdio: 'inherit' },
    );
    // Also start it now
    execSync(`schtasks /run /tn "${SERVICE_NAME}"`, { stdio: 'inherit' });
    console.log(`\n  Service installed (Windows Scheduled Task — runs on login)`);
    console.log(`  Task:   ${SERVICE_NAME}`);
    console.log(`  Status: schtasks /query /tn "${SERVICE_NAME}"`);
    console.log(`  Stop:   schtasks /end /tn "${SERVICE_NAME}"`);
    console.log(`  Remove: askalf-agent uninstall-service`);
    console.log(`\n  For a full Windows Service, install nssm (nssm.cc) and re-run.`);
  } catch (err) {
    console.error(`  Failed to create scheduled task: ${err instanceof Error ? err.message : err}`);
    console.log(`\n  Alternative: use 'askalf-agent daemon' to run in background.`);
  }
}

function uninstallService(): void {
  const os = platform();

  if (os === 'linux') {
    try {
      execSync(`systemctl stop ${SERVICE_NAME} 2>/dev/null; systemctl disable ${SERVICE_NAME} 2>/dev/null`, { stdio: 'inherit' });
      const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;
      const userUnitPath = join(homedir(), `.config/systemd/user/${SERVICE_NAME}.service`);
      try { unlinkSync(unitPath); } catch { /* ignore */ }
      try { unlinkSync(userUnitPath); } catch { /* ignore */ }
      try { execSync('systemctl daemon-reload', { stdio: 'ignore' }); } catch { /* ignore */ }
      try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch { /* ignore */ }
      console.log('  Service removed (systemd)');
    } catch (err) {
      console.error(`  Failed: ${err instanceof Error ? err.message : err}`);
    }
  } else if (os === 'darwin') {
    const plistPath = join(homedir(), 'Library/LaunchAgents/org.askalf.agent.plist');
    try {
      execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'inherit' });
      try { unlinkSync(plistPath); } catch { /* ignore */ }
      console.log('  Service removed (launchd)');
    } catch (err) {
      console.error(`  Failed: ${err instanceof Error ? err.message : err}`);
    }
  } else if (os === 'win32') {
    try {
      execSync(`nssm stop ${SERVICE_NAME} 2>nul & nssm remove ${SERVICE_NAME} confirm 2>nul`, { stdio: 'inherit' });
    } catch { /* nssm might not exist */ }
    try {
      execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f`, { stdio: 'inherit' });
    } catch { /* task might not exist */ }
    console.log('  Service removed');
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

const command = (args.includes('--help') || args.includes('-h')) ? undefined : args[0];

switch (command) {
  case 'connect': {
    const apiKey = args[1];
    if (!apiKey) {
      console.error('Usage: askalf-agent connect <api-key> [--url wss://askalf.org] [--name my-device] [--install]');
      process.exit(1);
    }
    const urlIdx = args.indexOf('--url');
    const url = urlIdx >= 0 ? args[urlIdx + 1]! : 'wss://askalf.org';
    const nameIdx = args.indexOf('--name');
    const deviceName = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
    const shouldInstall = args.includes('--install');
    if (shouldInstall) {
      // Save config then install as service (one-shot setup)
      const device = getDeviceInfo();
      const config: AgentConfig = { apiKey, url, deviceName: deviceName || device.hostname };
      saveConfig(config);
      console.log(`\n  Config saved. Installing service...`);
      installService();
    } else {
      connect(apiKey, url, deviceName);
    }
    break;
  }
  case 'daemon':
    daemon();
    break;
  case 'install-service':
    installService();
    break;
  case 'uninstall-service':
    uninstallService();
    break;
  case 'status':
    status();
    break;
  case 'disconnect':
    disconnect();
    break;
  case 'scan':
    console.log(`\n  AskAlf Agent v${VERSION} — Capabilities Scan\n`);
    const caps = scanCapabilities();
    for (const [key, val] of Object.entries(caps)) {
      if (Array.isArray(val)) {
        console.log(`  ${key}: ${val.join(', ')}`);
      } else {
        console.log(`  ${key}: ${val}`);
      }
    }
    console.log('');
    break;
  default:
    console.log(`
  AskAlf Agent CLI v${VERSION}

  Usage:
    askalf-agent connect <api-key>     Connect this device to your fleet
    askalf-agent daemon                Run as background daemon
    askalf-agent install-service       Install as OS service (auto-start on boot)
    askalf-agent uninstall-service     Remove OS service
    askalf-agent status                Check connection and service status
    askalf-agent disconnect            Stop the running daemon
    askalf-agent scan                  Run capabilities scan (no server needed)

  Options:
    --url <url>    Server URL (default: wss://askalf.org)
    --name <name>  Device name (default: hostname)
    -v, --version  Show version
    -h, --help     Show this help

  Examples:
    askalf-agent connect sk-abc123 --url ws://myserver:3005 --name prod-box
    askalf-agent connect sk-abc123 --url ws://myserver:3005 --name prod-box --install
    askalf-agent install-service      # Runs on boot (Linux/macOS/Windows)
    askalf-agent daemon               # Background process (any OS)
`);
}
