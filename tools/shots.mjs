// Drives the production build in headless Chromium over CDP (no npm deps):
// real clicks, a long-press lock, solving a level and the daily, screenshots.
// Usage: npm run build && [SHOT_LANG=zh-CN] [BASE=https://…/] node tools/shots.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BASE=<url> checks a deployed site instead of a local `vite preview`.
const BASE = process.env.BASE ?? 'http://localhost:4199/';
const server = process.env.BASE ? null : spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=9333', '--user-data-dir=/tmp/cl-chrome-' + process.pid, 'about:blank'], { stdio: 'ignore' });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

try {
  let targets;
  for (let k = 0; k < 50; k++) {
    try { targets = await (await fetch('http://127.0.0.1:9333/json/list')).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args.map((a) => a.value)));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  const click = async ([x, y], hold = 40) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(hold);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await send('Runtime.enable');
  await send('Page.enable');
  if (process.env.SHOT_LANG) {
    const { result } = await send('Browser.getVersion');
    await send('Emulation.setUserAgentOverride', { userAgent: result.userAgent, acceptLanguage: process.env.SHOT_LANG });
  }

  for (const [label, w, h, mobile] of [['phone', 390, 844, true], ['desktop', 1280, 800, false]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send('Page.navigate', { url: `${BASE}?debug` });
    await sleep(800);
    await evaluate('localStorage.clear()');
    await send('Page.reload');
    await sleep(2500);
    await shot(`${label}-1-home`);

    await evaluate(`document.querySelector('[data-action=levels]').click()`);
    await sleep(500);
    let s = await evaluate('__cl.state()');
    check(s.screen === 'play' && s.moves === 0, `${label}: levels opens level 1`);
    const c0 = await evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.width / 2, r.height / 2]; })()`);
    await click(c0);
    await sleep(300);
    s = await evaluate('__cl.state()');
    check(s.moves === 1, `${label}: a real click rotates a tile (moves=${s.moves})`);
    await click(c0, 650);
    await sleep(200);
    s = await evaluate('__cl.state()');
    check(s.locked === 1 && s.moves === 1, `${label}: long-press locks without a move (locked=${s.locked}, moves=${s.moves})`);
    await click(c0);
    await sleep(200);
    s = await evaluate('__cl.state()');
    check(s.moves === 1, `${label}: a locked tile ignores taps`);

    const p = await evaluate('__cl.nearlySolve()');
    await click(p);
    await sleep(2600);
    s = await evaluate('__cl.state()');
    check(s.solved && s.dom === 'won', `${label}: final real click solves level 1 and shows the card`);
    await shot(`${label}-2-level-won`);
    await evaluate(`document.querySelector('.won-primary').click()`);
    await sleep(500);
    s = await evaluate('__cl.state()');
    check(s.screen === 'play' && s.moves === 0, `${label}: next level opens`);

    await evaluate(`document.querySelector('.hud [data-action=home]').click()`);
    await sleep(300);
    await evaluate(`document.querySelector('[data-action=daily]').click()`);
    await sleep(400);
    const cells = await evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [[r.width * 0.5, r.height * 0.45], [r.width * 0.42, r.height * 0.55], [r.width * 0.58, r.height * 0.4]]; })()`);
    for (const c of cells) { await click(c); await sleep(120); }
    await sleep(1200);
    await shot(`${label}-3-daily-play`);
    s = await evaluate('__cl.state()');
    check(s.screen === 'play' && s.houses > 0, `${label}: daily board with ${s.houses} homes, ${s.housesLit} lit`);

    await send('Page.reload');
    await sleep(1200);
    await evaluate(`document.querySelector('[data-action=daily]').click()`);
    await sleep(400);
    const s2 = await evaluate('__cl.state()');
    check(s2.moves === s.moves, `${label}: daily progress survives a reload (moves ${s2.moves})`);

    // solve the daily for real: every tap goes through the pointer path
    const plan = await evaluate('__cl.plan()');
    const par = (await evaluate('__cl.state()')).par;
    for (const [x, y, taps] of plan) for (let k = 0; k < taps; k++) { await click([x, y], 20); await sleep(25); }
    await sleep(900);
    await shot(`${label}-4-daily-wave`);
    await sleep(2200);
    await shot(`${label}-5-daily-won`);
    s = await evaluate('__cl.state()');
    check(s.dom === 'won' && s.moves === s2.moves + plan.reduce((a, p) => a + p[2], 0), `${label}: daily solved by ${plan.length} tiles of real taps (moves ${s.moves}, reference ${par})`);
    await evaluate(`document.querySelector('.won-screen [data-action=home]').click()`);
    await sleep(500);
    const sub = await evaluate(`document.querySelector('.daily-sub').textContent`);
    check(/已完成|Solved/.test(sub), `${label}: home shows the daily as solved ("${sub}")`);
  }
  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
  ws.close();
} finally {
  chrome.kill();
  server?.kill();
}
process.exit(failures.length ? 1 : 0);
