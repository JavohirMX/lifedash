import assert from 'node:assert/strict';import{chromium}from'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{for(const width of[1440,390,320])for(const mode of['light','dark']){
 const p=await b.newPage({viewport:{width,height:900},colorScheme:mode});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();
 const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name,exact:true}).click()};
 const composing=async f=>f.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
 const search=p.locator(width<500?'.mobile-sheet':'.sidebar').getByPlaceholder('Search tasks, #tags');await search.fill('backup');await composing(search);assert.equal(await search.inputValue(),'backup');assert(await search.evaluate(el=>el===document.activeElement));await p.keyboard.press('Escape');
 if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();assert.equal(await search.inputValue(),'');
 if(width<500)await p.keyboard.press('Escape');
 await nav(/^Today/);const quick=p.getByLabel('New task',{exact:true});await quick.fill('Not finished');await composing(quick);assert(await quick.evaluate(el=>el===document.activeElement));assert.equal(await quick.inputValue(),'Not finished');await p.keyboard.press('Escape');assert.equal(await quick.evaluate(el=>el===document.activeElement),false);assert.equal(await quick.inputValue(),'Not finished');
 await p.evaluate(async()=>{const{addNote}=await import('/src/repo.ts');for(let i=0;i<5;i++)await addNote()});await nav('Notes');const filter=p.getByLabel('Filter notes',{exact:true});await filter.fill('No matching note');await composing(filter);assert.equal(await filter.inputValue(),'No matching note');assert(await filter.evaluate(el=>el===document.activeElement));
 if((width===390&&mode==='light')||(width===320&&mode==='dark'))await p.screenshot({path:`/downloads/search-composition-${width}-${mode}.png`});
 await p.keyboard.press('Escape');assert.equal(await filter.inputValue(),'');assert.deepEqual(errors,[]);console.log(width,mode,'task search/notes filter/QuickAdd composing Escape retains query/focus; ordinaryEscape unchanged PASS');await p.close();
}}finally{await b.close()}
