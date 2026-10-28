import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try { for(const width of [1440,390,320]) for(const theme of ['light','dark']) {
 const p=await b.newPage({viewport:{width,height:900}}); const errors=[],external=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(process.env.BASE_URL)&&!r.url().startsWith('data:'))external.push(r.url())});
 await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:new RegExp('^'+name+'(?: [0-9]+)?$')}).click()};
 const dialog=p.getByRole('dialog',{name:'Capture task',exact:true});const field=dialog.getByLabel('New task',{exact:true});const open=()=>p.getByRole('button',{name:'Capture task',exact:true}).click();const close=()=>dialog.getByRole('button',{name:'Close capture',exact:true}).click();
 // Every main view can capture, without replacing or remounting its content.
 for(const name of ['Home','Today','Upcoming','Backlog','Completed','Planner','Week','Calendar','Habits','Goals','Journal','Notes']) {
  await nav(name);await p.evaluate(()=>window.captureViewNode=document.querySelector('main > section, main > .home'));await open();await field.waitFor();assert(await field.evaluate(e=>e===document.activeElement));await close();assert(await p.evaluate(()=>window.captureViewNode?.isConnected),name);
 }
 // Project and search retain their current view too.
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:/^Homelab(?: [0-9]+)?$/}).click();
 await open();await close();assert(await p.locator('main h1').innerText().then(x=>x.includes('Homelab')));
 await p.keyboard.press('Control+k');await p.getByRole('dialog',{name:'Command palette'}).getByRole('textbox').fill('fictional search');await p.getByRole('button',{name:'Search for "fictional search"',exact:true}).click();
 await open();await close();assert(await p.locator('main h1').innerText().then(x=>x.includes('Search')));
 await nav('Journal');await p.keyboard.press('n');await field.waitFor();await field.fill('Review garden tomorrow 10am #home p2');
 await dialog.getByLabel('Task preview').getByText('Review garden',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Today',exact:true}).click();
 const projects=await p.evaluate(async()=>{const{db}=await import('/src/db.ts');return db.projects.toArray()});const project=projects.find(x=>x.id!=='inbox')??projects[0];await dialog.getByLabel('Capture project',{exact:true}).selectOption(project.id);
 assert(await dialog.getByLabel('Task preview').innerText().then(x=>x.includes('Selected date replaces')));
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(150);await p.screenshot({path:`/downloads/global-capture-${width}-${theme}.png`});
 await field.press('Escape');await dialog.waitFor({state:'hidden'});await open();assert.equal(await field.inputValue(),'Review garden tomorrow 10am #home p2');
 const date=await dialog.getByLabel('Capture due date',{exact:true}).inputValue();await dialog.getByRole('button',{name:'Add',exact:true}).click();await dialog.getByText('Added: Review garden',{exact:true}).waitFor();
 const record=await p.evaluate(async()=>{const{db}=await import('/src/db.ts');return(await db.tasks.toArray()).find(x=>x.title==='Review garden')});assert.equal(record.projectId,project.id);assert.equal(record.dueDate,date);assert.equal(record.dueTime,'10:00');assert.deepEqual(record.tags,['home']);assert.equal(record.priority,2);
 // Queued jobs snapshot destination and date, even if controls change before write.
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.tasks.add.bind(db.tasks);window.restoreAdd=()=>db.tasks.add=orig;db.tasks.add=async(...args)=>{await new Promise(r=>window.releaseAdd=r);return orig(...args)}});
 await field.fill('Queued context');await dialog.getByRole('button',{name:'Add',exact:true}).click();await p.waitForFunction(()=>Boolean(window.releaseAdd));
 await dialog.getByLabel('Capture project',{exact:true}).selectOption(projects.find(x=>x.id!==project.id).id);await dialog.getByRole('button',{name:'No date',exact:true}).click();await close();await p.evaluate(()=>{window.releaseAdd();window.restoreAdd()});await p.waitForFunction(async()=>{const{db}=await import('/src/db.ts');return(await db.tasks.toArray()).some(x=>x.title==='Queued context')});
 const queued=await p.evaluate(async()=>{const{db}=await import('/src/db.ts');return(await db.tasks.toArray()).find(x=>x.title==='Queued context')});assert.equal(queued.projectId,project.id);assert.equal(queued.dueDate,date);
 // Failure remains reachable after closing; retry uses original captured destination.
 await open();await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.tasks.add.bind(db.tasks);window.restoreAdd=()=>db.tasks.add=orig;db.tasks.add=()=>Promise.reject(Error('synthetic storage failure'))});await field.fill('Global failure #garden');await field.press('Enter');await dialog.getByRole('button',{name:'Retry save',exact:true}).waitFor();await close();await nav('Notes');await open();await dialog.getByText('Global failure #garden',{exact:true}).waitFor();await p.evaluate(()=>window.restoreAdd());await dialog.getByRole('button',{name:'Retry save',exact:true}).click();await dialog.getByText('Added: Global failure',{exact:true}).waitFor();
 await field.fill('One submit only');await field.evaluate(e=>{const form=e.form;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});await dialog.getByText('Added: One submit only',{exact:true}).waitFor();assert.equal(await p.evaluate(async()=>{const{db}=await import('/src/db.ts');return(await db.tasks.toArray()).filter(x=>x.title==='One submit only').length}),1);
 await field.fill('tomorrow #tag');await field.press('Enter');await dialog.getByRole('alert').waitFor();assert.equal(await field.inputValue(),'tomorrow #tag');await field.fill('');
 // Modal guard and focus cycling; composition does not dismiss the capture.
 await field.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert(await dialog.isVisible());await field.fill('n');assert.equal(await p.getByRole('dialog').count(),1);await field.fill('');
 const last=dialog.locator('button').last();await last.focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close capture');await p.keyboard.press('Shift+Tab');assert(await last.evaluate(e=>e===document.activeElement));
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await close();assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Capture task');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(width,theme,'all main views/draft/parse/queued context/retry/IME/focus/no external PASS');await p.close();
}} finally {await b.close()}
