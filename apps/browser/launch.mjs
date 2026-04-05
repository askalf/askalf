/**
 * AskAlf Browser Bridge — Stealth Chromium Launcher
 *
 * Uses puppeteer-extra with stealth plugin to evade bot detection.
 * Exposes CDP on port 9222 via socat (Chromium binds to localhost only).
 * Routes through HTTP_PROXY (Gluetun VPN) if set.
 */

import { execSync, spawn } from 'child_process';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const DEBUG_PORT = 9223; // internal — socat forwards 9222 → 9223
const EXPOSE_PORT = 9222;

// Start socat to forward 0.0.0.0:9222 → 127.0.0.1:9223
const socat = spawn('socat', [
  `TCP-LISTEN:${EXPOSE_PORT},fork,reuseaddr,bind=0.0.0.0`,
  `TCP:127.0.0.1:${DEBUG_PORT}`,
], { stdio: 'inherit' });

socat.on('error', (err) => {
  console.error('[Browser] socat failed:', err.message);
});

// Build Chrome args
const args = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter',
  '--disable-extensions',
  '--disable-background-networking',
  '--no-first-run',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-allow-origins=*',
  '--user-data-dir=/home/browser/data',
  '--window-size=1920,1080',
  '--lang=en-US',
];

// Add proxy if VPN is configured
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  args.push(`--proxy-server=${proxy}`);
  console.log(`[Browser] Routing through VPN proxy: ${proxy}`);
}

console.log('[Browser] Launching stealth Chromium...');

try {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const wsEndpoint = browser.wsEndpoint();
  console.log(`[Browser] Stealth Chromium running`);
  console.log(`[Browser] CDP: ws://127.0.0.1:${DEBUG_PORT}/...`);
  console.log(`[Browser] External: ws://0.0.0.0:${EXPOSE_PORT}/... (via socat)`);

  // Keep alive — close only on SIGTERM
  process.on('SIGTERM', async () => {
    console.log('[Browser] Shutting down...');
    await browser.close();
    socat.kill();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Browser] Shutting down...');
    await browser.close();
    socat.kill();
    process.exit(0);
  });

  // Periodically log status
  setInterval(async () => {
    try {
      const pages = await browser.pages();
      console.log(`[Browser] Alive — ${pages.length} page(s) open`);
    } catch {
      console.error('[Browser] Browser disconnected');
      process.exit(1);
    }
  }, 60000);

} catch (err) {
  console.error('[Browser] Failed to launch:', err.message);
  socat.kill();
  process.exit(1);
}
