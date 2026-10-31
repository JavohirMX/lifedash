const { chromium } = require('playwright-core');
const SYNC = JSON.stringify({ url: 'http://localhost:8799', username: 'e2e', token: process.env.E2E_TOKEN });
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((s) => localStorage.setItem('lifedash-sync', s), SYNC);
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  // sync via dialog
  await p.locator('button.nav:visible').filter({ hasText: 'Settings' }).first().click();
  await p.waitForTimeout(400);
  await p.locator('button.settings-row').filter({ hasText: 'Sync' }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Sync now' }).click();
  await p.waitForTimeout(2500);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  const nav = await p.locator('button.nav:visible').allInnerTexts().catch(() => []);
  console.log('nav:', JSON.stringify(nav));
  const bodyText = await p.locator('main, [role=main], .app, body').first().innerText();
  console.log('main text head:', bodyText.replace(/\n/g, ' | ').slice(0, 400));
  await p.screenshot({ path: '/tmp/e2e-probe.png' });
  const count = await p.evaluate(async () => {
    const { db } = await import('/src/db.ts').catch(() => ({}));
    return 'n/a';
  });
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
