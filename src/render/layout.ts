export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface View {
  cell: number;
  ox: number;
  oy: number;
}

/** Fit inside the space actually left by the UI, never underneath a panel. */
export function fitBoard(cols: number, rows: number, area: Bounds): View {
  const pad = 18;
  const width = Math.max(0, area.width);
  const height = Math.max(0, area.height);
  const cell = Math.floor(Math.min(Math.max(0, width - pad * 2) / cols, Math.max(0, height - pad * 2) / rows, 92));
  return {
    cell,
    ox: Math.round(area.x + (width - cell * cols) / 2),
    oy: Math.round(area.y + (height - cell * rows) / 2),
  };
}
