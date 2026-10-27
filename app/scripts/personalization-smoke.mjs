import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});
const base=process.env.BASE_URL??'http://127.0.0.1:4182';
try{for(const width of [1440,390,320]){
 const p=await b.newPage({viewport:{width,height:width===320?568:900},reducedMotion:'reduce'});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${base}/?sample`);await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();await p.addStyleTag({content:'*{transition:none!important}'});
 const open=async()=>{if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('button',{name:'Appearance Style, light mode and dark mode'}).click();};
 await open();const d=p.getByRole('dialog',{name:'Appearance',exact:true});
 await p.getByRole('tab',{name:'Font',exact:true}).click();
 for(const [i,font]of ['inter','manrope','plex'].entries()){
  await p.getByRole('combobox').selectOption(font);await p.evaluate(()=>document.fonts.ready);await p.keyboard.press('Escape');await p.mouse.move(0,0);await p.screenshot({path:`/downloads/font-${i+1}-${width}.png`});await open();await p.getByRole('tab',{name:'Font',exact:true}).click();
 }
 if(width!==320)await p.screenshot({path:`/downloads/font-settings-${width}.png`});
 await p.getByRole('tab',{name:'Wallpaper',exact:true}).click();await p.getByRole('button',{name:'Aurora',exact:true}).click();await p.keyboard.press('Escape');await p.mouse.move(0,0);await p.screenshot({path:`/downloads/wallpaper-aurora-${width}.png`});
 await open();await p.getByRole('tab',{name:'Wallpaper',exact:true}).click();await p.screenshot({path:`/downloads/wallpaper-settings-${width}.png`});
 await p.getByRole('slider').focus();await p.keyboard.press('End');assert.equal(await p.getByRole('slider').inputValue(),'35');
 await p.locator('input[type=file]').setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await p.getByRole('alert').filter({hasText:'Choose a JPG'}).waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.wallpaper),'aurora');
 const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1800;c.height=1100;const x=c.getContext('2d');x.fillStyle='#e7b9a0';x.fillRect(0,0,c.width,c.height);x.fillStyle='#297e88';x.beginPath();x.arc(600,400,450,0,7);x.fill();return c.toDataURL('image/png').split(',')[1];});
 await p.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await p.waitForFunction(()=>document.documentElement.dataset.wallpaper==='custom');
 await p.getByRole('tab',{name:'Style & mode',exact:true}).click();await p.getByRole('radio',{name:'Dark',exact:true}).click();await p.keyboard.press('Escape');await p.mouse.move(0,0);await p.screenshot({path:`/downloads/wallpaper-custom-dark-${width}.png`});await open();await p.getByRole('tab',{name:'Wallpaper',exact:true}).click();
 assert(await p.evaluate(()=>localStorage.getItem('lifedash-sample-wallpaper').includes('data:image/jpeg;base64,')));
 await p.keyboard.press('Escape');await p.reload();await p.getByText('Set up the backup volume',{exact:true}).first().waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.wallpaper),'custom');assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),'plex');assert.equal(await p.evaluate(()=>localStorage.getItem('lifedash-wallpaper')),null);
 await open();await p.getByRole('tab',{name:'Wallpaper',exact:true}).click();await p.getByRole('button',{name:'Remove wallpaper',exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.wallpaper),'none');
 for(const name of ['Style & mode','Font','Wallpaper']){await p.getByRole('tab',{name,exact:true}).click();assert(await d.evaluate(e=>e.scrollWidth<=e.clientWidth));}
 await p.getByRole('tab',{name:'Wallpaper',exact:true}).focus();await p.keyboard.press('Home');assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Style & mode');
 await p.getByRole('tab',{name:'Font',exact:true}).click();
 await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('lifedash-sample-'))throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,key,value);};});
 await p.getByRole('combobox').selectOption('inter');await p.getByRole('alert').filter({hasText:'Could not save this font'}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),'plex');assert.equal(await p.getByRole('combobox').inputValue(),'plex');
 await p.getByRole('tab',{name:'Wallpaper',exact:true}).click();await p.getByRole('button',{name:'Aurora',exact:true}).click();await p.getByRole('alert').filter({hasText:'Could not save this wallpaper'}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.dataset.wallpaper),'none');
 assert.deepEqual(errors,[]);await p.close();console.log(`${width}: fonts, previews, wallpaper presets/upload/rejection/persistence/removal, sample isolation, tabs and overflow PASS`);
}}finally{await b.close();}
