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
    await nav('Planner');
    await page.getByText('Timeline example 00:00', { exact: true }).waitFor();
    for (const time of ['00:00', '04:30', '05:59', '06:00', '23:59']) {
      const row = page.locator('.hour-row').filter({ has: page.getByText(`Timeline example ${time}`, { exact: true }) });
      assert.equal(await row.locator('.hour-label').textContent(), `${before ? Math.max(6, Number(time.slice(0, 2))).toString().padStart(2, '0') : time.slice(0, 2)}:00`);
    }
    if (!before) assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return (await db.tasks.get('malformed-example-0')).dueTime; }), 'not-a-time');
    await page.screenshot({ path: `/downloads/planner-early-${before ? 'before' : 'after'}-${width}-${mode}.png` });
    if (!before) {
      await page.getByRole('button', { name: 'Set time for Timeline example 00:00', exact: true }).click();
      await page.getByLabel('Task time', { exact: true }).fill('02:15');
      await page.locator('.hour-row').filter({ has: page.getByText('Timeline example 00:00', { exact: true }) }).locator('.hour-label').filter({ hasText: '02:00' }).waitFor();
      assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.earlyTaskId)).dueTime; }), '02:15');
    }
    if (!before) {
      await page.evaluate(async () => { const { db } = await import('/src/db.ts'); await db.tasks.filter(t => t.title.startsWith('Timeline example')).modify({ dueTime: null }); });
      await page.locator('.hour-row').first().locator('.hour-label').filter({ hasText: '06:00' }).waitFor();
      assert.equal(await page.locator('.hour-row').count(), 18);
      assert.equal(await page.getByText('Water the plants', { exact: true }).count(), 1);
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
    console.log(width, mode, before ? 'confirmed pre06 misplacement / stale selected day' : 'early-hour placement / picker persistence / month navigation PASS');
    await page.close();
  }
} finally { await browser.close(); }
