import { rating } from './game/modes';

/** localStorage wrapper: every read tolerates missing, blocked or corrupt storage. */
const PREFIX = 'city-lights:v1:';

function read<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / quota: progress just isn't kept */
  }
}

export interface Result {
  time: number;
  moves: number;
  par: number;
  /** Absent in results saved before hints existed. */
  hints?: number;
  /** encodeLog() of the solve, kept for recent dailies so they can be replayed. */
  log?: number[];
}

/** An unfinished board: its log from the origin (the scrambled start unless an older save said otherwise). */
export interface Saved {
  log: number[];
  elapsed: number;
  hints: number;
  origin?: { rot: number[]; locked: number[]; moves: number };
}

/** Daily logs older than this many puzzles are dropped to keep storage small. */
const DAILY_LOGS_KEPT = 30;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isInts = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0);
const isResult = (v: unknown): v is Result =>
  isObj(v) && isNum(v.time) && isNum(v.moves) && isNum(v.par) &&
  (v.hints === undefined || isNum(v.hints)) && (v.log === undefined || isInts(v.log));
const isCells = (v: unknown, size: number, max: number): v is number[] =>
  isInts(v) && v.length === size && v.every((x) => x <= max);

export const store = {
  muted: () => read('muted', false, (v) => typeof v === 'boolean'),
  setMuted: (m: boolean) => write('muted', m),

  /** Highest level unlocked. */
  level: () => read('level', 1, (v) => Number.isInteger(v) && (v as number) >= 1),
  setLevel: (n: number) => write('level', n),

  levels: () => read<Record<string, Result>>('levels', {}, (v) => isObj(v) && Object.values(v).every(isResult)),
  /** Keeps the better of the stored and the new result for a level (more lanterns, then faster). */
  setLevelResult(n: number, r: Result) {
    const all = this.levels();
    const old = all[n];
    const better = !old || rating(r) > rating(old) || (rating(r) === rating(old) && r.time < old.time);
    if (better) write('levels', { ...all, [n]: { time: r.time, moves: r.moves, par: r.par, hints: r.hints ?? 0 } });
  },

  daily: () => read<Record<string, Result>>('daily', {}, (v) => isObj(v) && Object.values(v).every(isResult)),
  setDaily(key: string, r: Result) {
    const all: Record<string, Result> = { ...this.daily(), [key]: r };
    const keys = Object.keys(all).sort();
    for (const k of keys.slice(0, -DAILY_LOGS_KEPT)) {
      const { log: _drop, ...rest } = all[k];
      all[k] = rest;
    }
    write('daily', all);
  },

  /** In-progress board for a puzzle id, if it still fits a board of `size` cells. */
  save(id: string, size: number): Saved | null {
    const v = read<unknown>(`save:${id}`, null, () => true);
    if (!isObj(v) || !isNum(v.elapsed)) return null;
    if (isInts(v.log) && isNum(v.hints)) {
      const o = v.origin;
      if (o !== undefined && !(isObj(o) && isCells(o.rot, size, 3) && isCells(o.locked, size, 1) && isNum(o.moves))) return null;
      return v as unknown as Saved;
    }
    // first release: positions only, no log
    if (isCells(v.rot, size, 3) && isCells(v.locked, size, 1) && isNum(v.moves)) {
      return { log: [], elapsed: v.elapsed, hints: 0, origin: { rot: v.rot, locked: v.locked, moves: v.moves } };
    }
    return null;
  },
  setSave: (id: string, s: Saved | undefined) => write(`save:${id}`, s),
};
