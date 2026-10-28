import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const before = process.env.BEFORE === '1';
try {
  for (const width of [1440, 390, 320]) for (const mode of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.BASE_URL}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().waitFor();
    await page.evaluate(async mode => {
      document.documentElement.dataset.theme = mode;
      const { db } = await import('/src/db.ts');
      const task = (await db.tasks.toArray()).find(t => t.title === 'Review the weekly budget');
      const times = ['06:59', '06:01', '06:30', '06:30'];
      for (const [i, dueTime] of times.entries()) {
        await db.tasks.put({ ...task, id: `time-order-${i}`, title: `Time order ${i} ${dueTime}`, order: 100 + i, dueTime });
      }
      window.originalTimeTasks = await db.tasks.filter(t => t.id.startsWith('time-order-')).toArray();
    }, mode);
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator(width < 500 ? '.mobile-sheet' : '.sidebar').getByRole('button', { name: 'Planner', exact: true }).click();
    await page.getByText('Time order 0 06:59', { exact: true }).waitFor();
    const row = page.locator('.hour-row').filter({ has: page.locator('.hour-label').getByText('06:00', { exact: true }) });
    const titles = await row.locator('.task-title').allTextContents();
    assert.deepEqual(titles.filter(t => t.startsWith('Time order')), before ? ['Time order 0 06:59', 'Time order 1 06:01', 'Time order 2 06:30', 'Time order 3 06:30'] : ['Time order 1 06:01', 'Time order 2 06:30', 'Time order 3 06:30', 'Time order 0 06:59']);
    assert(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return JSON.stringify(await db.tasks.filter(t => t.id.startsWith('time-order-')).toArray()) === JSON.stringify(window.originalTimeTasks); }));
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/downloads/planner-order-${before ? 'before' : 'after'}-${width}-${mode}.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(width, mode, before ? 'reverse chronological display confirmed' : 'chronological display / stable equal times / persisted order unchanged PASS');
    await page.close();
  }
} finally { await browser.close(); }
