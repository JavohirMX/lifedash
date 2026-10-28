import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {for(const width of [1440,390,320]) for(const mode of ['light','dark']) {
 const p=await b.newPage({viewport:{width,height:844},colorScheme:mode});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:'Notes',exact:true}).click();
 await p.getByRole('button',{name:/Packing checklist/}).click();
 const input=p.getByRole('textbox',{name:'Note title',exact:true});
 const warned=()=>p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented});
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.notes.update.bind(db.notes);window.titleWrites=[];let fail=true;db.notes.update=(id,change)=>{if('title'in change){window.titleWrites.push({id,title:change.title});if(fail){fail=false;return Promise.reject(Error('Injected title failure'))}}return orig(id,change)}});
 await input.fill('Retained title');await p.getByRole('button',{name:'Retry title',exact:true}).waitFor();assert(await warned());assert.equal(await input.inputValue(),'Retained title');
 if(width<500)await p.getByRole('button',{name:'Back to notes',exact:true}).click();
 await p.locator('.notes-list .note-item').filter({hasNot:p.locator('[aria-current=true]')}).last().click();assert.notEqual(await input.inputValue(),'Retained title');assert(await warned());
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:/^Today/}).click();assert(await warned());
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:'Notes',exact:true}).click();

 await p.getByRole('button',{name:/Packing checklist/}).click();assert.equal(await input.inputValue(),'Retained title');await p.getByRole('button',{name:'Retry title',exact:true}).waitFor();
 await p.getByRole('alert').scrollIntoViewIfNeeded();await p.screenshot({path:`/downloads/note-title-error-${width}-${mode}.png`});
 await p.getByRole('button',{name:'Retry title',exact:true}).click();await p.getByText('Title saved on this device',{exact:true}).waitFor();assert.equal(await warned(),false);
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.notes.update.bind(db.notes);let hold=true;db.notes.update=async(id,change)=>{if('title'in change&&hold){hold=false;await new Promise(r=>window.releaseTitle=r)}return orig(id,change)}});
 await input.fill('Older held title');await p.waitForFunction(()=>Boolean(window.releaseTitle));await input.fill('Latest title');
 await p.evaluate(()=>window.releaseTitle());await p.getByText('Title saved on this device',{exact:true}).waitFor();
 assert.equal(await p.evaluate(async()=>{const{db}=await import('/src/db.ts');return(await db.notes.get(window.titleWrites[0].id)).title}),'Latest title');
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.notes.update.bind(db.notes);db.notes.update=(id,change)=>'title'in change?Promise.reject(Error('Delete cleanup test')):orig(id,change)});
 await input.fill('Unsaved deleted title');await p.getByRole('button',{name:'Retry title',exact:true}).waitFor();assert(await warned());
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.notes.delete.bind(db.notes);let fail=true;db.notes.delete=(...args)=>{if(fail){fail=false;return Promise.reject(Error('Injected delete failure'))}return orig(...args)}});
 p.once('dialog',dialog=>dialog.accept());await p.getByRole('button',{name:'Delete note',exact:true}).click();await input.waitFor({state:'detached'});assert(await warned());
 await p.getByRole('button',{name:/Latest title/}).click();assert.equal(await input.inputValue(),'Unsaved deleted title');
 p.once('dialog',dialog=>dialog.accept());await p.getByRole('button',{name:'Delete note',exact:true}).click();await input.waitFor({state:'detached'});await p.waitForFunction(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return !e.defaultPrevented});
 assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log(width,mode,'title failure, navigation, retry and ordered writes PASS');await p.close();
}}finally{await b.close()}
