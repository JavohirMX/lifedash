// Isolated sample-data keyboard check. Start Vite, then run:
// BASE_URL=http://127.0.0.1:5173 node scripts/dialog-keyboard-smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173'}/?sample`);
    await page.getByText('Set up the backup volume', { exact: true }).first().waitFor();
    const open = async name => {
      if (width < 500) await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    const checkReturn = async name => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(expected => document.activeElement?.textContent?.trim() === expected || document.activeElement?.getAttribute('aria-label') === expected, width < 500 ? 'More' : name);
    };
    await open('Settings');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'Tab left Settings');
    }
    await page.getByRole('button', { name: 'Appearance Style, light mode and dark mode' }).click();
    await page.getByRole('dialog', { name: 'Appearance', exact: true }).waitFor();
    const styleGroup = page.getByRole('radiogroup', { name: 'Style', exact: true });
    await styleGroup.getByRole('radio', { name: /^Paper / }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.documentElement.dataset.style === 'polar');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-checked')), 'true');
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.documentElement.dataset.style === 'paper');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-preview')), 'paper');
    const modeGroup = page.getByRole('radiogroup', { name: 'Mode', exact: true });
    await modeGroup.getByRole('radio', { name: 'System', exact: true }).focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await checkReturn('Settings');
    await open('Import');
    await page.getByRole('dialog', { name: 'Import tasks', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'TEXTAREA');
    await checkReturn('Import');
    await open('Automation');
    await page.getByRole('dialog', { name: 'Automation rules', exact: true }).waitFor();
    await checkReturn('Automation');
    console.log(`${width}px Settings/Appearance/Import/Automation focus checks passed`);
    await page.close();
  }
} finally { await browser.close(); }
