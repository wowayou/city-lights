import { Board, treeOrder, type Action, type Origin } from './board';
import { period, rotateCW } from './grid';
import type { Puzzle } from './generate';

/** The generated solution as taps, station outwards, so the light spreads as it plays. */
export function referenceActions(p: Puzzle): Action[] {
  const out: Action[] = [];
  for (const i of treeOrder(p)) {
    const per = period(p.base[i]);
    for (let k = (per - (p.start[i] % per)) % per; k > 0; k--) out.push({ i, lock: false, hint: false, t: 0 });
  }
  return out;
}

/** Flat [code, Δms, code, Δms, …] with code = cell·4 + lock + hint·2 — compact for localStorage. */
export function encodeLog(log: readonly Action[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const a of log) {
    const t = Math.max(prev, Math.round(a.t));
    out.push(a.i * 4 + (a.lock ? 1 : 0) + (a.hint ? 2 : 0), t - prev);
    prev = t;
  }
  return out;
}

export function decodeLog(data: unknown, size: number): Action[] | null {
  if (!Array.isArray(data) || data.length % 2) return null;
  const out: Action[] = [];
  let t = 0;
  for (let k = 0; k < data.length; k += 2) {
    const code = data[k], dt = data[k + 1];
    if (!Number.isInteger(code) || !Number.isInteger(dt) || code < 0 || dt < 0 || code >> 2 >= size) return null;
    t += dt;
    out.push({ i: code >> 2, lock: (code & 1) === 1, hint: (code & 2) === 2, t });
  }
  return out;
}

/** Rebuilds the board a log leads to, or null if the log does not fit (e.g. turns a locked tile). */
export function boardAfter(p: Puzzle, actions: readonly Action[], origin?: Origin): Board | null {
  const b = new Board(p, origin);
  for (const a of actions) if (!b.apply(a)) return null;
  return b;
}

/**
 * Plays a log back in steps. A step is a run of actions on one tile (all the
 * turns that put it in place) — the same unit a hint uses. It can auto-play
 * ('real' keeps the player's rhythm with long pauses squeezed, 'even' is a
 * steady demo pace) or advance one step at a time.
 */
export class Playback {
  board: Board;
  k = 0;
  /** Auto-playing through every step. */
  playing = false;
  speed = 1;
  /** Start index of each step in `actions`. */
  readonly starts: number[] = [];
  /** While stepping: the action index to pause at, or -1. */
  private stopAt = -1;
  private wait = 0;

  constructor(
    readonly puzzle: Puzzle,
    readonly actions: readonly Action[],
    readonly pace: 'real' | 'even',
    readonly origin?: Origin,
  ) {
    this.board = new Board(puzzle, origin);
    actions.forEach((a, j) => {
      if (j === 0 || actions[j - 1].i !== a.i) this.starts.push(j);
    });
  }

  get done(): boolean {
    return this.k >= this.actions.length;
  }

  /** Animating, either auto-play or a single step. */
  get busy(): boolean {
    return this.playing || this.stopAt >= 0;
  }

  get steps(): number {
    return this.starts.length;
  }

  private stepEnd(s: number): number {
    return s + 1 < this.starts.length ? this.starts[s + 1] : this.actions.length;
  }

  /** Steps fully played. */
  get step(): number {
    let s = 0;
    while (s < this.steps && this.stepEnd(s) <= this.k) s++;
    return s;
  }

  seek(k: number): void {
    this.k = Math.max(0, Math.min(this.actions.length, Math.round(k)));
    this.board = new Board(this.puzzle, this.origin);
    for (let j = 0; j < this.k; j++) this.board.apply(this.actions[j]);
    this.playing = false;
    this.stopAt = -1;
  }

  seekStep(s: number): void {
    this.seek(s >= this.steps ? this.actions.length : this.starts[Math.max(0, s)]);
  }

  play(): void {
    if (this.done) return;
    this.playing = true;
    this.stopAt = -1;
    this.wait = 350;
  }

  pause(): void {
    this.playing = false;
    this.stopAt = -1;
  }

  /** Plays the rest of the current step (one tile), then pauses. */
  next(): void {
    if (this.done) return;
    this.playing = false;
    this.stopAt = this.stepEnd(this.step);
    this.wait = 0;
  }

  /** Back to the start of the current step if it is half played, otherwise of the previous one. */
  prev(): void {
    const s = this.step;
    this.seekStep(s < this.steps && this.k > this.starts[s] ? s : s - 1);
  }

  /** While paused: the tile the next step turns, and the wire shape it will end with. */
  preview(): { i: number; mask: number } | null {
    if (this.done || this.busy) return null;
    const s = this.step;
    const from = Math.max(this.k, this.starts[s]);
    const i = this.actions[from].i;
    let turns = 0;
    for (let j = from; j < this.stepEnd(s); j++) if (!this.actions[j].lock) turns++;
    return { i, mask: rotateCW(this.puzzle.base[i], this.board.rot[i] + turns) };
  }

  /** Gap in ms before action k plays. */
  private gap(k: number): number {
    const a = this.actions[k], prev = this.actions[k - 1];
    const same = a.i === prev.i;
    if (this.stopAt >= 0) return 220;
    if (this.pace === 'even') return same ? 260 : 900;
    return Math.min(900, Math.max(same ? 110 : 160, a.t - prev.t));
  }

  /** Advances by dtMs of wall time; returns the actions applied. */
  tick(dtMs: number): Action[] {
    const applied: Action[] = [];
    if (!this.busy) return applied;
    this.wait -= dtMs * this.speed;
    while (this.wait <= 0) {
      if (this.done || (this.stopAt >= 0 && this.k >= this.stopAt)) {
        this.pause();
        break;
      }
      const a = this.actions[this.k++];
      this.board.apply(a);
      applied.push(a);
      if (!this.done && this.k !== this.stopAt) this.wait += this.gap(this.k);
    }
    return applied;
  }
}
