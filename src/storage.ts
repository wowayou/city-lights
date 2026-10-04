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
}

export interface Saved {
  rot: number[];
  locked: number[];
  moves: number;
  elapsed: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isResult = (v: unknown): v is Result => isObj(v) && isNum(v.time) && isNum(v.moves) && isNum(v.par);

export const store = {
  muted: () => read('muted', false, (v) => typeof v === 'boolean'),
  setMuted: (m: boolean) => write('muted', m),

  level: () => read('level', 1, (v) => Number.isInteger(v) && (v as number) >= 1),
  setLevel: (n: number) => write('level', n),

  daily: () => read<Record<string, Result>>('daily', {}, (v) => isObj(v) && Object.values(v).every(isResult)),
  setDaily(key: string, r: Result) {
    write('daily', { ...this.daily(), [key]: r });
  },

  /** In-progress board for a puzzle id, if it still fits a board of `size` cells. */
  save(id: string, size: number): Saved | null {
    return read<Saved | null>(`save:${id}`, null, (v) =>
      isObj(v) && Array.isArray(v.rot) && v.rot.length === size && v.rot.every((r) => r === 0 || r === 1 || r === 2 || r === 3) &&
      Array.isArray(v.locked) && v.locked.length === size && isNum(v.moves) && isNum(v.elapsed));
  },
  setSave: (id: string, s: Saved | undefined) => write(`save:${id}`, s),
};
