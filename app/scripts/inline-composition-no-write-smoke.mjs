import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {for(const width of [1440,390,320]) for(const mode of ['light','dark']) {
 const p=await b.newPage({viewport:{width,height:900},colorScheme:mode});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${process.env.BASE_URL??'http://127.0.0.1:5173'}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name,exact:true}).click()};
 const snapshot=()=>p.evaluate(async()=>{const{db}=await import('/src/db.ts');return JSON.stringify([await db.projects.toArray(),await db.goals.toArray(),await db.habits.toArray()])});
 const check=async field=>{const before=await snapshot();await field.fill('Retained composition');await field.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.equal(await field.inputValue(),'Retained composition');await field.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));await p.waitForTimeout(30);assert.equal(await snapshot(),before);await field.focus();await p.keyboard.press('Escape');await field.waitFor({state:'detached'});assert.equal(await snapshot(),before)};
 for(const[name,kind,label,edit]of [['Goals','goal','New goal title','Goal title'],['Habits','habit','New habit name','Habit name']]) {
  await nav(name);await p.getByRole('button',{name:`New ${kind}`,exact:true}).click();await check(p.getByLabel(label,{exact:true}));
  await p.getByRole('button',{name:`New ${kind}`,exact:true}).click();await p.getByLabel(label,{exact:true}).fill(`Composition ${kind}`);await p.getByRole('button',{name:`Add ${kind}`,exact:true}).click();await p.getByText(`Added ${kind} on this device.`,{exact:true}).waitFor();
  if(kind==='goal')await p.getByRole('button',{name:`Edit Composition ${kind}`,exact:true}).click();else await p.locator('.habit-card').filter({hasText:`Composition ${kind}`}).getByTitle('Edit habit',{exact:true}).click();
  await check(p.getByLabel(edit,{exact:true}));
 }
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 const scope=p.locator(width<500?'.mobile-sheet':'.sidebar');await scope.getByRole('button',{name:'New project',exact:true}).click();await check(scope.getByLabel('New project name',{exact:true}));
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 await scope.getByRole('button',{name:/^Homelab/}).click();await p.getByRole('button',{name:'Project settings',exact:true}).click();const field=p.getByLabel('Project name',{exact:true});await field.fill('Retained project composition');await field.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.equal(await field.inputValue(),'Retained project composition');
 if((width===390&&mode==='light')||(width===320&&mode==='dark'))await p.screenshot({path:`/downloads/inline-composition-${width}-${mode}.png`});
 await field.focus();await p.keyboard.press('Escape');await field.waitFor({state:'detached'});assert.deepEqual(errors,[]);
 console.log(`${width} ${mode}:6 inline create/edit controls retain composing Escape; ordinary Escape cancels`);await p.close();
}} finally{await b.close()}
