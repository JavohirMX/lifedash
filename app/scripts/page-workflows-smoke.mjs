import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4182','--strictPort'],{stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);let b;
try {
 for(let n=0;n<100&&!output.includes('Local:');n++){if(server.exitCode!==null)throw Error(output);await delay(100)}
 if(!output.includes('Local:'))throw Error(output);
 b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1440,390,320])for(const mode of ['light','dark']){
  const p=await b.newPage({viewport:{width,height:844},colorScheme:mode});
  await p.goto('http://127.0.0.1:4182/?sample');await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
  await p.evaluate(mode=>{localStorage.setItem('ld-theme-mode',mode);document.documentElement.dataset.theme=mode},mode);
  const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name,exact:true}).click()};
  const shot=async name=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow ${width}`);await p.screenshot({path:`/downloads/page-${name}-${width}-${mode}.png`})};
  await nav('Calendar');await shot('calendar');
  await p.locator('.cal-day').nth(15).click();await p.getByRole('region',{name:'Selected day tasks'}).waitFor();await shot('calendar-day');
  await nav('Goals');await p.getByRole('button',{name:'New goal',exact:true}).click();await p.getByLabel('New goal title').fill('Read twelve books');await shot('goal-create');await p.getByRole('button',{name:'Add goal',exact:true}).click();await p.getByText('Read twelve books',{exact:true}).waitFor();
  await nav('Notes');await p.getByRole('button',{name:'New note',exact:true}).click();await p.getByLabel('Note title',{exact:true}).fill('Workflow proof');await p.locator('.tiptap').fill('A short note saved locally');await p.waitForFunction(async()=>{const{db}=await import('/src/db.ts');return(await db.notes.toArray()).some(n=>n.title==='Workflow proof'&&n.note==='A short note saved locally')});await shot('note-edit');if(width<500){await p.getByRole('button',{name:'Back to notes',exact:true}).click();assert((await p.locator('.notes-list').boundingBox()).y>=50)}
  await nav('Journal');if(await p.getByRole('radio',{name:'Good',exact:true}).getAttribute('aria-checked')!=='true')await p.getByRole('radio',{name:'Good',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[role=radio][title=Good]')?.getAttribute('aria-checked')==='true');await p.waitForTimeout(100);await p.getByRole('button',{name:'Previous day',exact:true}).click();await p.getByRole('button',{name:'Today',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[role=radio][title=Good]')?.getAttribute('aria-checked')==='true');await shot('journal');
  if(width===1440){
   const search=p.locator('.sidebar .search-box');await search.fill('a');
   const filter=p.getByLabel('Filter by project');await filter.waitFor();
   const ids=await filter.locator('option').evaluateAll(xs=>xs.map(x=>x.value).filter(Boolean));assert(ids.length>1);
   await filter.selectOption(ids[0]);assert(await filter.locator(`option[value="${ids[1]}"]`).count());await filter.selectOption(ids[1]);
   await shot('search');await p.locator('.sidebar .nav').filter({hasText:'Homelab'}).click();await shot('project');
  }
  console.log(width,mode,'Calendar selection,visible goal creation,Notes autosave,Journal day return PASS');await p.close();
 }
}finally{await b?.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(r=>server.once('exit',r))}
