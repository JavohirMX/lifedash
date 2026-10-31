// Start an isolated local Vite server and run sample-only keyboard regressions.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const port = process.env.KEYBOARD_TEST_PORT ?? '4174';
const url = `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const detectedChrome = chromeCandidates.find(p => existsSync(p));
const chromeEnv = detectedChrome ? { CHROME_PATH: detectedChrome } : {};
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
let child;
let stopping = false;
const stop = () => { stopping = true; child?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  let ready = false;
  for (let i = 0; i < 100 && !stopping; i++) {
    if (server.exitCode !== null) throw new Error(`Vite stopped before tests:\n${output}`);
    // Wait for our server's ready notice before fetching. A port conflict must
    // fail, never run against somebody else's existing server.
    if (output.includes('Local:')) {
      try { ready = (await fetch(url, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break;
    }
    await delay(100);
  }
  if (!ready) throw new Error(stopping ? 'Keyboard checks interrupted.' : `Vite did not become ready:\n${output}`);
  for (const script of ['dialog-keyboard-smoke.mjs', 'palette-keyboard-smoke.mjs']) {
    if (stopping) throw new Error('Keyboard checks interrupted.');
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [`scripts/${script}`], { stdio: 'inherit', env: { ...process.env, ...chromeEnv, BASE_URL: url } });
      child.on('error', reject);
      child.on('exit', (code, signal) => resolve(signal ? 1 : code));
    });
    if (code !== 0) throw new Error(`${script} failed (${code}).`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
}
