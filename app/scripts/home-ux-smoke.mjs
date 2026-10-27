// Sample-only Home UX checks; expects Vite at BASE_URL (default :5173).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
 for (const width of [1440, 390, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173'}/?sample`);
  await page.getByRole('button', { name: 'View all 6 open tasks' }).waitFor();
  assert.equal(await page.locator('.home-load-count').count(), 7);
  assert.equal(await page.locator('.home-load-count').first().textContent(), '6');
  assert(await page.getByText('Due today or earlier', { exact: false }).count());
  if (width < 500) {
    for (const control of await page.locator('.home-check').all()) {
      const box = await control.boundingBox();
      assert(box && box.width >= 44 && box.height >= 44);
    }
  }
  await page.locator('.home-week .load-col').first().click();
  await page.locator('.load-drill').waitFor();
  await page.getByRole('button', { name: 'Customize widgets', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Habits', exact: true }).click();
  await page.locator('.home-habits').waitFor({ state: 'detached' });
  await page.getByRole('checkbox', { name: 'Habits', exact: true }).click();
  await page.locator('.home-habits').waitFor();
  await page.getByRole('button', { name: 'Customize widgets', exact: true }).click();
  await page.getByRole('button', { name: 'Check Morning walk for today', exact: true }).click();
  await page.getByRole('button', { name: 'Uncheck Morning walk for today', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View all 6 open tasks' }).click();
  await page.getByRole('heading', { name: /^Today/ }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(`${width}px Home chart, widget controls, habit action and full-list navigation passed`);
  await page.close();
 }
} finally { await browser.close(); }
