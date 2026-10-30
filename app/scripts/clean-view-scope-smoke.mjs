import assert from'node:assert/strict';import{chromium}from'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});try{for(const width of[1440,390])for(const mode of['light','dark']){
 const p=await b.newPage({viewport:{width,height:900},colorScheme:mode});await p.goto(`${process.env.BASE_URL}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();const nav=async name=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.locator(width<500?'.mobile-sheet':'.sidebar').getByRole('button',{name,exact:true}).click()};
 for(const name of['Today','Upcoming','Backlog','Planner','Week','Calendar']){await nav(name==='Today'||name==='Backlog'?new RegExp('^'+name):name);await p.waitForTimeout(300);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`/downloads/clean-view-${process.env.STAGE??'after'}-${name}-${width}-${mode}.png`})}
await p.close();console.log(width,mode,'taskviews reachable viewport PASS');
}}finally{await b.close()}
