import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390, 320]) for (const mode of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme: mode });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.BASE_URL}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().click();
    const select = page.getByRole('combobox', { name: 'Priority', exact: true }); await select.waitFor();
    const before = await select.inputValue(), next = before === '1' ? '2' : '1';
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts');
      window.originId = (await db.tasks.toArray()).find(t => t.title === 'Set up the backup volume').id;
      const update = db.tasks.update.bind(db.tasks); let fail = true;
      window.writes = 0;
      db.tasks.update = (...args) => { window.writes++; if (fail) { fail = false; return Promise.reject(Error('Injected priority save failure')); } return update(...args); };
    });
    await select.selectOption(next);
    await page.getByText("Priority wasn't saved. Your selection is kept here. Retry to save it.", { exact: true }).waitFor();
    assert.equal(await select.inputValue(), next);
    assert.equal(String(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).priority; })), before);
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/downloads/task-priority-error-${width}-${mode}.png` });
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts'); const update = db.tasks.update.bind(db.tasks); let hold = true;
      db.tasks.update = async (...args) => { if (hold) { hold = false; await new Promise(r => window.releasePriority = r); } return update(...args); };
    });
    await page.getByRole('button', { name: 'Retry priority', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.releasePriority)); assert(await select.isDisabled());
    await select.dispatchEvent('change');
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Review the weekly budget', { exact: true }).first().click();
    const other = await select.inputValue(); await page.evaluate(() => window.releasePriority());
    await page.waitForFunction(() => window.writes === 2);
    await page.waitForFunction(async wanted => { const { db } = await import('/src/db.ts'); return (await db.tasks.get(window.originId)).priority === Number(wanted); }, next);
    assert.equal(await select.inputValue(), other); assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.getByText('Set up the backup volume', { exact: true }).first().click(); assert.equal(await select.inputValue(), next);
    assert.deepEqual(errors, []); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(width, mode, 'priority failure/retain/retry/duplicate/origin/reopen PASS'); await page.close();
  }
} finally { await browser.close(); }
