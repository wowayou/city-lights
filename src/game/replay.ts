import { Board, treeOrder, type Action, type Origin } from './board';
import { period } from './grid';
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
 * Steps a log forward in (scaled) time. 'real' keeps the player's rhythm with
 * long pauses squeezed; 'even' is a steady demo pace.
 */
export class Playback {
  board: Board;
  k = 0;
  playing = false;
  speed = 1;
  private wait = 0;

  constructor(
    readonly puzzle: Puzzle,
    readonly actions: readonly Action[],
    readonly pace: 'real' | 'even',
    readonly origin?: Origin,
  ) {
    this.board = new Board(puzzle, origin);
    this.wait = 500;
  }

  get done(): boolean {
    return this.k >= this.actions.length;
  }

  seek(k: number): void {
    this.k = Math.max(0, Math.min(this.actions.length, Math.round(k)));
    this.board = new Board(this.puzzle, this.origin);
    for (let j = 0; j < this.k; j++) this.board.apply(this.actions[j]);
    this.wait = 300;
  }

  /** Gap in ms before action k plays. */
  private gap(k: number): number {
    const a = this.actions[k], prev = this.actions[k - 1];
    if (!prev) return 300;
    if (this.pace === 'even') return a.i === prev.i ? 150 : 240;
    return Math.min(900, Math.max(a.hint && prev.hint ? 60 : 110, a.t - prev.t));
  }

  /** Advances by dtMs of wall time; returns the actions applied. */
  tick(dtMs: number): Action[] {
    const applied: Action[] = [];
    if (!this.playing) return applied;
    this.wait -= dtMs * this.speed;
    while (this.wait <= 0) {
      if (this.done) {
        this.playing = false;
        break;
      }
      const a = this.actions[this.k++];
      this.board.apply(a);
      applied.push(a);
      if (!this.done) this.wait += this.gap(this.k);
    }
    return applied;
  }
}
