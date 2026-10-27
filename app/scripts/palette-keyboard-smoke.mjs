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
    await page.keyboard.press('Control+k');
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, 'palette opened over native dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Plan with AI', exact: true }).waitFor({ state: 'detached' });
    console.log(`${width}px palette containment, Escape, focus return and modal shortcut guard passed`);
    await page.close();
  }
} finally { await browser.close(); }
