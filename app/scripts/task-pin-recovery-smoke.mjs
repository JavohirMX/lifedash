import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390, 320]) for (const mode of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme: mode });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.BASE_URL}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().click();
    const select = page.getByRole('checkbox', { name: 'Pinned to top', exact: true }); await select.waitFor();
    const before = await select.isChecked(), next = !before;
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts');
      window.originId = (await db.tasks.toArray()).find(t => t.title === 'Set up the backup volume').id;
      const update = db.tasks.update.bind(db.tasks); let fail = true;
      window.writes = 0;
      db.tasks.update = (...args) => { window.writes++; if (fail) { fail = false; return Promise.reject(Error('Injected pin save failure')); } return update(...args); };
    });
    await select.click();
    await page.getByText("Pin change wasn't saved. Your choice is kept here. Retry to save it.", { exact: true }).waitFor();
    assert.equal(await select.isChecked(), next);
    assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).pinned; }), before);
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/downloads/task-pin-error-${width}-${mode}.png` });
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts'); const update = db.tasks.update.bind(db.tasks); let hold = true;
      db.tasks.update = async (...args) => { if (hold) { hold = false; await new Promise(r => window.releasePin = r); } return update(...args); };
    });
    await page.getByRole('button', { name: 'Retry pin', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.releasePin)); assert(await select.isDisabled());
    await select.dispatchEvent('change');
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Review the weekly budget', { exact: true }).first().click();
    const other = await select.isChecked(); await page.evaluate(() => window.releasePin());
    await page.waitForFunction(() => window.writes === 2);
    await page.waitForFunction(async wanted => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).pinned === wanted; }, next);
    assert.equal(await select.isChecked(), other); assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Set up the backup volume', { exact: true }).first().click(); assert.equal(await select.isChecked(), next);
    assert.deepEqual(errors, []); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(width, mode, 'pin failure/retain/retry/duplicate/origin/reopen PASS'); await page.close();
  }
} finally { await browser.close(); }
