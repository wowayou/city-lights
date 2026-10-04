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

export class Board {
  readonly rot: Uint8Array;
  readonly locked: Uint8Array;
  moves = 0;

  constructor(readonly puzzle: Puzzle) {
    this.rot = puzzle.start.slice();
    this.locked = new Uint8Array(puzzle.base.length);
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

  /** Quarter turn clockwise. Returns false (and counts no move) for a locked tile. */
  rotate(i: number): boolean {
    if (this.locked[i]) return false;
    this.rot[i] = (this.rot[i] + 1) & 3;
    this.moves++;
    return true;
  }

  toggleLock(i: number): void {
    this.locked[i] ^= 1;
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
