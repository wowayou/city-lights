// Drives the production build in headless Chromium over CDP (no npm deps):
// real clicks on the board and on buttons, long-press lock, undo, hints,
// replays and the reference demo, level select, daily persistence; screenshots.
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
  const state = () => evaluate('__cl.state()');
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  const click = async ([x, y], hold = 40) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(hold);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  /** Real mouse click in the middle of a visible element. */
  const press = async (sel) => {
    const c = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent || e.getClientRects().length); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (!c) throw new Error(`no visible ${sel}`);
    await click(c);
    await sleep(150);
  };
  const solveByTaps = async () => {
    const plan = await evaluate('__cl.plan()');
    for (const [x, y, taps] of plan) for (let k = 0; k < taps; k++) { await click([x, y], 20); await sleep(25); }
    return plan.reduce((a, p) => a + p[2], 0);
  };
  const waitFor = async (expr, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(expr)) return true;
    return false;
  };
  /** Waits for the result card and its rise animation, so its buttons are where they will stay. */
  const waitWon = async (ms) => (await waitFor(`__cl.state().dom === 'won'`, ms)) && (await sleep(600), true);
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
    await shot(`${label}-01-home`);

    // ---- level 1: tap, lock, undo, hint
    await press('[data-action=levels]');
    let s = await state();
    check(s.screen === 'play' && s.moves === 0, `${label}: levels opens level 1`);
    const c0 = await evaluate('__cl.cell(4)');
    await click(c0);
    await sleep(250);
    s = await state();
    check(s.moves === 1, `${label}: a real click rotates a tile (moves=${s.moves})`);
    await click(c0, 650);
    await sleep(200);
    s = await state();
    check(s.locked === 1 && s.moves === 1, `${label}: long-press locks without a move`);
    await click(c0);
    await sleep(200);
    s = await state();
    check(s.moves === 1, `${label}: a locked tile ignores taps`);
    await press('.tool[data-action=undo]');
    s = await state();
    check(s.locked === 0 && s.moves === 1, `${label}: undo takes back the lock first`);
    await press('.tool[data-action=undo]');
    s = await state();
    check(s.moves === 0 && s.log === 0, `${label}: undo takes back the turn`);
    await press('.tool[data-action=hint]');
    s = await state();
    const toast1 = await evaluate(`document.querySelector('.toast').textContent`);
    check(s.hints === 0 && /灯笼|lantern/.test(toast1), `${label}: first hint asks for confirmation ("${toast1}")`);
    await press('.tool[data-action=hint]');
    s = await state();
    check(s.hints === 1 && s.locked === 1, `${label}: confirmed hint fixes and locks a tile`);
    await sleep(300);
    await shot(`${label}-02-hint`);
    await press('.tool[data-action=undo]');
    s = await state();
    check(s.locked === 0 && s.moves === 0 && s.hints === 1, `${label}: one undo reverts the whole hint, hint stays counted`);
    await press('.tool[data-action=hint]');
    s = await state();
    check(s.hints === 2, `${label}: later hints need no confirmation`);

    await solveByTaps();
    check(await waitWon(5000), `${label}: solving level 1 by real taps shows the card`);
    const lit = await evaluate(`[...document.querySelector('.won-lanterns').childNodes].filter((n) => n.nodeType === 3).reduce((a, n) => a + [...n.textContent].length, 0)`);
    const extra = await evaluate(`document.querySelector('.won-extra').textContent`);
    check(/2/.test(extra) && lit <= 3, `${label}: two hints cost two lanterns and are mentioned ("${extra}", ${lit} lit)`);
    await shot(`${label}-03-level-won`);

    // ---- replay of my solve: play, seek, speed, end
    await press('[data-action=replay-mine]');
    s = await state();
    check(s.dom === 'replay' && s.playback.playing && s.playback.k === 0, `${label}: replay starts from the scrambled start (${s.playback.n} steps)`);
    await press('[data-action=pb-speed]');
    await press('[data-action=pb-speed]');
    s = await state();
    check(s.playback.speed === 4, `${label}: speed cycles to 4×`);
    check(await waitFor(`__cl.state().playback.done`), `${label}: replay reaches the end`);
    s = await state();
    check(s.solved && !s.playback.playing, `${label}: replay ends solved and paused`);
    await evaluate(`(() => { const el = document.querySelector('.player-seek'); el.value = 1; el.dispatchEvent(new Event('input')); })()`);
    s = await state();
    check(s.playback.k === 1 && !s.solved, `${label}: seeking back rebuilds the board`);
    await press('[data-action=pb-close]');
    s = await state();
    check(s.dom === 'won' && s.solved, `${label}: closing the replay returns to the solved card`);

    // ---- reference demo
    await press('[data-action=replay-ref]');
    s = await state();
    check(s.dom === 'replay' && s.playback.n === s.par, `${label}: reference demo has exactly the reference taps (${s.playback.n})`);
    check(await waitFor(`__cl.state().playback.done`), `${label}: reference demo finishes`);
    s = await state();
    check(s.solved, `${label}: reference demo ends solved`);
    await press('[data-action=pb-close]');

    // ---- level select
    await press('.won-screen [data-action=home]');
    await press('[data-action=level-select]');
    const cells = await evaluate(`[...document.querySelectorAll('.level-cell')].map((c) => c.className + ':' + c.querySelector('.mini').textContent)`);
    check((await state()).dom === 'levels' && cells.length === 2 && /cleared:🏮/.test(cells[0]) && /current/.test(cells[1]), `${label}: level select lists cleared and current levels ${JSON.stringify(cells)}`);
    await shot(`${label}-04-levels`);
    await press('.level-cell.cleared');
    s = await state();
    check(s.screen === 'play' && s.moves === 0 && s.hints === 0, `${label}: a cleared level can be replayed fresh`);
    await press('.hud [data-action=home]');

    // ---- daily: progress persists, real solve, replay after reload
    await press('[data-action=daily]');
    const taps = await evaluate(`[[0.5, 0.45], [0.42, 0.55], [0.58, 0.4]].map(([fx, fy]) => [innerWidth * fx, innerHeight * fy])`);
    for (const c of taps) { await click(c); await sleep(120); }
    await sleep(1000);
    await shot(`${label}-05-daily-play`);
    const before = await state();
    await send('Page.reload');
    await sleep(1200);
    const resume = await evaluate(`document.querySelector('.daily-sub').textContent`);
    check(/继续|Continue/.test(resume), `${label}: home offers to continue the daily ("${resume}")`);
    await press('[data-action=daily]');
    s = await state();
    check(s.moves === before.moves && s.log === before.log, `${label}: daily progress survives a reload (moves ${s.moves})`);
    const n = await solveByTaps();
    check(await waitWon(6000), `${label}: daily solved with ${n} more real taps`);
    await shot(`${label}-06-daily-won`);
    await send('Page.reload');
    await sleep(1200);
    await press('[data-action=daily]');
    s = await state();
    const replayVisible = await evaluate(`!document.querySelector('[data-action=replay-mine]').hidden`);
    check(s.dom === 'won' && s.solved && replayVisible, `${label}: a solved daily reopens solved, with its replay`);
    await press('[data-action=replay-mine]');
    await sleep(1800);
    await shot(`${label}-07-daily-replay`);
    s = await state();
    check(s.playback.n === before.moves + n && s.playback.k > 0, `${label}: daily replay plays the stored solve (${s.playback.k}/${s.playback.n})`);
    await press('[data-action=pb-close]');
    await press('[data-action=replay-ref]');
    await sleep(2500);
    await shot(`${label}-08-reference`);
    await press('[data-action=pb-close]');

    // ---- a save from the first release (positions only) is upgraded, not lost
    await evaluate(`localStorage.setItem('city-lights:v1:save:level:2', JSON.stringify({ rot: Array(16).fill(1), locked: Array(16).fill(0), moves: 7, elapsed: 4000 }))`);
    await press('.won-screen [data-action=home]');
    await press('[data-action=level-select]');
    await press('.level-cell.current');
    s = await state();
    check(s.moves === 7 && s.elapsed >= 4000 && s.elapsed < 6000, `${label}: a first-release save resumes (moves ${s.moves}, clock ${Math.round(s.elapsed)}ms)`);
    await solveByTaps();
    check(await waitWon(5000), `${label}: the upgraded save can be finished`);
    await press('[data-action=replay-mine]');
    s = await state();
    check(s.playback.k === 0 && s.moves === 7, `${label}: its replay starts from the saved position`);
  }
  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
  ws.close();
} finally {
  chrome.kill();
  server?.kill();
}
process.exit(failures.length ? 1 : 0);
