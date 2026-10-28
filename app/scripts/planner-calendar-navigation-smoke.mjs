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
    await page.evaluate(before => { window.__before = before; }, before);
    await page.evaluate(async mode => {
      document.documentElement.dataset.theme = mode;
      const { db } = await import('/src/db.ts');
      const task = (await db.tasks.toArray()).find(t => t.title === 'Review the weekly budget');
      window.earlyTaskId = task.id;
      for (const [i, time] of ['00:00', '04:30', '05:59', '06:00', '23:59'].entries()) {
        await db.tasks.put({ ...task, id: i === 0 ? task.id : `early-example-${i}`, title: `Timeline example ${time}`, dueTime: time });
      }
      if (!window.__before) {
        for (const [i, time] of ['not-a-time', '24:00', '04:99', '99:00'].entries()) {
          await db.tasks.put({ ...task, id: `malformed-example-${i}`, title: `Malformed example ${i}`, dueTime: time });
        }
      }
    }, mode);
    async function nav(name) {
      if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.locator(width < 500 ? '.mobile-sheet' : '.sidebar').getByRole('button', { name, exact: true }).click();
    }
    await nav('Calendar');
    await page.locator('.cal-cell.today .cal-day').click();
    await page.getByRole('region', { name: 'Selected day tasks' }).waitFor();
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    assert.equal(await page.getByRole('region', { name: 'Selected day tasks' }).count(), before ? 1 : 0);
    await page.screenshot({ path: `/downloads/calendar-month-${before ? 'before' : 'after'}-${width}-${mode}.png` });
    if (!before) {
      await page.locator('.cal-cell:not(.outside) .cal-day').first().click();
      await page.getByRole('region', { name: 'Selected day tasks' }).waitFor();
      await page.getByRole('button', { name: 'Today', exact: true }).click();
      assert.equal(await page.getByRole('region', { name: 'Selected day tasks' }).count(), 0);
      await page.locator('.cal-cell.today .cal-day').click();
      await page.getByRole('button', { name: 'Previous month', exact: true }).click();
      assert.equal(await page.getByRole('region', { name: 'Selected day tasks' }).count(), 0);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(width, mode, before ? 'confirmed pre06 misplacement / stale selected day' : 'Calendar selected day resets on month/Today navigation PASS');
    await page.close();
  }
} finally { await browser.close(); }
