import './styles.css';
import { Sfx } from './audio/sfx';
import { Board, type Flow } from './game/board';
import { period } from './game/grid';
import { dailyNumber, dailyPuzzle, dateKey, formatTime, lanterns, levelPuzzle, levelSize, streak } from './game/modes';
import { Renderer, type Scene } from './render/renderer';
import { store, type Result } from './storage';
import { pickStrings } from './ui/strings';

type Mode = { kind: 'daily'; key: string } | { kind: 'level'; level: number };
type ScreenName = 'home' | 'play' | 'won';

const t = pickStrings(navigator.languages?.length ? navigator.languages : [navigator.language]);
document.documentElement.lang = t.lang;
document.title = t.docTitle;

const app = document.getElementById('app')!;
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const $ = (sel: string) => app.querySelector(sel) as HTMLElement;

const renderer = new Renderer(canvas);
const sfx = new Sfx(store.muted());

let screen: ScreenName = 'home';
let mode: Mode | null = null;
let board: Board | null = null;
let flow: Flow | null = null;
let anim: Float32Array | null = null;
let houses = 0;
let par = 0;
let elapsed = 0;
let timing = false;
let wonAt = -1;
let hover = -1;
let cursor = -1;
let clock = 0;
let resetArmedAt = -Infinity;

// ---- static text --------------------------------------------------------

$('.logo').textContent = t.title;
$('.logo-sub').textContent = t.lang === 'en' ? '万家灯火' : 'CITY LIGHTS';
$('.tagline').textContent = t.tagline;
$('.howto').textContent = t.howto;
$('.hint').textContent = t.hint;
$('.daily-label').textContent = t.daily;
$('.level-label').textContent = t.levels;
$('.won-title').textContent = t.wonTitle;
$('.time-label').textContent = t.timeLabel;
$('.moves-label').textContent = t.movesLabel;
$('.par-label').textContent = t.parLabel;
$('.home-label').textContent = t.home;
$('.hud [data-action="home"]').setAttribute('aria-label', t.aria.home);
$('.hud [data-action="reset"]').setAttribute('aria-label', t.aria.reset);
$('.hud [data-action="sound"]').setAttribute('aria-label', t.aria.sound);
canvas.setAttribute('aria-label', t.aria.board);

// ---- screens -------------------------------------------------------------

function setScreen(s: ScreenName): void {
  screen = s;
  app.dataset.screen = s;
  if (s === 'home') refreshHome();
}

function refreshHome(): void {
  const today = dateKey(new Date());
  const daily = store.daily();
  const done = daily[today];
  $('.daily-sub').textContent = done
    ? t.dailyDone(formatTime(done.time), streak((k) => k in daily, today))
    : t.dailySub(t.date(today), dailyNumber(today));
  const level = store.level();
  const [w, h] = levelSize(level);
  $('.level-sub').textContent = t.levelSub(level, w, h);
}

function saveId(m: Mode): string {
  return m.kind === 'daily' ? `daily:${m.key}` : `level:${m.level}`;
}

function modeTitle(m: Mode): string {
  return m.kind === 'daily' ? t.dailyTitle(dailyNumber(m.key)) : t.levelTitle(m.level);
}

function open(m: Mode): void {
  mode = m;
  const b = new Board(m.kind === 'daily' ? dailyPuzzle(m.key) : levelPuzzle(m.level));
  board = b;
  renderer.clearLanterns();
  par = b.par();
  anim = new Float32Array(b.size);
  houses = [...Array(b.size).keys()].filter((i) => b.isHouse(i)).length;
  wonAt = -1;
  hover = cursor = -1;
  timing = false;
  elapsed = 0;

  const result = m.kind === 'daily' ? store.daily()[m.key] : undefined;
  if (result) {
    // Already solved today: show the lit city and the result again.
    b.rot.fill(0);
    b.moves = result.moves;
    elapsed = result.time;
    par = result.par;
    flow = b.flow();
    wonAt = clock - 10;
    showWon(result);
    return;
  }
  const saved = store.save(saveId(m), b.size);
  if (saved) {
    b.rot.set(saved.rot);
    b.locked.set(saved.locked);
    b.moves = saved.moves;
    elapsed = saved.elapsed;
    timing = saved.moves > 0;
  }
  flow = b.flow();
  setScreen('play');
  updateHud();
}

function goHome(): void {
  persist();
  board = flow = anim = null;
  mode = null;
  setScreen('home');
}

function updateHud(): void {
  if (!mode || !board) return;
  $('.hud-title').textContent = modeTitle(mode);
  $('.hud-time').textContent = formatTime(elapsed);
  $('.hud-moves').textContent = t.moves(board.moves);
}

function persist(): void {
  if (screen !== 'play' || !mode || !board) return;
  store.setSave(saveId(mode), {
    rot: [...board.rot],
    locked: [...board.locked],
    moves: board.moves,
    elapsed: Math.round(elapsed),
  });
}

function showWon(result: Result): void {
  if (!mode || !board) return;
  const { w, h } = board.puzzle;
  const lit = lanterns(result.moves, result.par);
  $('.won-sub').textContent = `${modeTitle(mode)} · ${w}×${h}`;
  $('.won-lanterns').innerHTML = `${'🏮'.repeat(lit)}<span class="off">${'🏮'.repeat(5 - lit)}</span>`;
  $('.won-time').textContent = formatTime(result.time);
  $('.won-moves').textContent = String(result.moves);
  $('.won-par').textContent = String(result.par);
  const primary = $('.won-primary');
  if (mode.kind === 'daily') {
    const daily = store.daily();
    const days = streak((k) => k in daily, dateKey(new Date()));
    $('.won-extra').textContent = days > 1 ? `${t.streak(days)} · ${t.tomorrow}` : t.tomorrow;
    primary.dataset.action = 'share';
    primary.innerHTML = `<b>${t.share}</b>`;
  } else {
    const [nw, nh] = levelSize(mode.level + 1);
    $('.won-extra').textContent = t.nextSize(nw, nh);
    primary.dataset.action = 'next';
    primary.innerHTML = `<b>${t.next}</b>`;
  }
  setScreen('won');
}

// ---- play ----------------------------------------------------------------

function act(i: number, lock: boolean): void {
  if (screen !== 'play' || !board || !flow || !anim || i < 0) return;
  sfx.unlock();
  if (lock) {
    board.toggleLock(i);
    sfx.lock();
    navigator.vibrate?.(10);
    persist();
    return;
  }
  if (!board.rotate(i)) {
    sfx.lock();
    return;
  }
  anim[i] -= Math.PI / 2;
  timing = true;
  const before = flow.housesLit;
  flow = board.flow();
  if (flow.housesLit > before) sfx.light(flow.housesLit);
  else sfx.click();
  updateHud();
  if (flow.solved) win();
  else persist();
}

function win(): void {
  if (!board || !flow || !mode) return;
  const m = mode;
  timing = false;
  wonAt = clock;
  hover = cursor = -1;
  screen = 'won'; // blocks input; the card follows the wave of light
  sfx.win();
  navigator.vibrate?.([12, 50, 12]);
  renderer.celebrate(board, flow);
  const result: Result = { time: Math.round(elapsed), moves: board.moves, par };
  store.setSave(saveId(m), undefined);
  if (m.kind === 'daily') store.setDaily(m.key, result);
  else store.setLevel(Math.max(store.level(), m.level + 1));
  window.setTimeout(() => {
    if (screen === 'won' && mode === m) showWon(result);
  }, 1500);
}

function reset(): void {
  if (screen !== 'play' || !board || !anim) return;
  if (clock - resetArmedAt > 2.5) {
    resetArmedAt = clock;
    toast(t.resetConfirm);
    return;
  }
  resetArmedAt = -Infinity;
  board.rot.set(board.puzzle.start);
  board.locked.fill(0);
  anim.fill(0);
  flow = board.flow();
  sfx.unlock();
  sfx.click();
  persist();
  updateHud();
}

async function share(): Promise<void> {
  if (!mode || mode.kind !== 'daily' || !board) return;
  const r = store.daily()[mode.key];
  if (!r) return;
  const lit = lanterns(r.moves, r.par);
  const { w, h } = board.puzzle;
  const text = `${t.shareText(dailyNumber(mode.key), `${w}×${h}`, '🏮'.repeat(lit) + '▫️'.repeat(5 - lit), formatTime(r.time), r.moves)}\n${location.origin}${location.pathname}`;
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t.copied);
  } catch {
    toast(text);
  }
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('.toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function toggleSound(): void {
  sfx.muted = !sfx.muted;
  store.setMuted(sfx.muted);
  $('.hud [data-action="sound"]').setAttribute('aria-pressed', String(!sfx.muted));
  if (!sfx.muted) {
    sfx.unlock();
    sfx.click();
  }
}
$('.hud [data-action="sound"]').setAttribute('aria-pressed', String(!sfx.muted));

// ---- input ---------------------------------------------------------------

app.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  sfx.unlock();
  switch (btn.dataset.action) {
    case 'daily':
      open({ kind: 'daily', key: dateKey(new Date()) });
      break;
    case 'levels':
      open({ kind: 'level', level: store.level() });
      break;
    case 'next':
      if (mode?.kind === 'level') open({ kind: 'level', level: mode.level + 1 });
      break;
    case 'share':
      void share();
      break;
    case 'home':
      goHome();
      break;
    case 'reset':
      reset();
      break;
    case 'sound':
      toggleSound();
      break;
  }
  btn.blur();
});

interface Press {
  id: number;
  i: number;
  x: number;
  y: number;
  timer: number;
  fired: boolean;
}
let press: Press | null = null;

function cancelPress(): void {
  if (press) window.clearTimeout(press.timer);
  press = null;
}

canvas.addEventListener('pointerdown', (e) => {
  if (screen !== 'play' || !board) return;
  const i = renderer.hit(board, e.clientX, e.clientY);
  if (i < 0) return;
  cursor = -1;
  if (e.button === 2) {
    act(i, true);
    return;
  }
  if (e.button !== 0) return;
  cancelPress();
  const p: Press = { id: e.pointerId, i, x: e.clientX, y: e.clientY, timer: 0, fired: false };
  p.timer = window.setTimeout(() => {
    p.fired = true;
    act(p.i, true);
  }, 430);
  press = p;
});

canvas.addEventListener('pointermove', (e) => {
  if (board && e.pointerType === 'mouse') hover = renderer.hit(board, e.clientX, e.clientY);
  if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 14) cancelPress();
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || press.id !== e.pointerId) return;
  const p = press;
  cancelPress();
  if (!p.fired && board && renderer.hit(board, e.clientX, e.clientY) === p.i) act(p.i, false);
});

canvas.addEventListener('pointercancel', cancelPress);
canvas.addEventListener('pointerleave', () => {
  hover = -1;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    toggleSound();
    return;
  }
  if (e.key === 'Escape' && screen !== 'home') {
    goHome();
    return;
  }
  if (screen !== 'play' || !board) return;
  const { w, h, source } = board.puzzle;
  const step: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const s = step[e.key];
  if (s) {
    e.preventDefault();
    if (cursor < 0) cursor = source;
    else {
      const x = Math.min(w - 1, Math.max(0, (cursor % w) + s[0]));
      const y = Math.min(h - 1, Math.max(0, Math.floor(cursor / w) + s[1]));
      cursor = y * w + x;
    }
    return;
  }
  if (cursor < 0) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    act(cursor, false);
  } else if (e.key === 'l' || e.key === 'L' || e.key === 'x' || e.key === 'X') {
    act(cursor, true);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});
window.addEventListener('pagehide', persist);

// ---- loop ----------------------------------------------------------------

const hud = $('.hud');
const card = $('.card');
const scene: Scene = {
  board: null, flow: null, anim: null, hover: -1, cursor: -1, wonAt: -1,
  insetTop: 0, insetBottom: 0, skyline: 0.35, ambient: true,
};

window.addEventListener('resize', () => renderer.resize());
renderer.resize();

let last = performance.now();
let shownSecond = -1;
function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  if (screen === 'play' && timing) {
    elapsed += dt * 1000;
    const sec = Math.floor(elapsed / 1000);
    if (sec !== shownSecond) {
      shownSecond = sec;
      $('.hud-time').textContent = formatTime(elapsed);
    }
  }
  scene.board = board;
  scene.flow = flow;
  scene.anim = anim;
  scene.hover = hover;
  scene.cursor = cursor;
  scene.wonAt = wonAt;
  scene.ambient = screen === 'home';
  scene.skyline = !board ? 0.35 : wonAt >= 0 ? 1 : 0.06 + 0.5 * ((flow?.housesLit ?? 0) / Math.max(1, houses));
  scene.insetTop = hud.getBoundingClientRect().bottom;
  scene.insetBottom = app.dataset.screen === 'won' ? window.innerHeight - card.getBoundingClientRect().top + 4 : 40;
  renderer.frame(scene, clock, dt);
  requestAnimationFrame(loop);
}
setScreen('home');
requestAnimationFrame(loop);

// ---- headless verification hook (?debug) ---------------------------------

if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, {
    __cl: {
      state: () => ({ screen, dom: app.dataset.screen, moves: board?.moves, locked: board?.locked.reduce((a, b) => a + b, 0), solved: flow?.solved, housesLit: flow?.housesLit, houses, par, elapsed }),
      /** Screen position and tap count for every tile that is off the generated solution. */
      plan(): [number, number, number][] {
        if (!board) return [];
        const b = board;
        return [...b.rot].flatMap((r, i) => {
          const p = period(b.puzzle.base[i]);
          const taps = (p - (r % p)) % p;
          return taps ? [[...renderer.cellCenter(b, i), taps] as [number, number, number]] : [];
        });
      },
      /** Solves everything except one tile that is a single tap away; returns that tile's screen position. */
      nearlySolve(): [number, number] | null {
        if (!board) return null;
        board.locked.fill(0);
        board.rot.fill(0);
        const k = board.puzzle.base.findIndex((m) => period(m) === 4);
        board.rot[k] = 3;
        flow = board.flow();
        return renderer.cellCenter(board, k);
      },
    },
  });
}
