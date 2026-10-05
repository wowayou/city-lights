import { afterEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../src/game/board';
import { DAILY_SIZE, dailyNumber, dailyPuzzle, dateKey, formatTime, lanterns, levelPuzzle, levelSize, rating, shiftKey, streak } from '../src/game/modes';
import { store } from '../src/storage';

describe('daily', () => {
  it('numbers days from the launch date across month and year ends', () => {
    expect(dailyNumber('2026-10-04')).toBe(1);
    expect(dailyNumber('2026-11-01')).toBe(29);
    expect(dailyNumber('2027-01-01')).toBe(90);
    expect(shiftKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftKey('2027-03-01', -1)).toBe('2027-02-28');
  });
  it('uses the local calendar date', () => {
    expect(dateKey(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04');
    expect(dateKey(new Date(2026, 0, 9, 0, 1))).toBe('2026-01-09');
  });
  it('gives everyone the same unsolved puzzle each day, and a new one the next', () => {
    const a = dailyPuzzle('2026-10-04');
    expect(a).toEqual(dailyPuzzle('2026-10-04'));
    expect([a.w, a.h]).toEqual([...DAILY_SIZE]);
    expect(a.base).not.toEqual(dailyPuzzle('2026-10-05').base);
    for (let d = 0; d < 60; d++) expect(new Board(dailyPuzzle(shiftKey('2026-10-04', d))).flow().solved).toBe(false);
  });
  it('counts a streak that is still alive until today is over', () => {
    const done = new Set(['2026-10-02', '2026-10-03', '2026-10-04']);
    const has = (k: string) => done.has(k);
    expect(streak(has, '2026-10-04')).toBe(3);
    expect(streak(has, '2026-10-05')).toBe(3);
    expect(streak(has, '2026-10-06')).toBe(0);
  });
});

describe('levels', () => {
  it('grow monotonically and stay portrait-friendly', () => {
    let prev = 0;
    for (let l = 1; l <= 60; l++) {
      const [w, h] = levelSize(l);
      expect(w).toBeLessThanOrEqual(h);
      expect(w * h).toBeGreaterThanOrEqual(prev);
      prev = w * h;
      expect(new Board(levelPuzzle(l)).flow().solved).toBe(false);
    }
    expect(levelSize(1)).toEqual([3, 3]);
  });
});

describe('scoring', () => {
  it('rates moves against the reference solution', () => {
    expect(lanterns(10, 10)).toBe(5);
    expect(lanterns(12, 10)).toBe(4);
    expect(lanterns(16, 10)).toBe(3);
    expect(lanterns(22, 10)).toBe(2);
    expect(lanterns(23, 10)).toBe(1);
    expect(lanterns(3, 0)).toBe(5);
  });
  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(61_999)).toBe('1:01');
    expect(formatTime(3_600_000)).toBe('60:00');
  });
});

describe('storage', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fake = (data: Record<string, string> = {}) => ({
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  });

  it('falls back to defaults when storage throws or holds garbage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(store.level()).toBe(1);
    expect(store.muted()).toBe(false);
    store.setLevel(5);
    vi.stubGlobal('localStorage', fake({ 'city-lights:v1:level': '"x"', 'city-lights:v1:daily': '{"2026-10-04":{"time":"no"}}', 'city-lights:v1:muted': '{' }));
    expect(store.level()).toBe(1);
    expect(store.daily()).toEqual({});
    expect(store.muted()).toBe(false);
  });
  it('round-trips results and rejects saves that do not fit the board', () => {
    vi.stubGlobal('localStorage', fake());
    store.setDaily('2026-10-04', { time: 1000, moves: 30, par: 25 });
    store.setDaily('2026-10-05', { time: 2000, moves: 31, par: 25, hints: 1, log: [4, 0, 5, 120] });
    expect(Object.keys(store.daily())).toEqual(['2026-10-04', '2026-10-05']);
    expect(store.daily()['2026-10-05'].log).toEqual([4, 0, 5, 120]);
    const save = { log: [4, 0, 8, 300], elapsed: 500, hints: 0 };
    store.setSave('level:2', save);
    expect(store.save('level:2', 4)).toEqual(save);
    expect(store.save('level:2', 9)).toEqual(save); // the log is checked against the board when decoded
    store.setSave('level:2', { ...save, origin: { rot: [0, 1, 2, 3], locked: [0, 0, 1, 0], moves: 3 } });
    expect(store.save('level:2', 9)).toBeNull();
    store.setSave('level:2', undefined);
    expect(store.save('level:2', 4)).toBeNull();
  });
  it('upgrades a first-release save (positions, no log) into an origin', () => {
    vi.stubGlobal('localStorage', fake({ 'city-lights:v1:save:daily:2026-10-04': JSON.stringify({ rot: [0, 1, 2, 3], locked: [0, 0, 1, 0], moves: 3, elapsed: 500 }) }));
    expect(store.save('daily:2026-10-04', 4)).toEqual({ log: [], elapsed: 500, hints: 0, origin: { rot: [0, 1, 2, 3], locked: [0, 0, 1, 0], moves: 3 } });
    expect(store.save('daily:2026-10-04', 5)).toBeNull();
  });
  it('keeps the best result per level: more lanterns first, then faster', () => {
    vi.stubGlobal('localStorage', fake());
    store.setLevelResult(3, { time: 9000, moves: 10, par: 10, hints: 0 });
    store.setLevelResult(3, { time: 1000, moves: 10, par: 10, hints: 1 }); // faster but a hint costs a lantern
    expect(store.levels()[3].time).toBe(9000);
    store.setLevelResult(3, { time: 5000, moves: 10, par: 10, hints: 0, log: [1, 2] });
    expect(store.levels()[3]).toEqual({ time: 5000, moves: 10, par: 10, hints: 0 });
  });
  it('keeps replay logs only for recent dailies', () => {
    vi.stubGlobal('localStorage', fake());
    for (let d = 0; d < 40; d++) store.setDaily(shiftKey('2026-10-04', d), { time: 1, moves: 1, par: 1, log: [0, 0] });
    const all = store.daily();
    expect(Object.keys(all)).toHaveLength(40);
    expect(Object.values(all).filter((r) => r.log)).toHaveLength(30);
    expect(all['2026-10-04'].log).toBeUndefined();
    expect(all[shiftKey('2026-10-04', 39)].log).toEqual([0, 0]);
  });
});

describe('rating', () => {
  it('takes a lantern per hint but never goes below one', () => {
    expect(rating({ moves: 10, par: 10 })).toBe(5);
    expect(rating({ moves: 10, par: 10, hints: 2 })).toBe(3);
    expect(rating({ moves: 30, par: 10, hints: 3 })).toBe(1);
  });
});
