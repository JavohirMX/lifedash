import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try { for(const width of [1440,390,320]) for(const mode of ['light','dark']) {
 const p=await b.newPage({viewport:{width,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 await p.evaluate(mode=>document.documentElement.dataset.theme=mode,mode);
 await p.getByRole('button',{name:/^Today/}).first().click();await p.locator('.task-title').first().click();
 await p.getByLabel('Attach files',{exact:true}).setInputFiles({name:'fictional-download.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional download proof')});
 await p.getByText('Saved fictional-download.txt on this device.',{exact:true}).waitFor();
 const area=p.locator('.task-attachments'),button=area.getByRole('button',{name:'Download fictional-download.txt',exact:true});
 for(const kind of ['url','click']) {
  await p.evaluate(kind=>{const target=kind==='url'?URL:HTMLAnchorElement.prototype,key=kind==='url'?'createObjectURL':'click',original=target[key];let fail=true;target[key]=function(...args){if(fail){fail=false;throw Error('Injected download preparation failure')}return original.apply(this,args)}},kind);
  await button.click();await area.getByRole('alert').waitFor();assert((await area.getByRole('alert').innerText()).includes('still saved'));
  await area.getByRole('alert').scrollIntoViewIfNeeded();if(kind==='url')await p.screenshot({path:`/downloads/attachment-download-error-${width}-${mode}.png`});
  const pending=p.waitForEvent('download');await button.click();const download=await pending;assert.equal(download.suggestedFilename(),'fictional-download.txt');
  await area.getByRole('status').filter({hasText:'Download requested'}).waitFor();assert.equal(await area.getByRole('alert').count(),0);
 }
 const saved=await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const rows=(await db.attachments.toArray()).filter(a=>a.name==='fictional-download.txt');return {count:rows.length,text:await rows[0].blob.text()}});
 assert.deepEqual(saved,{count:1,text:'Fictional download proof'});assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log(width,mode,'attachment URL/click failure + retry initiation and preserved Blob PASS');await p.close();
}} finally {await b.close()}
