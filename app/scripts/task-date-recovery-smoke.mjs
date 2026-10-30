import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390, 320]) for (const mode of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme: mode });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.BASE_URL}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().click();
    const select = page.getByLabel('Due date', {exact:true}); await select.waitFor();
    const before = await select.inputValue(), next = '2026-11-01';
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts');
      window.originId = (await db.tasks.toArray()).find(t => t.title === 'Set up the backup volume').id;
      const update = db.tasks.update.bind(db.tasks); let fail = true;
      window.writes = 0;
      db.tasks.update = (...args) => { window.writes++; if (fail) { fail = false; return Promise.reject(Error('Injected priority save failure')); } return update(...args); };
    });
    await select.fill(next);
    await page.getByText("Date wasn't saved. Your choice is kept here. Retry to save it.", { exact: true }).waitFor();
    assert.equal(await select.inputValue(), next);
    assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).dueDate ?? ''; }), before);
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/downloads/task-date-error-${width}-${mode}.png` });
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts'); const update = db.tasks.update.bind(db.tasks); let hold = true;
      db.tasks.update = async (...args) => { if (hold) { hold = false; await new Promise(r => window.releaseLink = r); } return update(...args); };
    });
    await page.getByRole('button', { name: 'Retry date', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.releaseLink)); assert(await select.evaluate(e => e.readOnly));
    await select.dispatchEvent('change');
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Review the weekly budget', { exact: true }).first().click();
    const other = await select.inputValue(); await page.evaluate(() => window.releaseLink());
    await page.waitForFunction(() => window.writes === 2);
    await page.waitForFunction(async wanted => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).dueDate === (wanted || null); }, next);
    assert.equal(await select.inputValue(), other); assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Set up the backup volume', { exact: true }).first().click(); assert.equal(await select.inputValue(), next);
    await select.fill('');
    await page.waitForFunction(async field => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId))[field] === null; }, 'dueDate');
    assert.equal(await select.inputValue(), '');
    assert.equal(await page.getByLabel('Deadline time (optional)', {exact:true}).count(),0);
    assert.deepEqual(errors, []); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(width, mode, 'date failure/retain/retry/duplicate/origin/reopen PASS'); await page.close();
  }
} finally { await browser.close(); }
