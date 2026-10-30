import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 for(const width of [1440,390,320]) for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
  await page.goto(`${process.env.BASE_URL??'http://127.0.0.1:5173'}/?sample`);
  await page.getByText('Set up the backup volume',{exact:true}).first().waitFor();
  if(width<500) await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('button',{name:'Import',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Import tasks',exact:true});
  const field=page.getByLabel('Import source text',{exact:true});
  const text='- [ ] Unsaved composition text'; await field.fill(text);
  await field.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));
  assert.equal(await dialog.count(),1); assert.equal(await field.inputValue(),text);
  const last=dialog.locator('button').last(); await last.focus();
  const passed=await last.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(passed,true,'composing Tab should not be trapped');
  assert(await last.evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')));
  if((width===390&&theme==='light')||(width===320&&theme==='dark')) await page.screenshot({path:`/downloads/dialog-composition-${width}-${theme}.png`});
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
  console.log(`${width}px ${theme}: composing Escape preserved source; composing Tab passed; normal Tab/Escape passed`);
  await page.close();
 }
} finally {await browser.close()}
