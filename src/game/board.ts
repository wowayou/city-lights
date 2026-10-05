import { DIRS, degree, neighbor, opposite, period, rotateCW } from './grid';
import type { Puzzle } from './generate';

export interface Flow {
  /** BFS distance from the source along matched wires; -1 = unpowered. */
  dist: Int16Array;
  /** Per cell, the connectors that point at nothing (off-board or an unmatched neighbour). */
  loose: Uint8Array;
  powered: number;
  housesLit: number;
  solved: boolean;
}

/** One player (or hint) input, with the play-clock time it happened at. */
export interface Action {
  i: number;
  lock: boolean;
  hint: boolean;
  t: number;
}

/** Where a log starts: the scrambled start, or an older save that carried no log. */
export interface Origin {
  rot: ArrayLike<number>;
  locked: ArrayLike<number>;
  moves: number;
}

export class Board {
  readonly rot: Uint8Array;
  readonly locked: Uint8Array;
  origin: Origin;
  /** Every input since the origin, so a solve can be undone and replayed. */
  log: Action[] = [];
  /** Rotations since the origin (hint turns included); undo takes them back. */
  moves = 0;
  /** Hints used on this board; undo does not refund them. */
  hints = 0;

  constructor(readonly puzzle: Puzzle, origin?: Origin) {
    this.origin = origin ?? { rot: puzzle.start, locked: new Uint8Array(puzzle.base.length), moves: 0 };
    this.rot = Uint8Array.from(this.origin.rot);
    this.locked = Uint8Array.from(this.origin.locked);
    this.moves = this.origin.moves;
  }

  get size(): number {
    return this.puzzle.base.length;
  }

  mask(i: number): number {
    return rotateCW(this.puzzle.base[i], this.rot[i]);
  }

  isHouse(i: number): boolean {
    return i !== this.puzzle.source && degree(this.puzzle.base[i]) === 1;
  }

  /** Quarter turn clockwise. Returns false (and logs nothing) for a locked tile. */
  rotate(i: number, t = 0, hint = false): boolean {
    if (this.locked[i]) return false;
    this.rot[i] = (this.rot[i] + 1) & 3;
    this.moves++;
    this.log.push({ i, lock: false, hint, t });
    return true;
  }

  toggleLock(i: number, t = 0, hint = false): void {
    this.locked[i] ^= 1;
    this.log.push({ i, lock: true, hint, t });
  }

  /** Re-applies a logged action (replays). */
  apply(a: Action): boolean {
    if (!a.lock) return this.rotate(a.i, a.t, a.hint);
    this.toggleLock(a.i, a.t, a.hint);
    return true;
  }

  /** Takes back the last input — a whole hint at once. Returns what was undone, newest first. */
  undo(): Action[] {
    const undone: Action[] = [];
    const last = this.log.at(-1);
    while (this.log.length) {
      const a = this.log.at(-1)!;
      if (undone.length && !(last!.hint && a.hint && a.i === last!.i)) break;
      this.log.pop();
      if (a.lock) this.locked[a.i] ^= 1;
      else {
        this.rot[a.i] = (this.rot[a.i] + 3) & 3;
        this.moves--;
      }
      undone.push(a);
    }
    return undone;
  }

  /** Back to the scrambled start with an empty log; hints stay spent. */
  reset(): void {
    this.origin = { rot: this.puzzle.start, locked: new Uint8Array(this.size), moves: 0 };
    this.rot.set(this.puzzle.start);
    this.locked.fill(0);
    this.log = [];
    this.moves = 0;
  }

  /** Off the generated solution? */
  wrong(i: number): boolean {
    return this.rot[i] % period(this.puzzle.base[i]) !== 0;
  }

  /**
   * Turns one tile into its place in the generated solution and locks it: a
   * tile the player locked in a wrong position first, otherwise the wrong tile
   * nearest the station. Returns the actions taken, or null when nothing is off.
   */
  hint(t = 0): Action[] | null {
    const order = treeOrder(this.puzzle);
    const target = order.find((i) => this.locked[i] && this.wrong(i)) ?? order.find((i) => this.wrong(i));
    if (target === undefined) return null;
    const from = this.log.length;
    if (this.locked[target]) this.toggleLock(target, t, true);
    while (this.wrong(target)) this.rotate(target, t, true);
    this.toggleLock(target, t, true);
    this.hints++;
    return this.log.slice(from);
  }

  /** Tiles whose current lock was put there by a hint. */
  hintLocked(): Set<number> {
    const by = new Map<number, boolean>();
    for (const a of this.log) if (a.lock) by.set(a.i, a.hint);
    const out = new Set<number>();
    for (const [i, hint] of by) if (hint && this.locked[i]) out.add(i);
    return out;
  }

  /** Taps needed to reach the generated solution — a reference, not a proven minimum. */
  par(): number {
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      const p = period(this.puzzle.base[i]);
      sum += (p - (this.rot[i] % p)) % p;
    }
    return sum;
  }

  flow(): Flow {
    const { w, h, source } = this.puzzle;
    const n = this.size;
    const dist = new Int16Array(n).fill(-1);
    const loose = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const m = this.mask(i);
      for (const d of DIRS) {
        if (!(m & d)) continue;
        const j = neighbor(w, h, i, d);
        if (j < 0 || !(this.mask(j) & opposite(d))) loose[i] |= d;
      }
    }
    const queue = [source];
    dist[source] = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const m = this.mask(i) & ~loose[i];
      for (const d of DIRS) {
        if (!(m & d)) continue;
        const j = neighbor(w, h, i, d);
        if (dist[j] < 0) {
          dist[j] = dist[i] + 1;
          queue.push(j);
        }
      }
    }
    let housesLit = 0, anyLoose = false;
    for (let i = 0; i < n; i++) {
      if (loose[i]) anyLoose = true;
      if (dist[i] >= 0 && this.isHouse(i)) housesLit++;
    }
    // Rotations keep each tile's degree, so the wires always total n-1 edges:
    // all cells connected with every connector matched means a spanning tree.
    return { dist, loose, powered: queue.length, housesLit, solved: queue.length === n && !anyLoose };
  }
}

/** Cells in breadth-first order from the station along the generated solution. */
export function treeOrder(p: Puzzle): number[] {
  const seen = new Uint8Array(p.base.length);
  const order = [p.source];
  seen[p.source] = 1;
  for (let q = 0; q < order.length; q++) {
    const i = order[q];
    for (const d of DIRS) {
      if (!(p.base[i] & d)) continue;
      const j = neighbor(p.w, p.h, i, d);
      if (!seen[j]) {
        seen[j] = 1;
        order.push(j);
      }
    }
  }
  return order;
}
