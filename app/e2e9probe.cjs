const { chromium } = require('playwright-core');
const SYNC = JSON.stringify({ url: 'http://localhost:8799', username: 'e2e', token: process.env.E2E_TOKEN });
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((s) => { localStorage.setItem('lifedash-sync', s); localStorage.setItem('lifedash-theme', 'dark'); }, SYNC);
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  console.log('nav buttons:', await p.locator('button.nav:visible').allInnerTexts());
  console.log('all buttons sample:', (await p.locator('button:visible').allInnerTexts()).slice(0, 12));
  await p.screenshot({ path: '/tmp/e2e9-probe.png' });
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
