// Drives the production build in headless Chromium over CDP (no npm deps):
// real clicks on the board and on buttons, long-press lock, undo, hints,
// replays, persistence, input cancellation and small/landscape layouts; screenshots.
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
const server = process.env.BASE ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4199', '--strictPort'], { stdio: 'ignore' });
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(i, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`Evaluation failed: ${JSON.stringify(r.result.exceptionDetails)}`);
    return r.result?.result?.value;
  };
  const state = () => evaluate('__cl.state()');
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  const click = async ([x, y], hold = 40) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(hold);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  /** Real mouse click in the middle of a visible element. */
  const press = async (sel) => {
    const c = await evaluate(`(async () => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise(requestAnimationFrame); // measure the painted scroll position
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Button is obscured: ' + ${JSON.stringify(sel)});
      return [x, y];
    })()`);
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
  /** Waits for the result card and its entrance fade before taking a screenshot. */
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
    check(s.playback.step === 1 && !s.solved && !s.playback.busy, `${label}: dragging the slider to step 1 rebuilds the board (${s.playback.k} turns in)`);
    await press('[data-action=pb-close]');
    s = await state();
    check(s.dom === 'won' && s.solved, `${label}: closing the replay returns to the solved card`);

    // ---- reference demo: waits for a tap per step, previews the next tile, steps back, auto-plays
    await press('[data-action=replay-ref]');
    s = await state();
    const hintText = await evaluate(`document.querySelector('.player-hint').textContent`);
    check(s.dom === 'replay' && s.playback.n === s.par && !s.playback.busy && s.playback.k === 0 && s.playback.preview && hintText,
      `${label}: reference opens paused at step 0 with a preview (${s.playback.steps} steps, ${s.playback.n} turns, "${hintText}")`);
    const firstTile = s.playback.preview.i;
    const boardSpot = await evaluate('__cl.cell(0)');
    await click(boardSpot); // anywhere on the board
    check(await waitFor(`!__cl.state().playback.busy`, 3000), `${label}: one tap plays one step`);
    s = await state();
    check(s.playback.step === 1 && s.playback.preview?.i !== firstTile, `${label}: after a tap: step 1, preview moved on`);
    await press('[data-action=pb-next]');
    await waitFor(`!__cl.state().playback.busy`, 3000);
    s = await state();
    check(s.playback.step === 2, `${label}: next-step button plays step 2`);
    await press('[data-action=pb-prev]');
    s = await state();
    check(s.playback.step === 1 && s.playback.preview?.i !== firstTile, `${label}: previous-step button goes back to step 1`);
    await press('[data-action=pb-toggle]');
    s = await state();
    check(s.playback.playing && !(await evaluate(`document.querySelector('.player-hint').textContent`)), `${label}: play button auto-plays and hides the tap hint`);
    await press('[data-action=pb-speed]');
    await press('[data-action=pb-speed]');
    check(await waitFor(`__cl.state().playback.done`, 40000), `${label}: reference demo finishes`);
    s = await state();
    check(s.solved && s.playback.step === s.playback.steps, `${label}: reference demo ends solved`);
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
    const boxBefore = await evaluate('document.querySelector("[data-action=replay-ref]").getBoundingClientRect().toJSON()');
    await sleep(40);
    const boxAfter = await evaluate('document.querySelector("[data-action=replay-ref]").getBoundingClientRect().toJSON()');
    check(boxBefore.y === boxAfter.y && boxBefore.height === boxAfter.height, `${label}: result buttons stay stationary during a rapid replay switch`);
    await press('[data-action=replay-ref]');
    s = await state();
    check(s.dom === 'replay' && s.playback?.step === 0, `${label}: quickly switching from replay back to the reference actually opens it`);
    await sleep(400);
    await shot(`${label}-08-reference-step0`);
    for (let k = 0; k < 6; k++) {
      await click(boardSpot);
      await waitFor(`!__cl.state().playback.busy`, 3000);
    }
    await sleep(300);
    await shot(`${label}-09-reference-step6`);
    s = await state();
    check(s.playback.step === 6 && !s.solved, `${label}: six taps walk six tiles of the daily (${s.playback.k}/${s.playback.n} turns)`);
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

  // ---- regression: active time and interruptions
  const dimensions = async (width, height, mobile = true) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await sleep(300);
  };
  const reload = async () => {
    await send('Page.reload');
    await sleep(500);
    if (!(await waitFor(`document.readyState === 'complete' && !!window.__cl`, 5000))) throw new Error('App did not load');
  };
  const fresh = async () => {
    // Leave play first: otherwise pagehide legitimately re-saves the board after the fixture is cleared.
    await evaluate('document.querySelector(".hud [data-action=home]").click(); localStorage.clear();');
    await reload();
  };
  const key = async (key, modifiers = 0, autoRepeat = false) => {
    const codes = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
    const params = { key, code: key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0), modifiers };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, autoRepeat,
      text: !modifiers && (key === 'Enter' || key.length === 1) ? key === 'Enter' ? '\r' : key : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    await sleep(60);
  };
  const mouse = (type, [x, y], button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : button === 'right' ? 2 : 1, clickCount: 1 });
  const sameBoard = (a, b) => JSON.stringify(a.board) === JSON.stringify(b.board) && a.moves === b.moves && a.log === b.log;

  await dimensions(390, 844);
  await fresh();
  await press('[data-action=levels]');
  await sleep(350);
  check((await state()).elapsed === 0, 'clock: observing a new board does not start time');
  await click(await evaluate('__cl.cell(4)'), 600);
  check((await state()).elapsed === 0 && (await state()).locked === 1, 'clock: a lock alone does not start time');
  await press('[data-action=undo]');
  await click(await evaluate('__cl.cell(4)'));
  await sleep(250);
  await press('[data-action=undo]');
  await press('.hud [data-action=home]');
  await press('[data-action=levels]');
  let before = await state();
  await sleep(400);
  let after = await state();
  check(after.moves === 0 && after.started && after.elapsed - before.elapsed >= 350, 'clock: returning after undo to zero moves keeps time running');
  await reload();
  await press('[data-action=levels]');
  before = await state();
  await sleep(350);
  check((await state()).elapsed - before.elapsed >= 300, 'clock: zero-move started state also survives a reload');
  await click(await evaluate('__cl.cell(4)'));
  await press('[data-action=reset]');
  check((await state()).moves === 1, 'clock: restart still needs confirmation');
  await press('[data-action=reset]');
  await reload();
  await press('[data-action=levels]');
  before = await state();
  await sleep(350);
  after = await state();
  check(after.moves === 0 && after.started && after.elapsed - before.elapsed >= 300, 'clock: restarting and reloading does not reset or stop the clock');
  const stallBefore = after.elapsed;
  const stallAfter = await evaluate(`(() => { const end = performance.now() + 450; while (performance.now() < end) {} return __cl.state().elapsed; })()`);
  check(stallAfter - stallBefore >= 440, 'clock: a 450ms foreground stall is counted, not clipped to an animation frame');

  // A real second tab hides/blurs this one while a press is pending.
  const heldCell = await evaluate('__cl.cell(4)');
  const heldBoard = await state();
  await mouse('mousePressed', heldCell);
  const other = await send('Target.createTarget', { url: 'about:blank' });
  await send('Target.activateTarget', { targetId: other.result.targetId });
  check(await waitFor('document.hidden', 3000), 'clock: test tab really became hidden');
  const hiddenAt = (await state()).elapsed;
  await sleep(650);
  check(Math.abs((await state()).elapsed - hiddenAt) < 30, 'clock: background time is excluded');
  await send('Target.closeTarget', { targetId: other.result.targetId });
  await send('Page.bringToFront');
  await waitFor('!document.hidden', 3000);
  await mouse('mouseReleased', heldCell);
  check(sameBoard(heldBoard, await state()), 'input: hiding/blurring the window cancels a pending long press');
  const visibleAt = (await state()).elapsed;
  await sleep(350);
  check((await state()).elapsed - visibleAt >= 300, 'clock: returning to the tab resumes active time');

  // ---- regression: focus ownership, pointer capture and real touch events
  await fresh();
  await press('[data-action=levels]');
  check(await evaluate('document.activeElement.id === "stage"'), 'keyboard: entering a game focuses the board');
  await key('ArrowRight');
  await key('Enter');
  check((await state()).moves === 1, 'keyboard: arrows and Enter operate the focused board');
  await key('z', 2); // Ctrl+Z belongs to the browser, not the game.
  check((await state()).moves === 1, 'keyboard: modified shortcuts do not change the board');
  for (let k = 0; k < 3; k++) await key('Tab');
  check(await evaluate('document.activeElement.dataset.action === "undo"'), 'keyboard: Tab reaches the real undo button');
  await key('Enter');
  check((await state()).moves === 0 && await evaluate('document.activeElement.dataset.action === "undo"'), 'keyboard: Enter activates Undo, never rotates a tile or drops focus');
  const soundBefore = await evaluate('document.querySelector("[data-action=sound]").getAttribute("aria-pressed")');
  await key('m');
  check(await evaluate('document.querySelector("[data-action=sound]").getAttribute("aria-pressed")') !== soundBefore && (await state()).moves === 0, 'keyboard: M still toggles sound while a button is focused');

  const cell = await evaluate('__cl.cell(4)');
  before = await state();
  await mouse('mousePressed', cell);
  await key('Escape');
  await key('Tab'); // daily → levels on the home screen
  await key('Enter');
  await sleep(600);
  await mouse('mouseReleased', cell);
  check((await state()).screen === 'play' && sameBoard(before, await state()), 'input: an old long press cannot lock a reopened board');

  before = await state();
  await mouse('mousePressed', cell);
  await mouse('mouseMoved', [20, 20]);
  await sleep(550);
  await mouse('mouseReleased', [20, 20]);
  check((await state()).screen === 'play' && sameBoard(before, await state()), 'input: dragging onto the HUD neither turns nor locks nor activates a button');
  await mouse('mousePressed', cell);
  await dimensions(844, 390);
  await sleep(500);
  await mouse('mouseReleased', cell);
  check(sameBoard(before, await state()), 'input: resizing cancels a pending gesture without changing the board');
  await dimensions(390, 844);

  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touchCell = await evaluate('__cl.cell(4)');
  const point = { id: 1, x: touchCell[0], y: touchCell[1], radiusX: 2, radiusY: 2, force: 1 };
  const touch = (type, touchPoints = []) => send('Input.dispatchTouchEvent', { type, touchPoints });
  before = await state();
  await touch('touchStart', [point]);
  await sleep(50);
  await touch('touchEnd');
  check((await state()).moves === before.moves + 1, 'touch: a real finger tap turns exactly once');
  await touch('touchStart', [point]);
  await sleep(600);
  await touch('touchEnd');
  after = await state();
  check(after.locked === 1 && after.moves === before.moves + 1, 'touch: a real hold locks without an extra turn');
  await press('[data-action=undo]');
  before = await state();
  await touch('touchStart', [point]);
  await touch('touchMove', [{ ...point, x: point.x + 30 }]);
  await sleep(550);
  await touch('touchEnd');
  check(sameBoard(before, await state()), 'touch: dragging cancels both the tap and the hold');
  await touch('touchStart', [point]);
  await touch('touchCancel');
  await sleep(550);
  check(sameBoard(before, await state()), 'touch: pointer cancellation clears the hold timer');
  await touch('touchStart', [point]);
  await touch('touchStart', [point, { ...point, id: 2, x: point.x + 30 }]);
  await sleep(550);
  await touch('touchEnd');
  check(sameBoard(before, await state()), 'touch: a second finger cannot steal or complete the first gesture');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await mouse('mousePressed', touchCell, 'right');
  await mouse('mouseReleased', touchCell, 'right');
  check((await state()).locked === 1, 'input: right-click still locks a tile');
  await mouse('mousePressed', touchCell, 'right');
  await mouse('mouseReleased', touchCell, 'right');
  await key('l');
  await key('l', 0, true);
  check((await state()).locked === 1, 'keyboard: held lock key does not repeatedly toggle');
  await key('l');

  // ---- regression: failed writes never restore an older disk snapshot
  await fresh();
  await press('[data-action=levels]');
  await click(await evaluate('__cl.cell(4)'));
  await evaluate(`window.__storageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('quota', 'QuotaExceededError'); };`);
  await click(await evaluate('__cl.cell(4)'));
  before = await state();
  check(!before.persistent && await evaluate('!document.querySelector(".storage-warning").hidden'), 'storage: failed writes show a persistent warning');
  await shot('storage-session-warning');
  await press('.hud [data-action=home]');
  await press('[data-action=levels]');
  check(sameBoard(before, await state()), 'storage: returning home cannot replace newer session progress with the old disk save');
  await solveByTaps();
  check(await waitWon(5000), 'storage: a puzzle can still be finished while writes fail');
  await press('.won-screen [data-action=home]');
  await press('[data-action=level-select]');
  check(await evaluate('document.querySelectorAll(".level-cell").length === 2 && document.querySelector(".level-cell.cleared .mini").textContent.includes("🏮")'), 'storage: session-only wins still unlock levels and keep the result');
  await evaluate('Storage.prototype.setItem = window.__storageSetItem; delete window.__storageSetItem;');
  await press('[data-action=sound]'); // also retries all pending saves/results/deletions
  check((await state()).persistent && await evaluate('document.querySelector(".storage-warning").hidden'), 'storage: successful retry clears the warning only after pending writes are saved');
  await reload();
  await press('[data-action=level-select]');
  check(await evaluate('document.querySelectorAll(".level-cell").length === 2 && document.querySelector(".level-cell.cleared .mini").textContent.includes("🏮")'), 'storage: recovered results survive reload');
  await press('.level-cell.cleared');
  check((await state()).moves === 0, 'storage: a recovered deletion does not resurrect the unfinished save');

  const blocked = await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });` });
  await reload();
  check(await evaluate('!document.querySelector(".storage-warning").hidden'), 'storage: blocked storage at startup is reported without crashing');
  await press('[data-action=levels]');
  await click(await evaluate('__cl.cell(4)'));
  before = await state();
  await press('.hud [data-action=home]');
  await press('[data-action=levels]');
  check(sameBoard(before, await state()), 'storage: blocked storage still allows session-only resume');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.result.identifier });
  await reload();

  // ---- regression: short/narrow layouts, all controls reachable, orientation unchanged
  const fitsBoard = async (label) => {
    const s = await state(), { cell, ox, oy } = s.view, b = s.bounds;
    check(ox >= b.x - 1 && oy >= b.y - 1 && ox + s.board.w * cell <= b.x + b.width + 1 && oy + s.board.h * cell <= b.y + b.height + 1,
      `${label}: board stays inside its area, clear of the HUD and panel`);
  };
  const reachable = async (selector, label) => {
    const bad = await evaluate(`(async () => {
      const bad = [];
      for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
        if (!el.getClientRects().length) continue;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await new Promise(requestAnimationFrame);
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (r.width < 44 || r.height < 44 || x < 0 || y < 0 || x > innerWidth || y > innerHeight || !el.contains(document.elementFromPoint(x, y))) {
          bad.push({ action: el.dataset.action || el.className, rect: r.toJSON(), hit: document.elementFromPoint(x, y)?.tagName, minHeight: getComputedStyle(el).minHeight });
        }
      }
      return bad;
    })()`);
    check(bad.length === 0, `${label}: all controls reachable with ≥44px targets ${JSON.stringify(bad)}`);
  };
  for (const [label, width, height, dailyCell, largeCell] of [
    ['small-phone', 320, 568, 40, 31], ['small-landscape', 568, 320, 35, 28],
    ['landscape', 844, 390, 44, 35], ['short-desktop', 1280, 600, 52, 41],
  ]) {
    await dimensions(width, height, width < 1000);
    await fresh();
    const homeFits = await evaluate(`(() => {
      const home = document.querySelector('.home-screen'); home.scrollTop = 0;
      const logo = document.querySelector('.logo').getBoundingClientRect();
      document.querySelector('.howto').scrollIntoView({ block: 'nearest' });
      const how = document.querySelector('.howto').getBoundingClientRect();
      return home.scrollWidth <= home.clientWidth + 1 && logo.top >= 0 && logo.left >= 0 && logo.right <= innerWidth && how.bottom <= innerHeight + 1;
    })()`);
    check(homeFits, `${label}: home title/instructions are reachable without horizontal overflow`);
    await reachable('.home-screen button', `${label} home`);
    await shot(`${label}-home`);
    await press('[data-action=daily]');
    await sleep(700);
    check((await state()).view.cell >= dailyCell - 0.1, `${label}: daily cells are at least ${dailyCell}px`);
    await fitsBoard(`${label} play`);
    await reachable('.playbar button, .hud button', `${label} play`);
    await click(await evaluate('__cl.cell(0)'));
    before = await state();
    await dimensions(width > height ? 390 : 844, width > height ? 844 : 390);
    check(sameBoard(before, await state()), `${label}: changing orientation preserves every rotation, lock and move`);
    await dimensions(width, height, width < 1000);
    await shot(`${label}-play`);
    await solveByTaps();
    check(await waitWon(6000), `${label}: solving by real taps still reaches the result`);
    check(await evaluate('document.querySelector(".hud-time").textContent === document.querySelector(".won-time").textContent'), `${label}: the result and HUD display the same rounded finish time`);
    await fitsBoard(`${label} result`);
    await reachable('.won-screen button', `${label} result`);
    check(await evaluate('document.querySelector(".card").scrollWidth <= document.querySelector(".card").clientWidth + 1'), `${label}: result card has no horizontal overflow`);
    await shot(`${label}-won`);
    await press('[data-action=replay-ref]');
    await sleep(700);
    await fitsBoard(`${label} replay`);
    await reachable('.player button, .player input', `${label} replay`);
    check(await evaluate('document.querySelector(".player").scrollWidth <= document.querySelector(".player").clientWidth + 1'), `${label}: replay controls wrap without horizontal overflow`);
    await shot(`${label}-replay`);
    before = await state();
    await mouse('mousePressed', await evaluate('__cl.cell(0)'));
    await mouse('mouseMoved', [width - 2, height / 2]);
    await mouse('mouseReleased', [width - 2, height / 2]);
    check(sameBoard(before, await state()) && (await state()).playback.step === 0, `${label}: dragging across the replay board does not advance a step`);
    await evaluate('document.getElementById("stage").focus()');
    await key('Enter');
    await waitFor('!__cl.state().playback.busy', 3000);
    check((await state()).playback.step === 1, `${label}: Enter on the replay board advances exactly one tile`);
    await evaluate('document.querySelector(".player-seek").focus()');
    await key('ArrowRight');
    check((await state()).playback.step === 2 && !(await state()).playback.busy, `${label}: the focused slider keeps its native arrow-key seeking`);
    await evaluate('document.querySelector("[data-action=pb-prev]").focus()');
    await key('Enter');
    check((await state()).playback.step === 1, `${label}: Enter on Previous goes back, not forwards`);
    await evaluate('document.querySelector("[data-action=pb-toggle]").focus()');
    await key(' ');
    check((await state()).playback.playing, `${label}: Space on Play toggles playback only once`);
    await key(' ');
    await evaluate('document.querySelector(".player-seek").focus()');
    await key('Escape');
    check((await state()).screen === 'won' && await evaluate('parseInt(document.querySelector(".hud-moves").textContent, 10) === Number(document.querySelector(".won-moves").textContent)'), `${label}: Escape from the slider returns to the result with the correct move count`);
    await reload();
    await press('[data-action=daily]');
    check(await evaluate('document.querySelector(".hud-time").textContent === document.querySelector(".won-time").textContent && parseInt(document.querySelector(".hud-moves").textContent, 10) === Number(document.querySelector(".won-moves").textContent)'), `${label}: reopening a solved daily restores the correct HUD stats`);
    await press('.hud [data-action=home]');
    await evaluate(`localStorage.setItem('city-lights:v1:level', '40')`);
    await press('[data-action=levels]');
    await sleep(500);
    check((await state()).view.cell >= largeCell - 0.1, `${label}: largest 9×10 board retains at least ${largeCell}px cells`);
    await fitsBoard(`${label} largest board`);
    check((await state()).moves === 0, `${label}: largest-board fixture starts with no saved moves`);
    await click(await evaluate('__cl.cell(0)'));
    await click(await evaluate('__cl.cell(89)'));
    check((await state()).moves === 2, `${label}: opposite corners of the largest board are clickable`);
    await shot(`${label}-largest`);
    await evaluate(`window.__storageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('quota', 'QuotaExceededError'); };`);
    await press('[data-action=sound]');
    await sleep(700);
    await fitsBoard(`${label} with storage warning`);
    await reachable('.playbar button, .hud button', `${label} with storage warning`);
    check(await evaluate('!document.querySelector(".storage-warning").hidden && document.querySelector(".storage-warning").scrollWidth <= document.querySelector(".storage-warning").clientWidth + 1'), `${label}: the storage warning is visible without horizontal overflow`);
    await shot(`${label}-storage-warning`);
    await evaluate('Storage.prototype.setItem = window.__storageSetItem; delete window.__storageSetItem;');
    await press('[data-action=sound]');
  }
  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
  ws.close();
} finally {
  chrome.kill();
  server?.kill();
}
process.exit(failures.length ? 1 : 0);
