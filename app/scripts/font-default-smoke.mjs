// Match-style default regression contract. Run against the integrated candidate.
// No user data: isolated sample database/preferences only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const base=process.env.BASE_URL??'http://127.0.0.1:4182';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const families={instrument:/Instrument Sans Variable/,inter:/Inter Variable/,manrope:/Manrope Variable/,geist:/Geist Variable/,'source-sans':/Source Sans 3 Variable/,'dm-sans':/DM Sans Variable/};
try {
 for(const width of [1440,390]) {
  for(const saved of [null,'invalid','style','instrument','inter','manrope','geist','source-sans','dm-sans','plex','system','serif','mono']) {
   const p=await b.newPage({viewport:{width,height:900}});
   await p.addInitScript(saved=>{localStorage.setItem('lifedash-style','terminal');localStorage.setItem('lifedash-theme','light');if(saved!==null)localStorage.setItem('lifedash-sample-font',saved);},saved);
   await p.goto(`${base}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();await p.evaluate(()=>document.fonts.ready);
   const expected=saved===null||saved==='invalid'?'style':saved;
   assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),expected,`initial saved=${saved}`);
   if(expected==='style')assert.equal(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--font')),'','Match style must let the selected style own --font');
   if(families[expected])assert.match(await p.locator('body').evaluate(e=>getComputedStyle(e).fontFamily),families[expected]);
   if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('button',{name:'Appearance Style, mode, fonts and wallpaper'}).click();
   await p.getByRole('button',{name:'Reset style & mode',exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),expected,'style reset changed font');
   await p.keyboard.press('Escape');await p.reload();await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),expected,'reload changed saved font');await p.close();
  }
  console.log(`${width}: missing/invalid -> Match style, all11 explicit choices + style reset + reload PASS`);
 }
 const p=await b.newPage();await p.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Unavailable','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('Unavailable','SecurityError');};});await p.goto(`${base}/?sample`);await p.locator('.app').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),'style','storage-blocked startup must still use Match style');await p.close();console.log('Storage-blocked startup -> Match style PASS');
}finally{await b.close();}
