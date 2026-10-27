import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {for(const width of [1440,390,320]) for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width,height:844}});
 await page.addInitScript(theme=>localStorage.setItem('ld-theme-mode',theme),theme);
 await page.goto(`${process.env.BASE_URL??'http://127.0.0.1:4183'}/?sample`);
 await page.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const input=page.getByRole('textbox',{name:'New task'}).first();
 await input.fill('Review the garden tomorrow 10am #home');
 await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(200); await page.screenshot({path:`/downloads/capture-after-${width}-${theme}.png`});
 await input.fill('tomorrow #home'); await input.press('Enter');
 await page.getByText('Add a task name as well as dates or tags. Your text is still here.').waitFor();
 assert.equal(await input.inputValue(),'tomorrow #home');
 await page.evaluate(()=>{const orig=IDBObjectStore.prototype.add; let fail=true; IDBObjectStore.prototype.add=function(...args){if(this.name==='tasks'&&fail){fail=false;throw new DOMException('Injected storage failure','QuotaExceededError')}return orig.apply(this,args)}});
 await input.fill('Retain this failed capture #work'); await page.locator('.quick-add-submit').first().click();
 await page.getByText('Retain this failed capture #work',{exact:true}).waitFor();
 const nav=async name=>{if(width<500)await page.getByRole('button',{name:'More',exact:true}).click();await page.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:new RegExp('^'+name+'(?: [0-9]+)?$')}).click()};
 await nav('Today'); await nav('Home'); await page.getByText('Retain this failed capture #work',{exact:true}).waitFor();
 await input.fill('Later capture still saves');await input.press('Enter');
 await page.getByText('Added: Later capture still saves',{exact:true}).waitFor();
 await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(200); await page.screenshot({path:`/downloads/capture-failed-${width}-${theme}.png`});
 await page.getByRole('button',{name:'Retry save',exact:true}).click();
 await page.getByText('Added: Retain this failed capture',{exact:true}).waitFor();
 assert.equal(await page.locator('.quick-add-failed').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width} ${theme}`);
 // Rapid captures stay ordered; the queue must accept the next entry while saving.
 for(const title of ['Rapid first','Rapid second','Rapid third']){await input.fill(title);await input.press('Enter')}
 await page.getByText('Added: Rapid third',{exact:true}).waitFor();
 const records=await page.evaluate(async()=>{const {db}=await import('/src/db.ts');return db.tasks.toArray()});
 for(const title of ['Later capture still saves','Retain this failed capture','Rapid first','Rapid second','Rapid third']) assert.equal(records.filter(t=>t.title===title).length,1,title);
 const rapid=records.filter(t=>t.title.startsWith('Rapid ')).sort((a,b)=>a.order-b.order).map(t=>t.title);
 assert.deepEqual(rapid,['Rapid first','Rapid second','Rapid third']);
 await page.close(); console.log(`capture recovery ${width} ${theme}: pass`);
}}finally{await browser.close()}
