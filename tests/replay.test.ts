import { describe, expect, it } from 'vitest';
import { Board, treeOrder } from '../src/game/board';
import { generate } from '../src/game/generate';
import { Playback, boardAfter, decodeLog, encodeLog, referenceActions } from '../src/game/replay';
import { hashString, mulberry32 } from '../src/game/rng';

const puzzle = (seed: number, w = 6, h = 7) => generate(w, h, hashString(`r:${seed}`));

/** A messy player: random taps, locks, undos and hints, then hints until solved. */
function scramblePlay(b: Board, seed: number): void {
  const rng = mulberry32(seed);
  let t = 0;
  for (let step = 0; step < 300 && !b.flow().solved; step++) {
    t += 50 + Math.floor(rng() * 900);
    const r = rng(), i = Math.floor(rng() * b.size);
    if (r < 0.06) b.toggleLock(i, t);
    else if (r < 0.12) b.undo();
    else if (r < 0.16) b.hint(t);
    else b.rotate(i, t);
  }
  while (!b.flow().solved && b.hint((t += 400))) { /* finish with hints */ }
}

describe('undo', () => {
  it('takes back taps and locks one at a time, and a hint all at once', () => {
    const p = puzzle(1);
    const b = new Board(p);
    const i = treeOrder(p).find((k) => b.wrong(k))!;
    b.rotate(i, 10);
    b.toggleLock(i, 20);
    expect(b.rotate(i, 30)).toBe(false);
    expect(b.log).toHaveLength(2);
    expect(b.undo()).toHaveLength(1);
    expect(b.locked[i]).toBe(0);
    b.undo();
    expect([...b.rot]).toEqual([...p.start]);
    expect(b.moves).toBe(0);
    expect(b.undo()).toEqual([]);

    const before = [...b.rot];
    const taken = b.hint(40)!;
    expect(taken.length).toBeGreaterThanOrEqual(2);
    expect(b.hints).toBe(1);
    expect(b.undo()).toHaveLength(taken.length);
    expect([...b.rot]).toEqual(before);
    expect(b.locked.every((v) => v === 0)).toBe(true);
    expect(b.hints).toBe(1); // a seen hint is not refunded
  });

  it('reset returns to the start with an empty log but keeps spent hints', () => {
    const b = new Board(puzzle(2));
    b.hint(5);
    b.rotate(0, 6);
    b.reset();
    expect([...b.rot]).toEqual([...b.puzzle.start]);
    expect(b.log).toEqual([]);
    expect(b.moves).toBe(0);
    expect(b.hints).toBe(1);
  });
});

describe('hint', () => {
  it('fixes a wrongly locked tile first, then works outward from the station', () => {
    const p = puzzle(3);
    const b = new Board(p);
    const order = treeOrder(p);
    const wrong = order.filter((k) => b.wrong(k));
    const far = wrong.at(-1)!;
    b.toggleLock(far, 0);
    b.hint(1);
    expect(b.wrong(far)).toBe(false);
    expect(b.locked[far]).toBe(1);
    expect(b.hintLocked()).toEqual(new Set([far]));
    b.hint(2);
    expect(b.wrong(wrong[0])).toBe(false);
    expect(b.hintLocked()).toEqual(new Set([far, wrong[0]]));
  });

  it('solves any position given enough hints, then has nothing left to say', () => {
    for (let s = 0; s < 10; s++) {
      const b = new Board(puzzle(s));
      for (let k = 0; k < 20; k++) b.rotate(Math.floor(mulberry32(s + k)() * b.size));
      while (b.hint()) { /* keep asking */ }
      expect(b.flow().solved).toBe(true);
      expect(b.hint()).toBeNull();
    }
  });
});

describe('replay', () => {
  it('reference actions take exactly par taps and solve the puzzle', () => {
    for (let s = 0; s < 20; s++) {
      const p = puzzle(s, 7, 8);
      const ref = referenceActions(p);
      expect(ref).toHaveLength(new Board(p).par());
      expect(boardAfter(p, ref)!.flow().solved).toBe(true);
    }
  });

  it('an encoded log rebuilds the exact final board of a messy solve', () => {
    for (let s = 0; s < 15; s++) {
      const p = puzzle(s);
      const b = new Board(p);
      scramblePlay(b, s);
      expect(b.flow().solved).toBe(true);
      const decoded = decodeLog(JSON.parse(JSON.stringify(encodeLog(b.log))), p.base.length)!;
      expect(decoded.map((a) => [a.i, a.lock, a.hint])).toEqual(b.log.map((a) => [a.i, a.lock, a.hint]));
      const again = boardAfter(p, decoded)!;
      expect([...again.rot]).toEqual([...b.rot]);
      expect([...again.locked]).toEqual([...b.locked]);
      expect(again.moves).toBe(b.moves);
    }
  });

  it('rejects logs that are malformed or do not fit the board', () => {
    expect(decodeLog([1], 9)).toBeNull();
    expect(decodeLog([9 * 4, 0], 9)).toBeNull();
    expect(decodeLog([0, -5], 9)).toBeNull();
    expect(decodeLog('x', 9)).toBeNull();
    const p = puzzle(4, 3, 3);
    expect(boardAfter(p, [{ i: 0, lock: true, hint: false, t: 0 }, { i: 0, lock: false, hint: false, t: 1 }])).toBeNull();
  });

  it('plays back in time, honours speed, and seeking matches playing', () => {
    const p = puzzle(5);
    const b = new Board(p);
    scramblePlay(b, 5);
    const pb = new Playback(p, b.log, 'real');
    pb.play();
    expect(pb.tick(100)).toEqual([]); // the opening pause
    let frames = 0;
    while (!pb.done && frames++ < 100_000) pb.tick(16);
    expect(pb.playing).toBe(false);
    expect([...pb.board.rot]).toEqual([...b.rot]);
    for (const k of [0, 7, Math.floor(b.log.length / 2), b.log.length]) {
      pb.seek(k);
      expect([...pb.board.rot]).toEqual([...boardAfter(p, b.log.slice(0, k))!.rot]);
    }
    const slow = new Playback(p, referenceActions(p), 'even');
    const fast = new Playback(p, referenceActions(p), 'even');
    slow.play();
    fast.play();
    fast.speed = 4;
    slow.tick(12_000);
    fast.tick(3000);
    expect(fast.k).toBe(slow.k); // 4× for 3 s covers what 1× covers in 12 s
    expect(fast.k).toBeGreaterThan(5);
  });

  it('a step is one tile: all its turns, the same unit as a hint', () => {
    const p = puzzle(7, 7, 8);
    const ref = referenceActions(p);
    const pb = new Playback(p, ref, 'even');
    expect(pb.steps).toBe(new Set(ref.map((a) => a.i)).size);
    // from the scrambled start, repeated hints visit tiles in the walkthrough's order
    const b = new Board(p);
    const hinted: number[] = [];
    for (let h = b.hint(); h; h = b.hint()) hinted.push(h[0].i);
    expect(hinted).toEqual(pb.starts.map((k) => ref[k].i));
  });

  it('steps forward one tile per tap, previews it, and steps back', () => {
    const p = puzzle(8, 7, 8);
    const ref = referenceActions(p);
    const pb = new Playback(p, ref, 'even');
    expect(pb.busy).toBe(false);
    const first = pb.preview()!;
    expect(first.i).toBe(ref[0].i);
    expect(first.mask).toBe(p.base[first.i]); // the reference puts it back to the solved shape
    pb.next();
    expect(pb.preview()).toBeNull(); // no preview while animating
    let frames = 0;
    while (pb.busy && frames++ < 1000) pb.tick(16);
    expect(pb.step).toBe(1);
    expect(pb.k).toBe(pb.starts[1]);
    expect(pb.board.wrong(first.i)).toBe(false);
    expect(frames * 16).toBeLessThan(1000); // a step is quick: 220 ms between turns
    pb.next();
    pb.tick(16); // half way into step 2
    if (pb.starts[2] - pb.starts[1] > 1) {
      pb.pause();
      expect(pb.step).toBe(1);
      pb.prev(); // back to the start of the half-played step
      expect(pb.k).toBe(pb.starts[1]);
    }
    pb.prev();
    expect(pb.k).toBe(0);
    pb.prev();
    expect(pb.k).toBe(0);
    pb.seekStep(pb.steps);
    expect(pb.done).toBe(true);
    expect(pb.preview()).toBeNull();
    expect(pb.board.flow().solved).toBe(true);
  });

  it('auto-plays the reference at a readable pace', () => {
    const p = puzzle(9, 7, 8);
    const pb = new Playback(p, referenceActions(p), 'even');
    pb.play();
    let ms = 0;
    while (!pb.done) {
      pb.tick(16);
      ms += 16;
    }
    expect(ms).toBeGreaterThan((pb.steps - 1) * 900);
  });

  it('starts a legacy save from its own origin', () => {
    const p = puzzle(6);
    const origin = { rot: Array.from(p.start, (r) => (r + 1) & 3), locked: new Array(p.base.length).fill(0), moves: 12 };
    const b = new Board(p, origin);
    expect(b.moves).toBe(12);
    b.rotate(0, 5);
    const again = boardAfter(p, b.log, origin)!;
    expect([...again.rot]).toEqual([...b.rot]);
    expect(again.moves).toBe(13);
  });
});
