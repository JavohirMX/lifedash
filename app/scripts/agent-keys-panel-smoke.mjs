// Unmounted component harness. All API destinations intercepted, fictional credentials.
import assert from 'node:assert/strict';import {writeFile,unlink} from 'node:fs/promises';import {chromium} from 'playwright-core';
const file='__agentkeys-review.html';await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {createRoot}=ReactDOM;import Dialog from '/src/components/AgentKeysDialog.tsx';import '/src/styles.css';document.documentElement.dataset.theme=new URLSearchParams(location.search).get('mode')||'light';localStorage.setItem('lifedash-sync',JSON.stringify({url:'https://fictional-sync.invalid',token:'synthetic',username:'synthetic'}));createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Dialog,{onClose:()=>{}})));</script></body></html>`);
const existing={id:'k1',name:'Claude',scope:'read',created_at:'2026-10-28T09:00:00Z',last_used_at:null,revoked_at:null};
let b;try{b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});for(const width of[1440,390])for(const mode of['light','dark']){const p=await b.newPage({viewport:{width,height:844}});const calls=[],errors=[];let revoked=false,createdKey=null;p.on('pageerror',e=>errors.push(e.message));
await p.route('https://fictional-sync.invalid/**',r=>{const path=new URL(r.request().url()).pathname;const m=r.request().method();calls.push(`${m} ${path}`);
if(m==='GET'&&path.endsWith('/agent-tokens'))return r.fulfill({json:{tokens:[...(revoked?[]:[existing]),...(createdKey?[createdKey]:[])]}});
if(m==='POST'&&path.endsWith('/agent-tokens')){createdKey={id:'k2',name:'New agent',scope:'read-write',created_at:'2026-10-29T10:00:00Z',last_used_at:null,revoked_at:null};return r.fulfill({status:201,json:{...createdKey,token:'ldk_synthetic_shown_once'}})}
if(m==='POST'&&path.includes('/revoke')){revoked=true;return r.fulfill({status:204})}
return r.abort()});
await p.goto(`${process.env.BASE_URL??'http://127.0.0.1:4185'}/${file}?mode=${mode}`);
await p.getByText('Claude',{exact:true}).waitFor({timeout:8000}).catch(async e=>{console.error(errors,await p.locator('body').innerText());throw e});
assert(calls.some(c=>c==='GET /api/agent-tokens'));
assert(await p.getByText('Read only',{exact:true}).count()>=1);
await p.screenshot({path:`/downloads/agent-keys-list-${width}-${mode}.png`});
// Two-tap revoke: first tap arms, second confirms.
await p.getByRole('button',{name:'Revoke',exact:true}).click();await p.getByRole('button',{name:'Confirm revoke',exact:true}).waitFor();
await p.getByRole('button',{name:'Confirm revoke',exact:true}).click();await p.getByText('No keys yet.',{exact:false}).waitFor();
assert(calls.some(c=>c.includes('/revoke')));
// Create flow: show-once token state.
await p.getByLabel('Name',{exact:true}).fill('New agent');await p.getByRole('button',{name:'Create key',exact:true}).click();
await p.getByText('ldk_synthetic_shown_once',{exact:true}).waitFor();await p.getByText('shown once',{exact:false}).waitFor();
await p.screenshot({path:`/downloads/agent-keys-${width}-${mode}.png`});
assert(await p.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
await p.getByRole('button',{name:'Done',exact:true}).click();await p.getByText('New agent',{exact:true}).waitFor();
await p.close();assert.deepEqual(errors,[]);console.log(width,mode,'list/two-tap-revoke/create-show-once/no-overflow PASS');}
// Not-connected state: no settings, no network.
{const p=await b.newPage();let forbidden=0;await p.route('https://fictional-sync.invalid/**',r=>{forbidden++;return r.abort()});
const f2='__agentkeys-offline.html';await writeFile(f2,`<html><body><div id="root"></div><script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {createRoot}=ReactDOM;import Dialog from '/src/components/AgentKeysDialog.tsx';import '/src/styles.css';createRoot(document.getElementById('root')).render(React.createElement(Dialog,{onClose:()=>{}}));</script></body></html>`);
await p.goto(`${process.env.BASE_URL??'http://127.0.0.1:4185'}/${f2}`);await p.getByText('Connect Sync first.',{exact:false}).waitFor();assert.equal(forbidden,0);await p.close();await unlink(f2);console.log('not-connected zero-network PASS');}}
finally{await b?.close();await unlink(file)}
