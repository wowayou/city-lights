/** Connector bitmask: a tile's wires point N/E/S/W. */
export const N = 1, E = 2, S = 4, W = 8;
export const DIRS = [N, E, S, W] as const;

export function opposite(d: number): number {
  return ((d << 2) | (d >> 2)) & 15;
}

export function rotateCW(mask: number, times = 1): number {
  let m = mask & 15;
  for (let k = times & 3; k > 0; k--) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

export function degree(mask: number): number {
  let c = 0;
  for (const d of DIRS) if (mask & d) c++;
  return c;
}

/** Smallest number of clockwise turns that maps the mask onto itself (1, 2 or 4). */
export function period(mask: number): 1 | 2 | 4 {
  if (rotateCW(mask, 1) === mask) return 1;
  if (rotateCW(mask, 2) === mask) return 2;
  return 4;
}

/** Index of the neighbouring cell in direction d, or -1 off the board. */
export function neighbor(w: number, h: number, i: number, d: number): number {
  const x = i % w, y = (i - x) / w;
  if (d === N) return y > 0 ? i - w : -1;
  if (d === S) return y < h - 1 ? i + w : -1;
  if (d === E) return x < w - 1 ? i + 1 : -1;
  return x > 0 ? i - 1 : -1;
}
