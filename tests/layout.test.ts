import { describe, expect, it } from 'vitest';
import { fitBoard, type Bounds } from '../src/render/layout';

describe('board layout', () => {
  const portrait: Bounds = { x: 0, y: 60, width: 320, height: 568 - 60 - 88 };
  const narrowLandscape: Bounds = { x: 0, y: 0, width: 568 * 0.55, height: 320 };
  const landscape: Bounds = { x: 0, y: 0, width: 844 - 360, height: 390 };

  it('uses the full landscape height rather than the gap between top and bottom controls', () => {
    expect(fitBoard(7, 8, narrowLandscape).cell).toBe(35);
    expect(fitBoard(7, 8, landscape).cell).toBe(44);
    expect(fitBoard(9, 10, narrowLandscape).cell).toBe(28);
    expect(fitBoard(7, 8, portrait).cell).toBe(40);
  });

  it('keeps every board inside its reserved area, including safe-area insets', () => {
    for (const area of [portrait, narrowLandscape, landscape, { x: 44, y: 12, width: 440, height: 300 }]) {
      for (const [w, h] of [[3, 3], [7, 8], [9, 10]]) {
        const { cell, ox, oy } = fitBoard(w, h, area);
        expect(ox).toBeGreaterThanOrEqual(area.x + 17);
        expect(oy).toBeGreaterThanOrEqual(area.y + 17);
        expect(ox + w * cell).toBeLessThanOrEqual(area.x + area.width - 17);
        expect(oy + h * cell).toBeLessThanOrEqual(area.y + area.height - 17);
      }
    }
  });

  it('does not invent 80px of space when a panel has used up the height', () => {
    expect(fitBoard(7, 8, { x: 0, y: 80, width: 320, height: 20 }).cell).toBe(0);
    expect(fitBoard(7, 8, { x: 0, y: 80, width: 320, height: -20 }).cell).toBe(0);
  });

  it('caps large-screen tiles without moving them off centre', () => {
    expect(fitBoard(3, 3, { x: 0, y: 0, width: 1280, height: 800 })).toEqual({ cell: 92, ox: 502, oy: 262 });
  });
});
