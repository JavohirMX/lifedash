// Sample-only regression. Start Vite and set BASE_URL when not using :5173.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173'}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().waitFor();
    const opener = page.locator('.quick-add input');
    await opener.focus();
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'Tab escaped palette');
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' });
    assert(await opener.evaluate(el => document.activeElement === el), 'opener focus not restored');
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' });
    await opener.blur();
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    await page.keyboard.press('Control+k');
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, 'palette opened over Settings');
    await page.keyboard.press('?');
    assert.equal(await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(), 0, 'help opened over Settings');
    await page.keyboard.press('Escape');
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Plan with AI', exact: true }).click();
    await page.getByRole('dialog', { name: 'Plan with AI', exact: true }).waitFor();
    const source = page.getByRole('radiogroup', { name: 'Planner source' });
    await source.getByRole('radio', { name: 'On-device', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByLabel('Provider API base URL').waitFor();
    await page.keyboard.press('ArrowLeft');
    await page.getByLabel('Provider API base URL').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+k');
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, 'palette opened over native dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Plan with AI', exact: true }).waitFor({ state: 'detached' });
    if (width < 500) {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('dialog', { name: 'More navigation' }).waitFor();
      for (let i = 0; i < 35; i++) {
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => !!document.activeElement?.closest('.mobile-sheet')), 'Tab left mobile navigation');
      }
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'More navigation' }).waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
      await page.getByRole('dialog', { name: 'Restore backup' }).waitFor();
      assert.equal(await page.getByRole('dialog', { name: 'More navigation' }).count(), 0);
      await page.keyboard.press('Escape');
    }
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await exportButton.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('menu', { name: 'Export format' }).waitFor();
    assert(await page.getByRole('menuitem', { name: /^JSON backup/ }).evaluate(el => el === document.activeElement));
    await page.keyboard.press('ArrowDown');
    assert(await page.getByRole('menuitem', { name: /^Markdown/ }).evaluate(el => el === document.activeElement));
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: 'Export format' }).waitFor({ state: 'detached' });
    assert(await exportButton.evaluate(el => el === document.activeElement));
    if (width < 500) await page.keyboard.press('Escape');
    await page.locator(width < 500 ? '.bottombar' : '.sidebar').getByRole('button', { name: /^Today/ }).click();
    const taskButton = page.locator('.task-row .task-main').first();
    await taskButton.click();
    await page.getByLabel('Task title', { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Task title');
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Task title', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Task title', { exact: true }).waitFor({ state: 'detached' });
    assert(await taskButton.evaluate(el => el === document.activeElement));
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator(width < 500 ? '.mobile-sheet' : '.sidebar').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('radio', { name: 'Rough', exact: true }).focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent?.trim() === 'Great');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent?.trim() === 'Rough');
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sync Connect to your self-hosted server' }).click();
    await page.getByRole('dialog', { name: 'Sync', exact: true }).waitFor();
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
    await page.keyboard.press('Escape');
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator(width < 500 ? '.mobile-sheet' : '.sidebar').getByRole('button', { name: 'Notes', exact: true }).click();
    await page.locator('.note-item').first().click();
    const editor = page.locator('.tiptap');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bold', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.activeElement?.closest('.tiptap'));
    await page.keyboard.type('Keyboard formatting probe');
    await editor.locator('strong', { hasText: 'Keyboard formatting probe' }).waitFor();
    const noteTitle = await page.getByLabel('Note title', { exact: true }).inputValue();
    await page.locator(width < 500 ? '.bottombar' : '.sidebar').getByRole('button', { name: /^Today/ }).click();
    await page.waitForFunction(async title => {
      const { db } = await import('/src/db.ts');
      return (await db.notes.toArray()).some(note => note.title === title && note.note.includes('Keyboard formatting probe'));
    }, noteTitle);
    if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator(width < 500 ? '.mobile-sheet' : '.sidebar').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.locator('.tiptap').fill('Pending journal save survives changing the day');
    await page.getByLabel('Previous day', { exact: true }).click();
    await page.waitForFunction(async () => {
      const { db } = await import('/src/db.ts');
      return (await db.journal.toArray()).some(entry => entry.note.includes('Pending journal save survives'));
    });
    console.log(`${width}px palette containment, Escape, focus return and modal shortcut guard passed`);
    await page.close();
  }
} finally { await browser.close(); }
