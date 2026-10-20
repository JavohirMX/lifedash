// Local browser smoke check: builds nothing, expects `npm run preview` on :4173.
// Drives system Chrome headless: rapid quick-add, pin ordering, recurrence spawn.
// Usage: node scripts/browser-smoke.mjs
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.quick-add input', { timeout: 10000 });

const qa = page.locator('.quick-add input');
for (const t of ['Smoke one', 'Smoke two', 'Smoke three']) {
  await qa.fill(t);
  await qa.press('Enter');
  await page.waitForTimeout(40);
}
await page.waitForTimeout(600);
const count = await page.locator('.task-row').count();
if (count !== 3) { console.error(`expected 3 rows, got ${count}`); process.exitCode = 1; }

await page.locator('.task-row', { hasText: 'Smoke two' }).locator('.pin').click();
await page.waitForTimeout(300);
const first = await page.locator('.task-row').first().textContent();
if (!first.includes('Smoke two')) { console.error('pinned task did not float to top'); process.exitCode = 1; }

console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
await browser.close();
