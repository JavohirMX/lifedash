import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try { for(const width of [1440,390,320]) for(const mode of ['light','dark']) {
 const p=await b.newPage({viewport:{width,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 await p.evaluate(async mode=>{document.documentElement.dataset.theme=mode;const{addTask}=await import('/src/repo.ts');const{INBOX_ID}=await import('/src/db.ts');window.subjects=[];for(const title of ['Backlog today recovery','Backlog date recovery','Backlog held origin'])window.subjects.push(await addTask({title,projectId:INBOX_ID,dueTime:'09:30'}));},mode);
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:/^Backlog/}).click();
 for(const [i,title] of ['Backlog today recovery','Backlog date recovery'].entries()) {
  const row=p.locator('.backlog-row').filter({hasText:title}),input=row.getByLabel(`Schedule ${title} to a date`),today=row.getByRole('button',{name:'Today',exact:true});
  await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const original=window.originalTaskUpdate??=db.tasks.update.bind(db.tasks);let fail=true;db.tasks.update=(...args)=>{if(fail){fail=false;return Promise.reject(Error('Injected scheduling failure'))}return original(...args)}});
  if(i===0)await today.click();else await input.fill('2026-12-14');await row.getByRole('alert').waitFor();
  assert.equal(await p.evaluate(async i=>{const{db}=await import('/src/db.ts');return(await db.tasks.get(window.subjects[i].id)).dueDate},i),null);
  if(i)assert.equal(await input.inputValue(),'2026-12-14');await p.screenshot({path:`/downloads/backlog-${i?'date':'today'}-error-${width}-${mode}.png`});
  await p.evaluate(async()=>{const{db}=await import('/src/db.ts');window.scheduleWrites=0;let hold=true;db.tasks.update=async(...args)=>{window.scheduleWrites++;if(hold){hold=false;await new Promise(r=>window.releaseSchedule=r)}return window.originalTaskUpdate(...args)}});
  await row.getByRole('button',{name:'Retry schedule',exact:true}).click();await p.waitForFunction(()=>Boolean(window.releaseSchedule));assert(await today.isDisabled());assert.equal(await input.getAttribute('readonly'),'');await today.dispatchEvent('click');await row.getByRole('button',{name:'Retry schedule',exact:true}).count().then(n=>assert.equal(n,0));
  await p.evaluate(()=>{window.releaseSchedule();delete window.releaseSchedule});await row.waitFor({state:'detached'});assert.equal(await p.evaluate(()=>window.scheduleWrites),1);
  const saved=await p.evaluate(async i=>{const{db}=await import('/src/db.ts');return await db.tasks.get(window.subjects[i].id)},i);assert.equal(saved.dueTime,'09:30');assert.equal(saved.dueDate,i?'2026-12-14':await p.evaluate(async()=>{const{todayStr}=await import('/src/dates.ts');return todayStr()}));
 }
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');db.tasks.update=async(...args)=>{await new Promise(r=>window.releaseSchedule=r);return window.originalTaskUpdate(...args)}});const held=p.locator('.backlog-row').filter({hasText:'Backlog held origin'});await held.getByRole('button',{name:'Today',exact:true}).click();await p.waitForFunction(()=>Boolean(window.releaseSchedule));const another=p.locator('.backlog-row').filter({has: p.getByRole('button',{name:'Today',exact:true})}).filter({hasNotText:'Backlog held origin'}).first();assert(await another.getByRole('button',{name:'Today',exact:true}).isEnabled());await p.getByRole('button',{name:/^Home/}).filter({visible:true}).first().click();await p.evaluate(()=>{window.releaseSchedule();delete window.releaseSchedule});await p.waitForFunction(async()=>{const{db}=await import('/src/db.ts');return (await db.tasks.get(window.subjects[2].id)).dueDate!==null});assert.equal(await p.getByRole('alert').count(),0);
 assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log(width,mode,'Backlog Today/date rejection/retention/retry/duplicate/time preservation PASS');await p.close();
}}finally{await b.close()}
