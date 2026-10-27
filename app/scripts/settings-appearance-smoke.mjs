// Local-only UX regression: fictional sample data, no notification/provider calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4182';
const shots = process.env.SCREENSHOT_DIR;
try {
  for (const [width, height] of [[1440,900],[390,844],[320,568]]) {
    const page = await browser.newPage({viewport:{width,height}});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    // Saved nudge with reminders off: it must say paused, not imply delivery.
    await page.addInitScript(()=>localStorage.setItem('lifedash-journal-prompt-enabled','1'));
    await page.goto(`${base}/?sample`);
    await page.getByText('Set up the backup volume',{exact:true}).first().waitFor();
    const openSettings=async()=>{if(width<500)await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();};
    await openSettings();
    const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('button',{name:/Journal nudge/}).waitFor();
    assert.equal(await settings.getByRole('button',{name:/Journal nudge/}).isDisabled(),true);
    assert.match(await settings.textContent(),/Paused/);
    assert.match(await settings.textContent(),/saved, but paused/);
    assert(await settings.evaluate(e=>e.scrollWidth<=e.clientWidth),'Settings overflow');
    if(shots)await page.screenshot({path:`${shots}/settings-${width}.png`});
    await settings.getByRole('button',{name:'Appearance Style, light mode and dark mode'}).click();
    const appearance=page.getByRole('dialog',{name:'Appearance',exact:true});
    for(const mode of ['Light','Dark']) {
      await appearance.getByRole('radio',{name:mode,exact:true}).click();
      const cards=appearance.locator('.style-card');
      for(let i=0;i<await cards.count();i++) {
        const card=cards.nth(i);await card.click();
        assert.equal(await card.getAttribute('aria-checked'),'true');
        assert(await appearance.evaluate(e=>e.scrollWidth<=e.clientWidth),'Appearance overflow');
        const colors=await card.evaluate(e=>{const c=getComputedStyle(document.documentElement),p=getComputedStyle(e.querySelector('.style-preview'));return ['ground','surf','rule','acc'].map((key,i)=>[p.getPropertyValue(`--p-${key}`).trim(),c.getPropertyValue(['--ground','--surface','--border','--accent'][i]).trim()]);});
        for(const [preview,actual] of colors)assert.equal(preview,actual,'Preview differs from theme');
      }
    }
    await appearance.getByRole('radio',{name:/Nexus /}).click();
    await appearance.evaluate(el => { el.scrollTop = 0; });
    await page.addStyleTag({content:'*, *::before, *::after { transition: none !important; animation: none !important; }'});
    if(shots)await page.screenshot({path:`${shots}/appearance-dark-${width}.png`});
    await page.keyboard.press('Escape');await page.reload();await openSettings();
    assert.match(await settings.locator('.settings-current-appearance').textContent(),/Nexus.*dark mode/);
    await settings.getByRole('button',{name:'Appearance Style, light mode and dark mode'}).click();
    await appearance.getByRole('button',{name:'Use defaults'}).click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('lifedash-style')),'paper');
    assert.equal(await page.evaluate(()=>localStorage.getItem('lifedash-theme')),'system');
    assert.equal(await page.evaluate(()=>localStorage.getItem('lifedash-journal-prompt-enabled')),'1','Reset changed unrelated preference');
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await appearance.getByText('System (dark)',{exact:false}).waitFor();
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await appearance.getByText('System (light)',{exact:false}).waitFor();
    await appearance.getByRole('radio',{name:/Polar /}).focus(); await page.keyboard.press('Home');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-preview')),'paper');
    await appearance.evaluate(el=> { el.scrollTop = 0; });
    if(shots)await page.screenshot({path:`${shots}/appearance-light-${width}.png`});
    assert.deepEqual(errors,[]);
    await page.close();console.log(`${width}x${height}: paused-state, 16 style/mode previews, persistence, defaults, system tracking, keyboard and overflow PASS`);
  }
  for (const state of ['blocked','unsupported']) {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.addInitScript(state=>{if(state==='unsupported')Object.defineProperty(window,'Notification',{value:undefined,configurable:true});else Object.defineProperty(Notification,'permission',{get:()=> 'denied',configurable:true});},state);
    await page.goto(`${base}/?sample`);await page.getByText('Set up the backup volume',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();
    const reminder=page.getByRole('button',{name:/^Reminders /});assert(await reminder.isDisabled());
    assert.match(await reminder.textContent(),state==='blocked'?/Blocked/:/Unavailable/);
    if(shots)await page.screenshot({path:`${shots}/settings-${state}-390.png`});
    await page.close(); console.log(`${state} notification explanation PASS`);
  }
} finally {await browser.close();}
