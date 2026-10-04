import { generate, type Puzzle } from './generate';
import { hashString } from './rng';

/** Daily #1. */
export const EPOCH = '2026-10-04';
export const DAILY_SIZE = [7, 8] as const;

/** Level → board size; boards are never wider than tall so they suit phones. */
const LEVEL_SIZES: readonly (readonly [from: number, w: number, h: number])[] = [
  [1, 3, 3], [2, 4, 4], [3, 4, 5], [4, 5, 5], [5, 5, 6], [6, 6, 6], [8, 6, 7],
  [11, 7, 7], [15, 7, 8], [20, 8, 8], [30, 8, 9], [40, 9, 10],
];

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function shiftKey(key: string, days: number): string {
  return new Date((dayIndex(key) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function dailyNumber(key: string): number {
  return dayIndex(key) - dayIndex(EPOCH) + 1;
}

export function dailyPuzzle(key: string): Puzzle {
  return generate(DAILY_SIZE[0], DAILY_SIZE[1], hashString(`daily:${key}`));
}

export function levelSize(level: number): [number, number] {
  let size: [number, number] = [3, 3];
  for (const [from, w, h] of LEVEL_SIZES) if (level >= from) size = [w, h];
  return size;
}

export function levelPuzzle(level: number): Puzzle {
  const [w, h] = levelSize(level);
  return generate(w, h, hashString(`level:${level}`));
}

/** Consecutive solved days ending today (or yesterday, if today is still open). */
export function streak(done: (key: string) => boolean, today: string): number {
  let key = done(today) ? today : shiftKey(today, -1);
  let n = 0;
  while (done(key)) {
    n++;
    key = shiftKey(key, -1);
  }
  return n;
}

/** 1–5 lanterns: how close the move count came to the reference solution. */
export function lanterns(moves: number, par: number): number {
  if (par <= 0) return 5;
  const r = moves / par;
  return r <= 1 ? 5 : r <= 1.25 ? 4 : r <= 1.6 ? 3 : r <= 2.2 ? 2 : 1;
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
