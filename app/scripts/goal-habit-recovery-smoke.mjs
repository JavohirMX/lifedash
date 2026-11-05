import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from 'playwright-core';
const d=fs.existsSync('/downloads')?'/downloads':'/tmp';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of[1440,390,320])for(const mode of['light','dark']){
 const p=await b.newPage({viewport:{width,height:844},colorScheme:mode});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();await p.evaluate(mode=>{document.documentElement.dataset.theme=mode},mode);
 const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name,exact:true}).click()};
 for(const [name,table,titleLabel,editLabel]of[['Goals','goals','New goal title','Goal title'],['Habits','habits','New habit name','Habit name']]){
  const kind=name==='Goals'?'goal':'habit';await nav(name);await p.getByRole('button',{name:`New ${kind}`,exact:true}).click();await p.getByLabel(titleLabel,{exact:true}).fill(`Recovery ${kind}`);
  if(kind==='goal')await p.getByLabel('Target date (optional)').fill('2026-12-01');else await p.getByRole('button',{name:'Sunday',exact:true}).click();
  await p.screenshot({path:`${d}/${kind}-form-after-${width}-${mode}.png`});
  await p.evaluate(table=>{const orig=IDBObjectStore.prototype.add;let fail=true;IDBObjectStore.prototype.add=function(...args){if(this.name===table&&fail){fail=false;throw new DOMException('Synthetic failure','QuotaExceededError')}return orig.apply(this,args)}},table);
  await p.getByRole('button',{name:`Add ${kind}`,exact:true}).click();await p.getByText(`Couldn't add this ${kind}. Your entries are still here. Try Add ${kind} again.`,{exact:true}).waitFor();assert.equal(await p.getByLabel(titleLabel,{exact:true}).inputValue(),`Recovery ${kind}`);if(kind==='goal')assert.equal(await p.getByLabel('Target date (optional)').inputValue(),'2026-12-01');else assert.equal(await p.getByRole('button',{name:'Sunday',exact:true}).getAttribute('aria-pressed'),'false');await p.screenshot({path:`${d}/${kind}-create-error-${width}-${mode}.png`});
  await p.getByRole('button',{name:`Add ${kind}`,exact:true}).click();await p.getByText(`Added ${kind} on this device.`,{exact:true}).waitFor();
  if(kind==='goal')await p.getByRole('button',{name:`Edit Recovery ${kind}`,exact:true}).click();else await p.locator('.habit-card').filter({hasText:`Recovery ${kind}`}).getByTitle('Edit habit',{exact:true}).click();
  await p.getByLabel(editLabel,{exact:true}).fill(`Edited ${kind}`);
  await p.evaluate(async table=>{const{db}=await import('/src/db.ts');const t=db[table],orig=t.update.bind(t);let fail=true;t.update=(...args)=>{if(fail){fail=false;return Promise.reject(new Error('Synthetic failure'))}return orig(...args)}},table);
  await p.getByRole('button',{name:'Save',exact:true}).click();await p.getByText(`Couldn't save this ${kind}. Your changes are still here. Try Save again.`,{exact:true}).waitFor();assert.equal(await p.getByLabel(editLabel,{exact:true}).inputValue(),`Edited ${kind}`);await p.getByRole('button',{name:'Save',exact:true}).click();await p.getByText(`Saved ${kind} on this device.`,{exact:true}).waitFor();
  // A held create cannot be double-submitted with click/Enter.
  await p.getByRole('button',{name:`New ${kind}`,exact:true}).click();await p.getByLabel(titleLabel,{exact:true}).fill(`Held ${kind}`);
  await p.evaluate(async table=>{const{db}=await import('/src/db.ts');const t=db[table],orig=t.add.bind(t);let release;const gate=new Promise(r=>release=r);window.releaseCreate=release;t.add=async(...args)=>{await gate;return orig(...args)}},table);
  await p.getByRole('button',{name:`Add ${kind}`,exact:true}).click();await p.getByText('Saving…',{exact:true}).waitFor();assert(await p.getByLabel(titleLabel,{exact:true}).isDisabled());await p.getByLabel(titleLabel,{exact:true}).dispatchEvent('keydown',{key:'Enter'});await p.evaluate(()=>window.releaseCreate());await p.getByText(`Added ${kind} on this device.`,{exact:true}).waitFor();
  assert.equal(await p.evaluate(async({table,kind})=>{const{db}=await import('/src/db.ts');return(await db.table(table).toArray()).filter(row=>(row.title??row.name)===`Held ${kind}`).length},{table,kind}),1);
  assert.equal(await p.evaluate(async({table,kind})=>{const{db}=await import('/src/db.ts');return(await db.table(table).toArray()).filter(row=>(row.title??row.name)===`Edited ${kind}`).length},{table,kind}),1);
 }
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log(width,mode,'goal/habit create+edit failure retention/retry pass');await p.close();
}}finally{await b.close()}
