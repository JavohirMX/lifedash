import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const base=process.env.BASE_URL??'http://127.0.0.1:4183';
 await page.goto(`${base}/scripts/fixtures/editor-recovery.html`);
 await page.locator('.tiptap').fill('UNSAVED PRIVATE NOTE');await page.getByRole('button',{name:'Retry save'}).waitFor();
 await page.getByRole('button',{name:'Switch record kind'}).click();await page.getByRole('heading',{name:'tasks',exact:true}).waitFor();assert.equal((await page.locator('.tiptap').innerText()).trim(),'Task original');
 await page.getByRole('button',{name:'Switch record kind'}).click();await page.getByRole('heading',{name:'notes',exact:true}).waitFor();assert.equal((await page.locator('.tiptap').innerText()).trim(),'UNSAVED PRIVATE NOTE');
 await page.goto(`${base}/scripts/fixtures/editor-recovery.html?pending`);
 await page.locator('.tiptap').fill('LATEST PENDING TEXT');await page.waitForTimeout(550);await page.getByRole('button',{name:'Toggle editor'}).click();await page.getByRole('button',{name:'Toggle editor'}).click();await page.getByText('Your latest text is restored. A save is still in progress.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.readSaved()),'ORIGINAL');
 await page.evaluate(()=>window.releaseSave());await page.waitForFunction(()=>window.readSaved()==='LATEST PENDING TEXT');await page.getByText('Saved on this device',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Retry save'}).count(),0);
 console.log('Collection identity isolation and pending-save remount reconciliation PASS');
} finally {await browser.close()}
