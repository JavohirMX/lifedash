// Remaining route/dialog review using fictional data. No provider or sync calls.
import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of[1440,390,320])for(const mode of['light','dark']){
 const p=await b.newPage({viewport:{width,height:844},colorScheme:mode});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`${process.env.BASE_URL??'http://127.0.0.1:4183'}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name:new RegExp('^'+name+'(?: [0-9]+)?$')}).click()};
 const shot=async name=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+'overflow');await p.screenshot({path:`/downloads/surface-${name}-${width}-${mode}.png`})};
 for(const name of['Today','Upcoming','Backlog','Completed','Week']){await nav(name);await shot(name.toLowerCase())}
 await nav('Today');await p.locator('.task-title').first().click();await p.getByRole('complementary',{name:'Task details'}).waitFor();await shot('taskdetails');await p.getByRole('button',{name:'Close task details',exact:true}).click();
 await nav('Import');await p.getByRole('dialog',{name:'Import tasks',exact:true}).waitFor();await shot('import');await p.keyboard.press('Escape');
 await nav('Restore backup');await p.getByRole('dialog',{name:'Restore backup',exact:true}).waitFor();await shot('restore');await p.keyboard.press('Escape');
 await nav('Automation');await p.getByRole('dialog',{name:'Automation rules',exact:true}).waitFor();await shot('automation');await p.keyboard.press('Escape');
 await nav('Plan with AI');await p.getByRole('dialog',{name:'Plan with AI',exact:true}).waitFor();await shot('localplanner');await p.getByRole('button',{name:'Close AI planner',exact:true}).click();
 await nav('TV dashboard');await p.locator('.tv-root').waitFor();await shot('tv');await p.evaluate(()=>window.location.hash='');await p.locator('.app').waitFor();assert.deepEqual(errors,[]);console.log(width,mode,'remaining routes/dialogs render without overflow or JS errors');await p.close();
}}finally{await b.close()}
