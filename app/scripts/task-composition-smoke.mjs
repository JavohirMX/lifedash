import assert from 'node:assert/strict';import{chromium}from'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of[1440,390,320])for(const mode of['light','dark']){
 const p=await b.newPage({viewport:{width,height:900},colorScheme:mode});await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().click();const f=p.getByRole('textbox',{name:'Task title',exact:true});await f.waitFor();const title=await f.inputValue();await f.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));assert.equal(await f.inputValue(),title);assert(await f.evaluate(el=>el===document.activeElement));
 if((width===390&&mode==='light')||(width===320&&mode==='dark'))await p.screenshot({path:`/downloads/task-composition-${width}-${mode}.png`});
 await p.keyboard.press('Escape');await f.waitFor({state:'detached'});console.log(width,mode,'task detail composingEscape preserves panel/title/focus; ordinaryEscape closes');await p.close();
}}finally{await b.close()}
