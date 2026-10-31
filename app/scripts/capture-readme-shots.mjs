import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const shotsDir = resolve(root, 'shots');
await mkdir(shotsDir, { recursive: true });

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const baseUrl = process.env.BASE_URL || 'http://localhost:5200';

try {
  // 1. Desktop Light (Home, Planner, Habits, Journal, Today)
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  await page.goto(`${baseUrl}/?sample`);
  await page.getByText('Set up the backup volume', { exact: true }).first().waitFor();
  await page.evaluate(() => {
    document.querySelector('.sample-banner')?.remove();
    return document.fonts.ready;
  });

  const nav = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name: new RegExp('^' + name) }).first().click();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.sample-banner')?.remove());
  };

  // Home (light)
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(shotsDir, 'combined-home.png'), fullPage: false });
  await page.screenshot({ path: resolve(shotsDir, 'home-desktop.png'), fullPage: false });

  // Planner
  await nav('Planner');
  await page.screenshot({ path: resolve(shotsDir, 'planner.png'), fullPage: false });

  // Habits
  await nav('Habits');
  await page.screenshot({ path: resolve(shotsDir, 'habits-past-toggle.png'), fullPage: false });
  await page.screenshot({ path: resolve(shotsDir, 'habits.png'), fullPage: false });

  // Journal
  await nav('Journal');
  await page.screenshot({ path: resolve(shotsDir, 'journal.png'), fullPage: false });

  await page.close();

  // 2. Desktop Dark (Week, Home)
  const darkPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark'
  });

  await darkPage.goto(`${baseUrl}/?sample`);
  await darkPage.getByText('Set up the backup volume', { exact: true }).first().waitFor();
  await darkPage.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('.sample-banner')?.remove();
    return document.fonts.ready;
  });

  const darkNav = async (name) => {
    await darkPage.locator('.sidebar').getByRole('button', { name: new RegExp('^' + name) }).first().click();
    await darkPage.waitForTimeout(300);
    await darkPage.evaluate(() => document.querySelector('.sample-banner')?.remove());
  };

  await darkNav('Week');
  await darkPage.screenshot({ path: resolve(shotsDir, 'week-nav-overdue.png'), fullPage: false });
  await darkPage.screenshot({ path: resolve(shotsDir, 'week-dark.png'), fullPage: false });

  await darkNav('Home');
  await darkPage.screenshot({ path: resolve(shotsDir, 'home-dark.png'), fullPage: false });

  await darkPage.close();

  // 3. Mobile Light (Home, Planner)
  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2
  });

  await mobilePage.goto(`${baseUrl}/?sample`);
  await mobilePage.getByText('Set up the backup volume', { exact: true }).first().waitFor();
  await mobilePage.evaluate(() => {
    document.querySelector('.sample-banner')?.remove();
    return document.fonts.ready;
  });

  await mobilePage.waitForTimeout(300);
  await mobilePage.screenshot({ path: resolve(shotsDir, 'home-mobile.png'), fullPage: false });

  await mobilePage.close();
  console.log('Successfully captured curated screenshots!');
} finally {
  await browser.close();
}
