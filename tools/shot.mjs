/*
 * English Land - headless capture driver.
 *
 *   node tools/shot.mjs <recipe.mjs> [url] [outDir]
 *   node tools/shot.mjs tools/recipes/sheet.mjs http://127.0.0.1:5173/ tools/shots
 *
 * Launches headless Chrome, drives it over the DevTools protocol, waits for the
 * page's `window.EL` hook, then hands a small API to the recipe. No npm
 * packages: Chrome speaks CDP over a WebSocket and Node has had a global
 * WebSocket since 22.
 *
 * Start the server first:
 *   powershell -ExecutionPolicy Bypass -File "tools\serve.ps1" -Port 5173
 *
 * A recipe is a module with a default async function taking { evaluate,
 * capture, shot, savePng, send, sleep, consoleLog, OUT }. See tools/recipes/.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 0 lets Chrome pick a free port and report it in DevToolsActivePort. A fixed
// port collides the moment two capture runs overlap, or the previous Chrome is
// still letting go of the socket.
const DPORT = Number(process.env.DPORT || 0);

const recipePath = resolve(process.argv[2] || '');
const URL_ = process.argv[3] || 'http://127.0.0.1:5173/';
const OUT = resolve(process.argv[4] || 'tools/shots');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ chrome */
const profile = mkdtempSync(join(tmpdir(), 'el-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DPORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking',
  '--disable-sync', '--mute-audio', '--hide-scrollbars',
  // software GL: headless still gives WebGL2, just slowly. FPS numbers taken
  // from a capture run mean nothing - measure performance in a real browser.
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800',
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

/* Chrome writes the port it actually took into DevToolsActivePort in the
 * profile directory. Reading it back is what makes back-to-back runs safe. */
let port = DPORT;
{
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; ; i++) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (first) { port = Number(first); break; }
    }
    if (i === 150) {
      console.error('chrome never came up\n' + chromeErr);
      chrome.kill(); process.exit(1);
    }
    await sleep(200);
  }
}

const devtools = async (path, init) =>
  (await fetch(`http://127.0.0.1:${port}${path}`, init)).json();

for (let i = 0; ; i++) {
  try { await devtools('/json/version'); break; } catch { await sleep(200); }
  if (i === 60) {
    console.error('devtools never answered\n' + chromeErr);
    chrome.kill(); process.exit(1);
  }
}
const target = await devtools('/json/new?url=about:blank', { method: 'PUT' });

/* --------------------------------------------------------------------- cdp */
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let nextId = 1;
const pending = new Map();
const listeners = [];
const consoleLog = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, no } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? no(new Error(msg.error.message + ' ' + (msg.error.data || ''))) : ok(msg.result);
    return;
  }
  for (const fn of listeners) fn(msg);
};

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((ok, no) => {
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const on = (fn) => listeners.push(fn);

on((m) => {
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLog.push({
      level: m.params.type,
      text: (m.params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(' ')
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    consoleLog.push({
      level: 'exception',
      text: (d.exception && (d.exception.description || d.exception.value)) || d.text
    });
  }
  if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' || e.level === 'warning') {
      consoleLog.push({ level: e.level, text: `[${e.source}] ${e.text}` });
    }
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

/* ----------------------------------------------------------------- helpers */
async function evaluate(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page error: ' +
      ((d.exception && (d.exception.description || d.exception.value)) || d.text));
  }
  return r.result.value;
}

function savePng(name, dataUrl) {
  const file = join(OUT, name.endsWith('.png') ? name : name + '.png');
  writeFileSync(file, Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));
  return file;
}

/** EL.capture(...) straight to a file. */
async function capture(name, { alpha = -Math.PI / 2, beta = 1.12, radius = 4.2,
                               targetY = 0.62, w = 900, h = 700, focus = null } = {}) {
  const f = focus ? `new BABYLON.Vector3(${focus.x},${focus.y || 0},${focus.z})` : 'null';
  return savePng(name,
    await evaluate(`EL.capture(${alpha},${beta},${radius},${targetY},${w},${h},${f}).png`));
}

/** Whole-page screenshot, HUD included. */
async function shot(name, { w = 1280, h = 800 } = {}) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(()=>{ if(window.EL){EL.engine.setSize(${w},${h});
    EL.scene.render();EL.scene.render();} })()`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  return savePng(name, 'data:image/png;base64,' + r.data);
}

/* ---------------------------------------------------------------- navigate */
await send('Page.navigate', { url: URL_ });
await new Promise((ok) => {
  const t = setTimeout(ok, 30000);
  on((m) => { if (m.method === 'Page.loadEventFired') { clearTimeout(t); ok(); } });
});

let ready = false;
for (let i = 0; i < 150; i++) {
  try { if (await evaluate('!!(window.EL && EL.world && EL.char)')) { ready = true; break; } }
  catch { /* still parsing */ }
  await sleep(200);
}
await sleep(600);                 // let scene.executeWhenReady settle

/* ------------------------------------------------------------------ recipe */
let failed = null;
try {
  const mod = await import(pathToFileURL(recipePath).href);
  await mod.default({ evaluate, capture, shot, savePng, send, sleep, consoleLog, OUT, ready });
} catch (e) {
  failed = e;
}

console.log(`\n--- console (${consoleLog.length} entries) ---`);
for (const c of consoleLog.slice(0, 60)) console.log(`  [${c.level}] ${c.text.slice(0, 300)}`);
if (!ready) console.log('  !! window.EL never appeared');

// Browser.close never answers once the browser is gone, so do not await it.
send('Browser.close').catch(() => {});
await sleep(150);
ws.close();
chrome.kill();
if (failed) { console.error('\nRECIPE FAILED:', failed.message); process.exit(1); }
process.exit(0);
