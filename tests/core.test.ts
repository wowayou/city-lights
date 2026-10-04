import { describe, expect, it } from 'vitest';
import { Board } from '../src/game/board';
import { generate } from '../src/game/generate';
import { DIRS, E, N, S, W, degree, neighbor, opposite, period, rotateCW } from '../src/game/grid';
import { hashString } from '../src/game/rng';

describe('grid', () => {
  it('rotates clockwise and finds opposites', () => {
    expect(rotateCW(N)).toBe(E);
    expect(rotateCW(W)).toBe(N);
    expect(rotateCW(N | E, 2)).toBe(S | W);
    expect(rotateCW(N | S, 4)).toBe(N | S);
    expect([N, E, S, W].map(opposite)).toEqual([S, W, N, E]);
    expect(period(N | S)).toBe(2);
    expect(period(N | E)).toBe(4);
    expect(period(15)).toBe(1);
  });
  it('stays on the board', () => {
    expect(neighbor(3, 3, 0, N)).toBe(-1);
    expect(neighbor(3, 3, 0, W)).toBe(-1);
    expect(neighbor(3, 3, 2, E)).toBe(-1);
    expect(neighbor(3, 3, 4, S)).toBe(7);
  });
});

describe('generate', () => {
  const sizes: [number, number][] = [[3, 3], [4, 5], [7, 8], [9, 10]];
  for (const [w, h] of sizes) {
    it(`builds a crossing-free spanning tree on ${w}x${h}`, () => {
      for (let s = 0; s < 40; s++) {
        const p = generate(w, h, hashString(`t:${w}:${s}`));
        let edges = 0;
        p.base.forEach((m, i) => {
          expect(m).toBeGreaterThan(0);
          expect(degree(m)).toBeLessThan(4);
          for (const d of DIRS) {
            if (!(m & d)) continue;
            const j = neighbor(w, h, i, d);
            expect(j).toBeGreaterThanOrEqual(0);
            expect(p.base[j] & opposite(d)).toBeTruthy();
            edges++;
          }
        });
        expect(edges / 2).toBe(w * h - 1);
        const solved = new Board({ ...p, start: new Uint8Array(w * h) });
        expect(solved.flow().solved).toBe(true);
      }
    });
  }
  it('is deterministic per seed', () => {
    expect(generate(7, 8, 42)).toEqual(generate(7, 8, 42));
    expect(generate(7, 8, 42).base).not.toEqual(generate(7, 8, 43).base);
  });
});

describe('board', () => {
  it('solves by tapping par times and counts moves', () => {
    const b = new Board(generate(6, 6, 7));
    const par = b.par();
    for (let i = 0; i < b.size; i++) {
      const p = period(b.puzzle.base[i]);
      while (b.rot[i] % p !== 0) b.rotate(i);
    }
    expect(b.moves).toBe(par);
    expect(b.par()).toBe(0);
    const f = b.flow();
    expect(f.solved).toBe(true);
    expect(f.powered).toBe(36);
    expect(f.housesLit).toBe([...b.puzzle.base.keys()].filter((i) => b.isHouse(i)).length);
  });
  it('reports loose ends and refuses to rotate locked tiles', () => {
    const b = new Board({ ...generate(5, 5, 3), start: new Uint8Array(25) });
    const leaf = [...Array(25).keys()].find((i) => b.isHouse(i))!;
    b.rotate(leaf);
    const f = b.flow();
    expect(f.solved).toBe(false);
    expect(f.dist[leaf]).toBe(-1);
    expect(f.loose[leaf]).toBeTruthy();
    b.toggleLock(leaf);
    expect(b.rotate(leaf)).toBe(false);
    expect(b.moves).toBe(1);
  });
});
