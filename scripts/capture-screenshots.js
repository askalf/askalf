const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DASHBOARD = 'http://localhost:3001';
const OUT = path.join(__dirname, '..', 'screenshots');

async function run() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    timeout: 60000,
    protocolTimeout: 60000,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

  // Helper: click tab by text
  async function clickTab(label) {
    const tabs = await page.$$('.ud-tab');
    for (const tab of tabs) {
      const text = await page.evaluate(el => el.textContent.trim(), tab);
      if (text.includes(label)) {
        await tab.click();
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
    }
    return false;
  }

  // 1. Home / Ask Alf
  console.log('Navigating to dashboard...');
  await page.goto(DASHBOARD, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUT, 'home.png') });
  console.log('  home.png');

  // 2. Workspace (Claude Code + Codex terminals)
  if (await clickTab('Workspace')) {
    await new Promise(r => setTimeout(r, 5000)); // extra wait for terminals
    await page.screenshot({ path: path.join(OUT, 'workspace-claude.png') });
    console.log('  workspace-claude.png');

    // Try clicking Codex tab if visible
    const subTabs = await page.$$('[role="tab"], .terminal-tab, .workspace-tab');
    for (const st of subTabs) {
      const text = await page.evaluate(el => el.textContent.trim(), st);
      if (text.includes('Codex') || text.includes('codex')) {
        await st.click();
        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: path.join(OUT, 'workspace-codex.png') });
        console.log('  workspace-codex.png');
        break;
      }
    }
  }

  // 3. Team / Fleet
  if (await clickTab('Team')) {
    await page.screenshot({ path: path.join(OUT, 'team.png') });
    console.log('  team.png');
  }

  // 4. Ops
  if (await clickTab('Ops')) {
    await page.screenshot({ path: path.join(OUT, 'ops.png') });
    console.log('  ops.png');
  }

  // 5. Memory / Brain
  if (await clickTab('Memory')) {
    await page.screenshot({ path: path.join(OUT, 'memory.png') });
    console.log('  memory.png');
  }

  // 6. Marketplace
  if (await clickTab('Marketplace')) {
    await page.screenshot({ path: path.join(OUT, 'marketplace.png') });
    console.log('  marketplace.png');
  }

  // 7. Settings
  if (await clickTab('Settings')) {
    await page.screenshot({ path: path.join(OUT, 'settings.png') });
    console.log('  settings.png');
  }

  await browser.close();
  console.log(`\nAll screenshots saved to ${OUT}`);
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT, f));
    console.log(`  ${f}: ${(stat.size / 1024).toFixed(0)}KB`);
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
