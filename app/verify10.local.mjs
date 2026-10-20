import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.search-box');

// Habits: create one (every day), mark done
await page.locator('.nav', { hasText: 'Habits' }).click();
await page.locator('button', { hasText: '+ New habit' }).click();
await page.locator('.habit-add input').fill('Read 20 min');
await page.locator('.habit-add input').press('Enter');
await page.waitForTimeout(400);
await page.locator('.habit-toggle').click();
await page.waitForTimeout(300);
// second habit, weekdays only
await page.locator('button', { hasText: '+ New habit' }).click();
await page.locator('.habit-add input').fill('Gym');
// turn off Sunday(0) and Saturday(6): click those day buttons
await page.locator('.wd').nth(0).click();
await page.locator('.wd').nth(6).click();
await page.locator('.habit-add input').press('Enter');
await page.waitForTimeout(400);
await page.screenshot({ path: '/downloads/19-habits.png' });
console.log('habit cards:', await page.locator('.habit-card').count());
console.log('done today label:', await page.locator('.habit-toggle').first().textContent());

// Planner: create a task for today, drag from Anytime to 10:00
await page.locator('.nav', { hasText: 'Today' }).first().click();
const qa = page.locator('.quick-add input');
await qa.fill('Deep work block'); await qa.press('Enter'); await page.waitForTimeout(400);
await page.locator('.nav', { hasText: 'Planner' }).click();
await page.waitForTimeout(300);
const src = page.locator('.anytime .task-row', { hasText: 'Deep work block' });
const dst = page.locator('.hour-row', { hasText: '10:00' });
const sb = await src.boundingBox();
const dbb = await dst.boundingBox();
await page.mouse.move(sb.x + 200, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(dbb.x + 300, dbb.y + dbb.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log('10:00 slot has task:', await page.locator('.hour-row', { hasText: '10:00' }).locator('.task-row', { hasText: 'Deep work block' }).count());
await page.screenshot({ path: '/downloads/20-planner.png' });
await browser.close();
console.log('DONE');
