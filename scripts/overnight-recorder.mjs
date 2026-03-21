/**
 * AskAlf Overnight Timelapse Recorder
 *
 * Captures the dashboard every 30 seconds while agents work overnight.
 * Produces a folder of screenshots that can be stitched into a timelapse video.
 *
 * Usage: node scripts/overnight-recorder.mjs [hours] [dashboard-url]
 * Default: 8 hours, http://localhost:3001
 *
 * Output: screenshots/overnight-YYYY-MM-DD/frame-XXXX.png
 * To stitch: ffmpeg -framerate 30 -i frame-%04d.png -c:v libx264 -pix_fmt yuv420p overnight.mp4
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const HOURS = parseFloat(process.argv[2] || '8');
const DASHBOARD_URL = process.argv[3] || 'http://localhost:3001';
const INTERVAL_MS = 30_000; // screenshot every 30 seconds
const TOTAL_FRAMES = Math.ceil((HOURS * 3600 * 1000) / INTERVAL_MS);

// Tab rotation: cycle through tabs to show activity across the platform
const TABS = [
  { path: '/command-center/overview', name: 'Overview', weight: 4 },
  { path: '/command-center/ops', name: 'Ops', weight: 2 },
  { path: '/command-center/fleet', name: 'Team', weight: 2 },
  { path: '/command-center/live', name: 'Live', weight: 1 },
  { path: '/command-center/brain', name: 'Brain', weight: 1 },
];

// Build weighted rotation
const rotation = [];
for (const tab of TABS) {
  for (let i = 0; i < tab.weight; i++) rotation.push(tab);
}

const today = new Date().toISOString().split('T')[0];
const outDir = path.join('screenshots', `overnight-${today}`);
fs.mkdirSync(outDir, { recursive: true });

console.log(`[Recorder] Starting overnight capture`);
console.log(`  Duration: ${HOURS} hours (${TOTAL_FRAMES} frames)`);
console.log(`  Dashboard: ${DASHBOARD_URL}`);
console.log(`  Output: ${outDir}/`);
console.log(`  Interval: ${INTERVAL_MS / 1000}s`);
console.log();

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();

  // Login if needed — try to access dashboard
  console.log('[Recorder] Navigating to dashboard...');
  await page.goto(`${DASHBOARD_URL}/command-center/overview`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Check if we got redirected to login
  const url = page.url();
  if (url.includes('/login') || url.includes('/auth')) {
    console.log('[Recorder] Login page detected — attempting auto-login...');
    // Try default credentials
    try {
      await page.type('input[type="email"], input[name="email"]', 'admin@askalf.org', { delay: 50 });
      await page.type('input[type="password"], input[name="password"]', process.env.ADMIN_PASSWORD || 'admin', { delay: 50 });
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
    } catch {
      console.log('[Recorder] Auto-login failed — continuing anyway (may show login page)');
    }
  }

  // Wait for initial render
  await new Promise(r => setTimeout(r, 3000));

  console.log(`[Recorder] Capturing ${TOTAL_FRAMES} frames over ${HOURS} hours...`);
  console.log();

  let frameNum = 0;

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const tab = rotation[i % rotation.length];
    const frameStr = String(frameNum).padStart(5, '0');
    const filename = `frame-${frameStr}.png`;

    try {
      // Navigate to tab
      await page.goto(`${DASHBOARD_URL}${tab.path}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000)); // let animations settle

      // Take screenshot
      await page.screenshot({
        path: path.join(outDir, filename),
        fullPage: false,
      });

      const now = new Date().toLocaleTimeString();
      const elapsed = ((i * INTERVAL_MS) / 3600000).toFixed(1);
      const remaining = (((TOTAL_FRAMES - i) * INTERVAL_MS) / 3600000).toFixed(1);
      console.log(`  [${now}] Frame ${frameStr} — ${tab.name} (${elapsed}h elapsed, ${remaining}h remaining)`);
    } catch (err) {
      console.warn(`  [WARN] Frame ${frameStr} failed: ${err.message}`);
    }

    frameNum++;

    // Wait for next interval
    if (i < TOTAL_FRAMES - 1) {
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log();
  console.log(`[Recorder] Capture complete! ${frameNum} frames saved to ${outDir}/`);
  console.log();
  console.log('To create timelapse video:');
  console.log(`  cd ${outDir}`);
  console.log(`  ffmpeg -framerate 30 -i frame-%05d.png -c:v libx264 -pix_fmt yuv420p -vf "scale=1920:1080" overnight-timelapse.mp4`);
  console.log();
  console.log('For a 2-minute video from 8 hours of screenshots (960 frames at 30fps = 32 seconds):');
  console.log(`  ffmpeg -framerate 8 -i frame-%05d.png -c:v libx264 -pix_fmt yuv420p -vf "scale=1920:1080" overnight-2min.mp4`);

  await browser.close();
}

run().catch(err => {
  console.error('[Recorder] Fatal error:', err);
  process.exit(1);
});
