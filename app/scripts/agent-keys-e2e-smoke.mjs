// REAL integration: live sync server + real app, no interception. Needs SYNC_URL (live server) and BASE_URL (vite).
import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
const SYNC=process.env.SYNC_URL, BASE=process.env.BASE_URL??'http://127.0.0.1:4186';
assert(SYNC,'SYNC_URL required');
const api=async(path,opts={})=>{const r=await fetch(`${SYNC}/api${path}`,{...opts,headers:{'Content-Type':'application/json',...(opts.headers??{})}});return r;};
let b;try{b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
for(const width of[1440,390]){const p=await b.newPage({viewport:{width,height:844}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(BASE);
// Register through the real Sync dialog against the live server.
if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
await p.getByRole('button',{name:'Settings',exact:true}).click();
await p.getByRole('button',{name:'Sync Connect to your self-hosted server'}).click();
await p.locator('input[type="url"]').fill(SYNC);
await p.locator('input[autocomplete="username"]').fill(`e2e-${width}-${Date.now()}`);
await p.locator('input[type="password"]').fill('e2e-pass-phrase');
await p.getByRole('button',{name:'Create account',exact:true}).click();
await p.getByRole('button',{name:'Sync now',exact:true}).waitFor({timeout:15000});
await p.keyboard.press('Escape');
// Create a real agent key through Settings.
if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
await p.getByRole('button',{name:'Settings',exact:true}).click();
await p.getByRole('button',{name:'Agent API keys'}).click();
await p.getByText('No keys yet.',{exact:false}).waitFor({timeout:15000});
await p.getByLabel('Name',{exact:true}).fill('e2e');
await p.getByRole('button',{name:'Create key',exact:true}).click();
await p.getByText('shown once',{exact:false}).waitFor();
const token=await p.locator('.agent-key-token').textContent();
assert(token.startsWith('ldk_'),'token shown once in UI');
await p.screenshot({path:`/downloads/agent-keys-e2e-created-${width}.png`});
await p.getByRole('button',{name:'Done',exact:true}).click();
await p.getByText('e2e',{exact:true}).waitFor();
await p.keyboard.press('Escape');await p.waitForTimeout(300);
await p.keyboard.press('Escape');await p.waitForTimeout(300);  // first Escape returns to Settings; second closes it
// Drive the LIVE API with the UI-created key.
const today=new Date().toLocaleDateString('en-CA');
let r=await api('/agent/tasks',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({title:'E2E agent task',dueDate:today})});
const task=await r.json();assert.equal(r.status,201,JSON.stringify(task));
// The app must show it after a real sync pull.
if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
await p.getByRole('button',{name:'Settings',exact:true}).click();
await p.getByRole('button',{name:'Sync Connect to your self-hosted server'}).click();
await p.getByRole('button',{name:'Sync now',exact:true}).click();await p.waitForTimeout(2500);
await p.keyboard.press('Escape');
await p.keyboard.press('Control+k');await p.locator('[role=dialog] input').fill('E2E agent task');
await p.getByText('E2E agent task',{exact:true}).first().waitFor({timeout:8000});
await p.screenshot({path:`/downloads/agent-keys-e2e-task-${width}.png`});
await p.keyboard.press('Escape');
// Complete via the live API, sync again, verify the completion reaches the app.
r=await api(`/agent/tasks/${task.id}/complete`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({today})});
assert.equal(r.status,200);const done=await r.json();assert.equal(done.changed,true);
if(width<500)await p.getByRole('button',{name:'More',exact:true}).click();
await p.getByRole('button',{name:'Settings',exact:true}).click();
await p.getByRole('button',{name:'Sync Connect to your self-hosted server'}).click();
await p.getByRole('button',{name:'Sync now',exact:true}).click();await p.waitForTimeout(2500);
await p.keyboard.press('Escape');
const state=await p.evaluate(async(id)=>{const {db}=await import('/src/db.ts');const t=await db.tasks.get(id);return t?{status:t.status,completedAt:t.completedAt}:null;},task.id);
assert(state&&state.status==='done',`expected done in app DB, got ${JSON.stringify(state)}`);
assert.deepEqual(errors,[]);
await p.close();console.log(width,'E2E register->key->API create->sync into app->API complete->sync back PASS');}}
finally{await b?.close();}
