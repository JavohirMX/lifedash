import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try { const p=await b.newPage(); await p.goto(`${process.env.BASE_URL}/?sample`); await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 await p.getByRole('button',{name:'Capture task',exact:true}).click(); const d=p.getByRole('dialog',{name:'Capture task',exact:true}), f=d.getByLabel('New task',{exact:true});
 await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.tasks.add.bind(db.tasks);window.restoreAdd=()=>db.tasks.add=orig;window.releases=[];db.tasks.add=async(...a)=>{await new Promise(r=>window.releases.push(r));return orig(...a)}});
 const warn=()=>p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented});
 for(const title of ['Fictional held initial save','Fictional queued second save']) {await f.fill(title);await d.getByRole('button',{name:'Add',exact:true}).click()}
 await p.waitForFunction(()=>window.releases.length===1);assert.equal(await warn(),true,'initial pending visible');await d.getByRole('button',{name:'Close capture',exact:true}).click();assert.equal(await warn(),true,'initial pending hidden');
 await p.evaluate(()=>window.releases[0]());await p.waitForFunction(()=>window.releases.length===2);assert.equal(await warn(),true,'second queued write remains guarded');await p.evaluate(()=>{window.restoreAdd();window.releases[1]()});
 await p.waitForFunction(async()=>{const{db}=await import('/src/db.ts');return(await db.tasks.toArray()).some(t=>t.title==='Fictional queued second save')}); await p.waitForFunction(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return !e.defaultPrevented});assert.equal(await warn(),false,'settled writes release guard');
 // The inline instance can unmount during a write; the guard must outlive it.
 await p.locator('.sidebar').getByRole('button',{name:/^Backlog(?: [0-9]+)?$/}).click();await p.evaluate(async()=>{const{db}=await import('/src/db.ts');const orig=db.tasks.add.bind(db.tasks);db.tasks.add=async(...a)=>{await new Promise(r=>window.releaseInline=r);return orig(...a)}});
 const inline=p.locator('main').getByLabel('New task',{exact:true});await inline.fill('Fictional inline held save');await inline.press('Enter');await p.waitForFunction(()=>Boolean(window.releaseInline));await p.locator('.sidebar').getByRole('button',{name:/^Notes(?: [0-9]+)?$/}).click();assert.equal(await warn(),true,'inline pending survives unmount');await p.evaluate(()=>window.releaseInline());await p.waitForFunction(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return !e.defaultPrevented});
 console.log('Initial, queued, closed global and unmounted inline writes guarded until settled PASS');
} finally {await b.close()}
