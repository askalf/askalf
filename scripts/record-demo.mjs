#!/usr/bin/env node
/**
 * AskAlf Demo Video Recorder
 *
 * Records a 2-minute demo of the dashboard showing:
 * 1. Overview tab (mission control)
 * 2. Fleet tab (agents)
 * 3. Command tab (dispatch a task)
 * 4. Watch execution in Live tab
 * 5. See results in Ops tab
 * 6. Brain tab (memory)
 *
 * Uses Puppeteer + puppeteer-screen-recorder
 */

import puppeteer from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3001';
const OUTPUT_FILE = 'C:/Users/masterm1nd.DOCK/Desktop/askalf-demo.mp4';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--window-size=1920,1080', '--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: false,
    fps: 30,
    videoFrame: { width: 1920, height: 1080 },
    ffmpeg_Path: 'C:/Users/masterm1nd.DOCK/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin/ffmpeg.exe',
  });

  console.log('Starting recording...');
  await recorder.start(OUTPUT_FILE);

  // Scene 1: Overview (15 seconds)
  console.log('Scene 1: Overview');
  await page.goto(`${DASHBOARD_URL}/command-center/overview`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000); // Let animations play
  await sleep(13000); // Hold on overview

  // Scene 2: Fleet (10 seconds)
  console.log('Scene 2: Fleet');
  await page.click('a[href*="fleet"], [class*="tab"]');
  await page.goto(`${DASHBOARD_URL}/command-center/fleet`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);

  // Scene 3: Command - dispatch a task (20 seconds)
  console.log('Scene 3: Command');
  await page.goto(`${DASHBOARD_URL}/command-center/command`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(3000);

  // Type a command slowly
  const input = await page.$('textarea, input[type="text"], .dispatch-input, [placeholder*="Ask"]');
  if (input) {
    await input.click();
    await sleep(500);
    const command = 'Scan the codebase for security vulnerabilities and fix any critical issues';
    for (const char of command) {
      await page.keyboard.type(char, { delay: 40 });
    }
    await sleep(2000);
    // Press Enter to send
    await page.keyboard.press('Enter');
    await sleep(15000); // Wait for dispatch + execution to start
  } else {
    console.log('No input found, waiting...');
    await sleep(17000);
  }

  // Scene 4: Live feed (15 seconds)
  console.log('Scene 4: Live');
  await page.goto(`${DASHBOARD_URL}/command-center/live`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(15000);

  // Scene 5: Ops (10 seconds)
  console.log('Scene 5: Ops');
  await page.goto(`${DASHBOARD_URL}/command-center/ops`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);

  // Scene 6: Brain (10 seconds)
  console.log('Scene 6: Brain');
  await page.goto(`${DASHBOARD_URL}/command-center/brain`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);

  // Scene 7: Code tab (10 seconds)
  console.log('Scene 7: Code');
  await page.goto(`${DASHBOARD_URL}/command-center/code`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);

  // Scene 8: Marketplace (5 seconds)
  console.log('Scene 8: Marketplace');
  await page.goto(`${DASHBOARD_URL}/command-center/marketplace`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(5000);

  // Scene 9: Back to overview (5 seconds)
  console.log('Scene 9: Back to Overview');
  await page.goto(`${DASHBOARD_URL}/command-center/overview`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(5000);

  console.log('Stopping recording...');
  await recorder.stop();
  await browser.close();

  console.log(`\nDemo recorded: ${OUTPUT_FILE}`);
  console.log('Duration: ~2 minutes');
}

main().catch(err => {
  console.error('Recording failed:', err);
  process.exit(1);
});
