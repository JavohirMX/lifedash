// Live validation of attachment upload failure/retry paths against the local
// sync server, synthetic files only. Prompt (immediate) upload outcomes are
// intentionally unrecorded; the sync backfill owns failure tallies, backoff
// and UI surfacing. Scenario A (transient): server quota 0 -> structured
// 413 quota -> transient classification, exponential backoff suppresses
// auto-sync retries, manual Sync now re-attempts honestly, heal after the
// server accepts again. Scenario B (permanent): per-file cap 0 -> structured
// 413 file_too_large -> permanent classification, auto-sync suppressed until
// manual action, UI Retry button heals once the server accepts the size.
// Dev-only driver; never committed.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const EXE = '/usr/bin/google-chrome-stable';
const APP = 'http://127.0.0.1:4174';
const PORT = 8787;
const SYNC = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = '/home/sandbox/lifedash/server';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

let server = null;
let serverLog = [];
async function startServer(db, extraEnv) {
  serverLog = [];
  server = spawn('uv', ['run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT), '--no-proxy-headers'],
    { cwd: SERVER_DIR, env: { ...process.env, SYNC_DB: db, SYNC_OPEN_REGISTRATION: '1', ...extraEnv } });
  server.stdout.on('data', (d) => serverLog.push(...d.toString().split('\n')));
  server.stderr.on('data', (d) => serverLog.push(...d.toString().split('\n')));
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(SYNC + '/api/health'); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (server) { server.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 900)); server = null; }
}
const postCount = (code) => serverLog.filter((l) => l.includes('POST /api/attachments') && l.includes(`" ${code}`)).length;

const api = async (method, path, body, token) => {
  const r = await fetch(SYNC + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
};

const idb = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('lifedash'); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const getAll = (store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const atts = await getAll('attachments');
  const meta = await getAll('syncmeta');
  const fails = {};
  for (const row of meta) if (typeof row.key === 'string' && row.key.startsWith('blobfail:')) fails[row.key.slice(9)] = row.value;
  const att = atts.find((a) => a.name === 'pixel.png');
  return { att: att ? { id: att.id, blobOnServer: att.blobOnServer === true, hasBlob: !!att.blob } : null, fails };
});

(async () => {
  const errors = [];
  const browser = await chromium.launch({ executablePath: EXE });
  const makePage = async (username) => {
    const reg = await api('POST', '/api/register', { username, password: 'test-pw-12345' });
    if (reg.status !== 201 && reg.status !== 200) throw new Error('register ' + reg.status);
    const token = JSON.parse(reg.buf.toString()).token;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('lifedash-sync', JSON.stringify(s)); } catch (e) {} }, { url: SYNC, username, token });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      // Chromium logs failed fetches as console resource errors even when the
      // app catches them; during deliberate server restarts those are noise.
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('[' + username + ' console] ' + m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => errors.push('[' + username + ' pageerror] ' + String(e).slice(0, 160)));
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.quick-add-field input', { timeout: 15000 });
    return { page, token };
  };
  const createTaskAndOpen = async (page, title) => {
    await page.getByRole('button', { name: /^Today(\s|$)/ }).first().click({ timeout: 6000 });
    await page.locator('.quick-add-field input').first().fill(title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.locator('.task-row', { hasText: title }).first().click({ timeout: 6000 });
    await page.waitForSelector('aside[aria-label="Task details"]', { timeout: 8000 });
  };
  const attach = async (page) => {
    await page.getByLabel('Attach files').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_BUF });
  };
  const openTaskAside = async (page, title) => {
    await page.locator('.task-row', { hasText: title }).first().click({ timeout: 8000 });
    await page.waitForSelector('aside[aria-label="Task details"]', { timeout: 8000 });
    await page.waitForTimeout(400);
  };
  const manualSyncNow = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log('  manualSync: open Settings');
    await page.getByRole('button', { name: /^Settings(\s|$)/ }).first().click({ timeout: 8000 });
    console.log('  manualSync: open Sync row');
    await page.getByRole('button', { name: /^Sync Connect/ }).first().click({ timeout: 8000 });
    console.log('  manualSync: Sync now');
    await page.getByRole('button', { name: 'Sync now' }).click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    console.log('  manualSync: close');
    await page.locator('.sync-panel').getByRole('button', { name: 'Close' }).first().click({ timeout: 8000 });
    await page.waitForTimeout(400);
  };
  let failedStep = '';
  const step = async (page, name, fn) => {
    try { await fn(); console.log('OK  ' + name); return true; }
    catch (e) {
      console.log('FAIL ' + name + ' :: ' + String(e).split('\n')[0].slice(0, 200));
      try { await page.screenshot({ path: '/tmp/retry-fail-' + name.slice(0, 2) + '.png' }); } catch {}
      failedStep = name;
      return false;
    }
  };

  // ---------- Scenario A: transient (quota exhausted) ----------
  console.log('--- scenario A: transient 413 (quota), backoff, manual retry, heal');
  await startServer('/tmp/retry-a.db', { SYNC_ATTACHMENT_QUOTA_MB: '0' });
  let { page, token } = await makePage('retry-a');
  await step(page, 'A1 create task and let it push to server', async () => {
    await createTaskAndOpen(page, 'Transient host');
    await page.waitForTimeout(7000);
    const ch = await api('GET', '/api/changes?since=0', null, token);
    const ent = JSON.parse(ch.buf.toString()).changes.find((c) => c.collection === 'tasks');
    if (!ent || ent.data.title !== 'Transient host') throw new Error('task not on server yet');
  });
  await step(page, 'A2 attach -> prompt upload refused 413 quota; outcome unrecorded by design', async () => {
    await attach(page);
    await page.waitForTimeout(2500);
    if (postCount(413) !== 1) throw new Error('expected 1 POST 413 from prompt upload, saw ' + postCount(413));
    const { att, fails } = await idb(page);
    if (!att || !att.hasBlob) throw new Error('attachment row/blob missing locally');
    if (att.blobOnServer) throw new Error('blobOnServer true after refusal');
    if (fails[att.id]) throw new Error('prompt outcome should be unrecorded, got ' + JSON.stringify(fails[att.id]));
    const note = await page.locator('.att-row .att-state', { hasText: 'On this device only. Will try uploading on the next sync.' }).count();
    if (!note) throw new Error('local-only note missing');
    if (await page.locator('.att-state-warn').count()) throw new Error('permanent warning shown before any recorded failure');
  });
  await step(page, 'A3 auto sync backfill attempt fails transient and records tally', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(6000);
    if (postCount(413) !== 2) throw new Error('expected backfill re-attempt (2 POSTs 413), saw ' + postCount(413));
    const { att, fails } = await idb(page);
    const st = fails[att.id];
    if (!st || st.permanent) throw new Error('expected transient tally, got ' + JSON.stringify(st));
    if (st.count !== 1) throw new Error('expected count 1, got ' + JSON.stringify(st));
    console.log('  transient tally ' + JSON.stringify(st));
  });
  await step(page, 'A4 next auto sync respects exponential backoff (no attempt)', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(6000);
    if (postCount(413) !== 2) throw new Error('backoff violated: 413 count ' + postCount(413));
    if (postCount(201) !== 0) throw new Error('unexpected success during backoff');
    const { att, fails } = await idb(page);
    if (!fails[att.id] || fails[att.id].count !== 1) throw new Error('tally changed during backoff: ' + JSON.stringify(fails[att.id]));
    const note = await page.locator('.att-row .att-state', { hasText: 'Will try uploading on the next sync.' }).count();
    if (!note) throw new Error('local-only note missing during backoff');
  });
  await step(page, 'A5 manual Sync now clears backoff, re-attempts, re-records transient', async () => {
    await manualSyncNow(page);
    if (postCount(413) !== 3) throw new Error('manual Sync now did not re-attempt (413 count ' + postCount(413) + ')');
    const { att, fails } = await idb(page);
    if (!fails[att.id] || fails[att.id].permanent) throw new Error('transient refusal not re-recorded: ' + JSON.stringify(fails[att.id]));
    await openTaskAside(page, 'Transient host');
    const note = await page.locator('.att-row .att-state', { hasText: 'Will try uploading on the next sync.' }).count();
    if (!note) throw new Error('local-only note missing after re-recorded transient refusal');
    if (await page.locator('.att-state-warn').count()) throw new Error('permanent warning shown for transient refusal');
  });
  await step(page, 'A6 once the server has room, manual Sync now heals; bytes identical', async () => {
    await stopServer();
    await startServer('/tmp/retry-a.db', {});
    await manualSyncNow(page);
    if (postCount(201) !== 1) throw new Error('expected 1 blob POST 201 after heal, saw ' + postCount(201));
    const { att, fails } = await idb(page);
    if (!att.blobOnServer) throw new Error('blobOnServer still false after heal');
    if (fails[att.id]) throw new Error('tally not cleared after success');
    await openTaskAside(page, 'Transient host');
    if (await page.locator('.att-state').count()) throw new Error('local-only note still shown after upload');
    const dl = await api('GET', '/api/attachments/' + encodeURIComponent(att.id) + '/content', null, token);
    if (dl.status !== 200 || !dl.buf.equals(PNG_BUF)) throw new Error('server blob bytes wrong: status ' + dl.status + ' len ' + dl.buf.length);
  });
  await stopServer();

  // ---------- Scenario B: permanent (per-file size) ----------
  console.log('--- scenario B: permanent 413 (file too large), suppression, UI Retry heals');
  await startServer('/tmp/retry-b.db', { SYNC_ATTACHMENT_MAX_FILE_MB: '0' });
  ({ page, token } = await makePage('retry-b'));
  await step(page, 'B1 create task and let it push to server', async () => {
    await createTaskAndOpen(page, 'Permanent host');
    await page.waitForTimeout(7000);
    const ch = await api('GET', '/api/changes?since=0', null, token);
    const ent = JSON.parse(ch.buf.toString()).changes.find((c) => c.collection === 'tasks');
    if (!ent || ent.data.title !== 'Permanent host') throw new Error('task not on server yet');
  });
  await step(page, 'B2 attach -> prompt upload refused 413 file-too-large; outcome unrecorded by design', async () => {
    await attach(page);
    await page.waitForTimeout(2500);
    if (postCount(413) !== 1) throw new Error('expected 1 POST 413 from prompt upload, saw ' + postCount(413));
    const { att, fails } = await idb(page);
    if (!att) throw new Error('attachment row missing');
    if (fails[att.id]) throw new Error('prompt outcome should be unrecorded, got ' + JSON.stringify(fails[att.id]));
    if (await page.locator('.att-state-warn').count()) throw new Error('permanent warning shown before any recorded failure');
  });
  await step(page, 'B3 auto sync backfill attempt records permanent tally; UI warns with Retry', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(6000);
    if (postCount(413) !== 2) throw new Error('expected backfill re-attempt (2 POSTs 413), saw ' + postCount(413));
    const { att, fails } = await idb(page);
    if (!fails[att.id] || fails[att.id].permanent !== true) throw new Error('expected permanent tally, got ' + JSON.stringify(fails[att.id]));
    const warn = page.locator('.att-state-warn', { hasText: "Couldn't upload to the sync server; on this device only." });
    if (!(await warn.count())) throw new Error('permanent warning missing');
    if (!(await warn.locator('button', { hasText: 'Retry' }).count())) throw new Error('Retry button missing in warning');
  });
  await step(page, 'B4 next auto sync suppresses permanent retries (no attempt)', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(6000);
    if (postCount(413) !== 2) throw new Error('permanent suppression violated: 413 count ' + postCount(413));
    const { att, fails } = await idb(page);
    if (!fails[att.id] || fails[att.id].permanent !== true) throw new Error('tally changed during suppression: ' + JSON.stringify(fails[att.id]));
  });
  await step(page, 'B5 manual Sync now re-attempts once and re-records permanent', async () => {
    await manualSyncNow(page);
    if (postCount(413) !== 3) throw new Error('manual Sync now did not re-attempt (413 count ' + postCount(413) + ')');
    const { att, fails } = await idb(page);
    if (!fails[att.id] || fails[att.id].permanent !== true) throw new Error('permanent not re-recorded: ' + JSON.stringify(fails[att.id]));
    await openTaskAside(page, 'Permanent host');
    if (!(await page.locator('.att-state-warn').count())) throw new Error('warning missing after re-recorded refusal');
  });
  await step(page, 'B6 once the server accepts the size, the UI Retry button heals it', async () => {
    await stopServer();
    await startServer('/tmp/retry-b.db', {});
    await openTaskAside(page, 'Permanent host');
    await page.locator('.att-state-warn button', { hasText: 'Retry' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    if (postCount(201) !== 1) throw new Error('expected 1 blob POST 201 after Retry, saw ' + postCount(201));
    const status = await page.locator('.attachment-feedback[role="status"]').first().innerText();
    if (!status.includes('Uploaded pixel.png')) throw new Error('status text wrong: ' + status.slice(0, 120));
    const { att, fails } = await idb(page);
    if (!att.blobOnServer) throw new Error('blobOnServer still false after Retry');
    if (fails[att.id]) throw new Error('tally not cleared after Retry success');
    if (await page.locator('.att-state').count()) throw new Error('warning still shown after successful Retry');
    const dl = await api('GET', '/api/attachments/' + encodeURIComponent(att.id) + '/content', null, token);
    if (dl.status !== 200 || !dl.buf.equals(PNG_BUF)) throw new Error('server blob bytes wrong: status ' + dl.status + ' len ' + dl.buf.length);
  });
  await stopServer();

  await step(page, 'no app console/page errors across both scenarios', async () => {
    if (errors.length) throw new Error(errors.slice(0, 4).join(' | '));
  });
  await browser.close();
  console.log('DONE failed=' + (failedStep || 'none'));
})().catch(async (e) => { console.log('FATAL ' + String(e).slice(0, 300)); try { await stopServer(); } catch {} process.exit(1); });
