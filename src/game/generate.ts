import { DIRS, degree, neighbor, opposite, period } from './grid';
import { mulberry32, randInt } from './rng';

export interface Puzzle {
  w: number;
  h: number;
  /** Power station cell. */
  source: number;
  /** Solved connector masks: a random spanning tree of the grid. */
  base: Uint8Array;
  /** Scrambled starting rotation (clockwise quarter turns) per cell. */
  start: Uint8Array;
}

/**
 * Grows a random spanning tree from the centre (random Prim), avoiding 4-way
 * crossings (they look the same at every rotation), then scrambles every
 * tile. Any arrangement that powers every cell with no loose ends wins, so
 * the puzzle need not have a unique solution.
 */
export function generate(w: number, h: number, seed: number): Puzzle {
  const rng = mulberry32(seed);
  const n = w * h;
  const base = new Uint8Array(n);
  const inTree = new Uint8Array(n);
  const source = Math.floor(h / 2) * w + Math.floor(w / 2);
  let frontier: number[] = [];
  let deferred: number[] = [];
  let size = 0;
  let strict = true;

  const add = (i: number) => {
    inTree[i] = 1;
    size++;
    for (let k = 0; k < 4; k++) {
      const j = neighbor(w, h, i, DIRS[k]);
      if (j >= 0 && !inTree[j]) frontier.push(i * 4 + k);
    }
  };

  add(source);
  while (size < n) {
    if (frontier.length === 0) {
      if (deferred.length === 0) throw new Error('grid is not connected');
      frontier = deferred;
      deferred = [];
      strict = false;
    }
    const pick = randInt(rng, frontier.length);
    const code = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    const i = code >> 2, d = DIRS[code & 3];
    const j = neighbor(w, h, i, d);
    if (inTree[j]) continue;
    if (strict && degree(base[i]) >= 3) {
      deferred.push(code);
      continue;
    }
    base[i] |= d;
    base[j] |= opposite(d);
    add(j);
  }

  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = randInt(rng, 4);
  // Never hand out a board that is already solved.
  if (start.every((r, i) => r % period(base[i]) === 0)) {
    const i = base.findIndex((m) => period(m) > 1);
    start[i] = 1;
  }
  return { w, h, source, base, start };
}
