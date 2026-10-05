import './styles.css';
import { Sfx } from './audio/sfx';
import { Board, type Action, type Flow, type Origin } from './game/board';
import type { Puzzle } from './game/generate';
import { period } from './game/grid';
import { DAILY_SIZE, dailyNumber, dailyPuzzle, dateKey, formatTime, levelPuzzle, levelSize, rating, streak } from './game/modes';
import { Playback, boardAfter, decodeLog, encodeLog, referenceActions } from './game/replay';
import { Renderer, type Scene } from './render/renderer';
import { store, type Result } from './storage';
import { pickStrings } from './ui/strings';

type Mode = { kind: 'daily'; key: string } | { kind: 'level'; level: number };
type ScreenName = 'home' | 'levels' | 'play' | 'won' | 'replay';

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
/** The puzzle being played, or just solved. */
let game: Board | null = null;
/** What is on screen: the game, or a playback's board. */
let shown: Board | null = null;
let flow: Flow | null = null;
let anim: Float32Array | null = null;
let result: Result | null = null;
/** The solve that can be replayed, and where it starts. */
let myLog: Action[] | null = null;
let myOrigin: Origin | undefined;
let playback: Playback | null = null;
let playbackKind: 'mine' | 'ref' = 'mine';
let houses = 0;
let par = 0;
let elapsed = 0;
let timing = false;
let wonAt = -1;
let hover = -1;
let cursor = -1;
let clock = 0;
let focus = -1;
let focusAt = -9;
let focusKind = 0;
let resetArmedAt = -Infinity;
let hintArmedAt = -Infinity;
let hintConfirmed = false;
let lockedToastShown = false;

// ---- static text --------------------------------------------------------

const text: [string, string][] = [
  ['.logo', t.title], ['.logo-sub', t.lang === 'en' ? '万家灯火' : 'CITY LIGHTS'], ['.tagline', t.tagline],
  ['.howto', t.howto], ['.hint', t.hint], ['.daily-label', t.daily], ['.level-label', t.levels],
  ['[data-action="level-select"]', t.allLevels], ['.levels-title', t.levelsTitle],
  ['.won-title', t.wonTitle], ['.time-label', t.timeLabel], ['.moves-label', t.movesLabel], ['.par-label', t.parLabel],
  ['.home-label', t.home], ['.undo-label', t.undo], ['.hint-label', t.hintBtn], ['.reset-label', t.reset],
  ['.replay-mine-label', t.replayMine], ['.replay-ref-label', t.replayRef], ['.close-label', t.close],
];
for (const [sel, s] of text) $(sel).textContent = s;
const aria: [string, string][] = [
  ['.hud [data-action="home"]', t.aria.home], ['.levels-head [data-action="home"]', t.aria.home],
  ['.hud [data-action="sound"]', t.aria.sound], ['[data-action="pb-restart"]', t.aria.restart],
  ['[data-action="pb-toggle"]', t.aria.toggle], ['[data-action="pb-speed"]', t.aria.speed], ['.player-seek', t.aria.seek],
];
for (const [sel, s] of aria) $(sel).setAttribute('aria-label', s);
canvas.setAttribute('aria-label', t.aria.board);

const lanternsHtml = (lit: number) => `${'🏮'.repeat(lit)}<span class="off">${'🏮'.repeat(5 - lit)}</span>`;

// ---- screens -------------------------------------------------------------

function setScreen(s: ScreenName): void {
  screen = s;
  app.dataset.screen = s;
  if (s === 'home') refreshHome();
}

function puzzleFor(m: Mode): Puzzle {
  return m.kind === 'daily' ? dailyPuzzle(m.key) : levelPuzzle(m.level);
}

function saveId(m: Mode): string {
  return m.kind === 'daily' ? `daily:${m.key}` : `level:${m.level}`;
}

function modeTitle(m: Mode): string {
  return m.kind === 'daily' ? t.dailyTitle(dailyNumber(m.key)) : t.levelTitle(m.level);
}

function refreshHome(): void {
  const today = dateKey(new Date());
  const daily = store.daily();
  const done = daily[today];
  const saved = done ? null : store.save(`daily:${today}`, DAILY_SIZE[0] * DAILY_SIZE[1]);
  $('.daily-sub').textContent = done
    ? t.dailyDone(formatTime(done.time), streak((k) => k in daily, today))
    : saved && saved.elapsed > 0 ? t.dailyResume(formatTime(saved.elapsed)) : t.dailySub(t.date(today), dailyNumber(today));
  const level = store.level();
  const [w, h] = levelSize(level);
  $('.level-sub').textContent = t.levelSub(level, w, h);
}

function openLevels(): void {
  const unlocked = store.level();
  const results = store.levels();
  $('.levels-count').textContent = t.levelsCount(unlocked - 1);
  $('.level-grid').innerHTML = Array.from({ length: unlocked }, (_, k) => {
    const n = k + 1;
    const [w, h] = levelSize(n);
    const r = results[n];
    const mini = r ? lanternsHtml(rating(r)) : n < unlocked ? '✓' : '';
    return `<button type="button" class="level-cell${n < unlocked ? ' cleared' : ' current'}" data-action="open-level" data-level="${n}"><b>${n}</b><small>${w}×${h}</small><span class="mini">${mini}</span></button>`;
  }).join('');
  setScreen('levels');
  $('.level-cell.current')?.scrollIntoView({ block: 'center' });
}

/** Puts a board on screen with fresh animation state. */
function show(b: Board): void {
  shown = b;
  anim = new Float32Array(b.size);
  flow = b.flow();
}

function open(m: Mode): void {
  const p = puzzleFor(m);
  const fresh = new Board(p);
  mode = m;
  playback = null;
  par = fresh.par();
  houses = [...Array(fresh.size).keys()].filter((i) => fresh.isHouse(i)).length;
  wonAt = -1;
  hover = cursor = focus = -1;
  timing = false;
  elapsed = 0;
  hintArmedAt = resetArmedAt = -Infinity;
  renderer.clearLanterns();

  const done = m.kind === 'daily' ? store.daily()[m.key] : undefined;
  if (done) {
    // Already solved today: show the city as it was solved, and the result.
    const log = done.log ? decodeLog(done.log, fresh.size) : null;
    // A log that no longer solves this puzzle (e.g. the generator changed) is not shown as a replay.
    const replayed = log ? boardAfter(p, log) : null;
    const solved = replayed?.flow().solved ? replayed : null;
    myLog = solved ? log : null;
    myOrigin = undefined;
    // Results from before replays existed carry no log: show the reference solution instead.
    game = solved ?? new Board(p, { rot: new Uint8Array(fresh.size), locked: new Uint8Array(fresh.size), moves: done.moves });
    result = done;
    elapsed = done.time;
    par = done.par;
    show(game);
    wonAt = clock - 10;
    showWon();
    return;
  }

  let b = fresh;
  const saved = store.save(saveId(m), fresh.size);
  if (saved) {
    const log = decodeLog(saved.log, fresh.size);
    const restored = log && boardAfter(p, log, saved.origin);
    if (restored) {
      b = restored;
      b.hints = saved.hints;
      elapsed = saved.elapsed;
      timing = b.moves > 0;
    }
  }
  game = b;
  hintConfirmed = b.hints > 0;
  show(b);
  setScreen('play');
  updateHud();
}

function goHome(): void {
  persist();
  game = shown = flow = anim = null;
  playback = null;
  mode = null;
  setScreen('home');
}

function updateHud(): void {
  if (!mode || !shown) return;
  $('.hud-title').textContent = modeTitle(mode);
  $('.hud-time').textContent = formatTime(elapsed);
  $('.hud-moves').textContent = t.moves(shown.moves);
  if (game && screen === 'play') {
    $('[data-action="undo"]').setAttribute('aria-disabled', String(game.log.length === 0));
    const badge = $('.badge');
    badge.hidden = game.hints === 0;
    badge.textContent = String(game.hints);
  }
}

function persist(): void {
  if (screen !== 'play' || !mode || !game) return;
  // The origin is the scrambled start unless this board came from a save that had no log.
  const o = game.origin;
  store.setSave(saveId(mode), {
    log: encodeLog(game.log),
    elapsed: Math.round(elapsed),
    hints: game.hints,
    ...(o.rot === game.puzzle.start ? {} : { origin: { rot: Array.from(o.rot), locked: Array.from(o.locked), moves: o.moves } }),
  });
}

function showWon(): void {
  if (!mode || !game || !result) return;
  const { w, h } = game.puzzle;
  const hints = result.hints ?? 0;
  $('.won-sub').textContent = `${modeTitle(mode)} · ${w}×${h}`;
  $('.won-lanterns').innerHTML = lanternsHtml(rating(result));
  $('.won-time').textContent = formatTime(result.time);
  $('.won-moves').textContent = String(result.moves);
  $('.won-par').textContent = String(result.par);
  const extra: string[] = [];
  const primary = $('.won-primary');
  if (mode.kind === 'daily') {
    const daily = store.daily();
    const days = streak((k) => k in daily, dateKey(new Date()));
    if (days > 1) extra.push(t.streak(days));
    extra.push(t.tomorrow);
    primary.dataset.action = 'share';
    primary.innerHTML = `<b>${t.share}</b>`;
  } else {
    const [nw, nh] = levelSize(mode.level + 1);
    extra.push(t.nextSize(nw, nh));
    primary.dataset.action = 'next';
    primary.innerHTML = `<b>${t.next}</b>`;
  }
  if (hints) extra.unshift(t.hintsUsed(hints));
  $('.won-extra').textContent = extra.join(' · ');
  $('[data-action="replay-mine"]').hidden = !myLog?.length;
  setScreen('won');
}

// ---- play ----------------------------------------------------------------

function setFocus(i: number, kind: number): void {
  focus = i;
  focusAt = clock;
  focusKind = kind;
}

/** Recomputes power after a change, with a bell when more homes light up. */
function refresh(sound: 'turn' | 'quiet'): void {
  if (!shown) return;
  const before = flow?.housesLit ?? 0;
  flow = shown.flow();
  if (sound === 'turn') {
    if (flow.housesLit > before) sfx.light(flow.housesLit);
    else sfx.click();
  }
}

/** After any change to the game: HUD, win check, autosave. */
function changed(): void {
  updateHud();
  if (flow?.solved) win();
  else persist();
}

function act(i: number, lock: boolean): void {
  if (screen !== 'play' || !game || !anim || i < 0) return;
  sfx.unlock();
  if (lock) {
    game.toggleLock(i, elapsed);
    sfx.lock();
    navigator.vibrate?.(10);
    changed();
    return;
  }
  if (!game.rotate(i, elapsed)) {
    sfx.lock();
    setFocus(i, 2);
    if (!lockedToastShown) {
      lockedToastShown = true;
      toast(t.lockedTap);
    }
    return;
  }
  anim[i] -= Math.PI / 2;
  timing = true;
  refresh('turn');
  changed();
}

function undo(): void {
  if (screen !== 'play' || !game || !anim) return;
  sfx.unlock();
  const undone = game.undo();
  if (!undone.length) {
    toast(t.noUndo);
    return;
  }
  for (const a of undone) if (!a.lock) anim[a.i] += Math.PI / 2;
  setFocus(undone[0].i, undone[0].hint ? 1 : 0);
  sfx.undo();
  refresh('quiet');
  changed();
}

function hint(): void {
  if (screen !== 'play' || !game || !anim) return;
  sfx.unlock();
  if (!hintConfirmed) {
    if (clock - hintArmedAt > 3) {
      hintArmedAt = clock;
      toast(t.hintConfirm);
      return;
    }
    hintConfirmed = true;
    hideToast();
  }
  const taken = game.hint(elapsed);
  if (!taken) return;
  for (const a of taken) if (!a.lock) anim[a.i] -= Math.PI / 2;
  setFocus(taken[0].i, 1);
  timing = true;
  sfx.hint();
  refresh('quiet');
  changed();
}

function reset(): void {
  if (screen !== 'play' || !game || !anim) return;
  if (clock - resetArmedAt > 2.5) {
    resetArmedAt = clock;
    toast(t.resetConfirm);
    return;
  }
  resetArmedAt = -Infinity;
  hideToast();
  game.reset();
  anim.fill(0);
  sfx.unlock();
  sfx.undo();
  refresh('quiet');
  changed();
}

function win(): void {
  if (!game || !flow || !mode) return;
  const m = mode;
  timing = false;
  wonAt = clock;
  hover = cursor = -1;
  screen = 'won'; // blocks input; the card follows the wave of light
  sfx.win();
  navigator.vibrate?.([12, 50, 12]);
  renderer.celebrate(game, flow);
  const fromStart = game.origin.rot === game.puzzle.start;
  myLog = game.log.slice();
  myOrigin = fromStart ? undefined : game.origin;
  result = { time: Math.round(elapsed), moves: game.moves, par, hints: game.hints, ...(fromStart ? { log: encodeLog(game.log) } : {}) };
  store.setSave(saveId(m), undefined);
  if (m.kind === 'daily') store.setDaily(m.key, result);
  else {
    store.setLevel(Math.max(store.level(), m.level + 1));
    store.setLevelResult(m.level, result);
  }
  window.setTimeout(() => {
    if (screen === 'won' && mode === m && !playback) showWon();
  }, 1500);
}

async function share(): Promise<void> {
  if (!mode || mode.kind !== 'daily' || !game) return;
  const r = store.daily()[mode.key];
  if (!r) return;
  const lit = rating(r);
  const { w, h } = game.puzzle;
  const msg = `${t.shareText(dailyNumber(mode.key), `${w}×${h}`, '🏮'.repeat(lit) + '▫️'.repeat(5 - lit), formatTime(r.time), r.moves, r.hints ?? 0)}\n${location.origin}${location.pathname}`;
  if (navigator.share) {
    try {
      await navigator.share({ text: msg });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(msg);
    toast(t.copied);
  } catch {
    toast(msg);
  }
}

// ---- playback --------------------------------------------------------------

const SPEEDS = [1, 2, 4];

function startPlayback(kind: 'mine' | 'ref'): void {
  if (!game) return;
  const p = game.puzzle;
  if (kind === 'mine' && !myLog?.length) return;
  playback = kind === 'mine' ? new Playback(p, myLog!, 'real', myOrigin) : new Playback(p, referenceActions(p), 'even');
  playbackKind = kind;
  playback.playing = true;
  renderer.clearLanterns();
  wonAt = -1;
  focus = -1;
  show(playback.board);
  setScreen('replay');
  updatePlayer();
}

function closePlayback(): void {
  if (!game) return;
  playback = null;
  show(game);
  wonAt = clock - 10;
  focus = -1;
  setScreen('won');
}

function seekPlayback(k: number, play: boolean): void {
  if (!playback) return;
  playback.seek(k);
  playback.playing = play;
  renderer.clearLanterns();
  show(playback.board);
  wonAt = playback.done ? clock - 10 : -1;
  focus = -1;
  updatePlayer();
}

function updatePlayer(): void {
  if (!playback) return;
  const n = playback.actions.length;
  $('.player-title').textContent = playbackKind === 'mine' ? t.playerMine : t.playerRef;
  $('.player-step').textContent = `${playback.k} / ${n}`;
  const seek = $('.player-seek') as HTMLInputElement;
  seek.max = String(n);
  seek.value = String(playback.k);
  $('[data-action="pb-toggle"]').setAttribute('aria-pressed', String(playback.playing));
  $('[data-action="pb-speed"]').textContent = `${playback.speed}×`;
  updateHud();
}

function stepPlayback(dtMs: number): void {
  if (!playback || !anim) return;
  const wasPlaying = playback.playing;
  const applied = playback.tick(dtMs);
  if (!applied.length) {
    if (wasPlaying !== playback.playing) updatePlayer(); // reached the end
    return;
  }
  for (const a of applied) if (!a.lock) anim[a.i] -= Math.PI / 2;
  const last = applied[applied.length - 1];
  setFocus(last.i, last.hint ? 1 : 0);
  if (applied.every((a) => a.lock)) {
    sfx.lock();
    refresh('quiet');
  } else refresh('turn');
  if (playback.done && flow?.solved) {
    wonAt = clock;
    sfx.win();
    renderer.celebrate(playback.board, flow);
  }
  updatePlayer();
}

// ---- misc ------------------------------------------------------------------

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('.toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 2200);
}

function hideToast(): void {
  window.clearTimeout(toastTimer);
  $('.toast').classList.remove('show');
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
    case 'level-select':
      openLevels();
      break;
    case 'open-level':
      open({ kind: 'level', level: Number(btn.dataset.level) });
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
    case 'undo':
      undo();
      break;
    case 'hint':
      hint();
      break;
    case 'reset':
      reset();
      break;
    case 'sound':
      toggleSound();
      break;
    case 'replay-mine':
      startPlayback('mine');
      break;
    case 'replay-ref':
      startPlayback('ref');
      break;
    case 'pb-restart':
      seekPlayback(0, true);
      break;
    case 'pb-toggle':
      if (!playback) break;
      if (playback.done) seekPlayback(0, true);
      else {
        playback.playing = !playback.playing;
        updatePlayer();
      }
      break;
    case 'pb-speed':
      if (!playback) break;
      playback.speed = SPEEDS[(SPEEDS.indexOf(playback.speed) + 1) % SPEEDS.length];
      updatePlayer();
      break;
    case 'pb-close':
      closePlayback();
      break;
  }
  btn.blur();
});

$('.player-seek').addEventListener('input', (e) => seekPlayback(Number((e.target as HTMLInputElement).value), false));

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
  if (screen !== 'play' || !game) return;
  const i = renderer.hit(game, e.clientX, e.clientY);
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
  if (game && screen === 'play' && e.pointerType === 'mouse') hover = renderer.hit(game, e.clientX, e.clientY);
  if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 14) cancelPress();
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || press.id !== e.pointerId) return;
  const p = press;
  cancelPress();
  if (!p.fired && game && renderer.hit(game, e.clientX, e.clientY) === p.i) act(p.i, false);
});

canvas.addEventListener('pointercancel', cancelPress);
canvas.addEventListener('pointerleave', () => {
  hover = -1;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest?.('input')) return;
  const key = e.key.toLowerCase();
  if (key === 'm') {
    toggleSound();
    return;
  }
  if (screen === 'replay' && playback) {
    if (key === ' ') {
      e.preventDefault();
      $('[data-action="pb-toggle"]').click();
    } else if (key === 'arrowleft' || key === 'arrowright') {
      e.preventDefault();
      seekPlayback(playback.k + (key === 'arrowleft' ? -1 : 1), false);
    } else if (key === 'escape') closePlayback();
    return;
  }
  if (key === 'escape' && screen !== 'home') {
    goHome();
    return;
  }
  if (screen !== 'play' || !game) return;
  if (key === 'z' || key === 'backspace') {
    e.preventDefault();
    undo();
    return;
  }
  if (key === 'h') {
    hint();
    return;
  }
  const { w, h, source } = game.puzzle;
  const step: Record<string, [number, number]> = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
  const s = step[key];
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
  if (key === ' ' || key === 'enter') {
    e.preventDefault();
    act(cursor, false);
  } else if (key === 'l' || key === 'x') {
    act(cursor, true);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});
window.addEventListener('pagehide', persist);

// ---- loop ----------------------------------------------------------------

const hud = $('.hud');
const bottomUi: Partial<Record<ScreenName, HTMLElement>> = { play: $('.playbar'), won: $('.card'), replay: $('.player') };
const scene: Scene = {
  board: null, flow: null, anim: null, hover: -1, cursor: -1, wonAt: -1,
  insetTop: 0, insetBottom: 0, skyline: 0.35, ambient: true,
  focus: -1, focusAt: -9, focusKind: 0, hintLocked: new Set(),
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
  if (screen === 'replay') stepPlayback(dt * 1000);
  scene.board = shown;
  scene.flow = flow;
  scene.anim = anim;
  scene.hover = hover;
  scene.cursor = cursor;
  scene.wonAt = wonAt;
  scene.focus = focus;
  scene.focusAt = focusAt;
  scene.focusKind = focusKind;
  scene.hintLocked = shown ? shown.hintLocked() : scene.hintLocked;
  scene.ambient = screen === 'home' || screen === 'levels';
  scene.skyline = !shown ? 0.35 : wonAt >= 0 ? 1 : 0.06 + 0.5 * ((flow?.housesLit ?? 0) / Math.max(1, houses));
  scene.insetTop = hud.getBoundingClientRect().bottom;
  const bottom = bottomUi[app.dataset.screen as ScreenName];
  scene.insetBottom = bottom ? window.innerHeight - bottom.getBoundingClientRect().top + 4 : 40;
  renderer.frame(scene, clock, dt);
  requestAnimationFrame(loop);
}
setScreen('home');
requestAnimationFrame(loop);

// ---- headless verification hook (?debug) ---------------------------------

if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, {
    __cl: {
      state: () => ({
        screen, dom: app.dataset.screen, moves: shown?.moves, locked: shown?.locked.reduce((a, b) => a + b, 0),
        solved: flow?.solved, housesLit: flow?.housesLit, houses, par, elapsed, hints: game?.hints, log: game?.log.length,
        playback: playback && { k: playback.k, n: playback.actions.length, playing: playback.playing, done: playback.done, speed: playback.speed },
      }),
      /** Screen position and tap count for every tile that is off the generated solution. */
      plan(): [number, number, number][] {
        if (!game) return [];
        const b = game;
        return [...b.rot].flatMap((r, i) => {
          const per = period(b.puzzle.base[i]);
          const taps = (per - (r % per)) % per;
          return taps ? [[...renderer.cellCenter(b, i), taps] as [number, number, number]] : [];
        });
      },
      /** Screen position of a cell. */
      cell: (i: number) => (game ? renderer.cellCenter(game, i) : null),
    },
  });
}
