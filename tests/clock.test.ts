import { describe, expect, it } from 'vitest';
import { PlayClock } from '../src/game/clock';

function clock() {
  let now = 0;
  const timer = new PlayClock(() => now);
  return { timer, wait: (ms: number) => { now += ms; } };
}

describe('active play clock', () => {
  it('does not charge observation time before the first turn or hint', () => {
    const { timer, wait } = clock();
    timer.setActive(true);
    wait(5000);
    expect(timer.elapsed).toBe(0);
    timer.start();
    wait(1000);
    expect(timer.elapsed).toBe(1000);
    timer.start(); // later turns, including after undo/restart, do not reset the clock
    wait(1000);
    expect(timer.elapsed).toBe(2000);
  });

  it('counts real foreground time even without animation frames', () => {
    const { timer, wait } = clock();
    timer.setActive(true);
    timer.start();
    wait(2350);
    expect(timer.elapsed).toBe(2350);
    expect(timer.elapsed).toBe(2350); // reading it is not another tick
  });

  it('excludes menus and background time without losing the last foreground interval', () => {
    const { timer, wait } = clock();
    timer.setActive(true);
    timer.start();
    wait(600);
    timer.setActive(false);
    wait(60_000);
    expect(timer.elapsed).toBe(600);
    timer.setActive(false);
    timer.setActive(true);
    wait(700);
    expect(timer.elapsed).toBe(1300);
  });

  it('restores a started zero-move or zero-millisecond game as running', () => {
    const { timer, wait } = clock();
    timer.restore(0, true);
    timer.setActive(true);
    wait(800);
    expect(timer.elapsed).toBe(800);
    timer.setActive(false);
    timer.restore(800, true);
    timer.setActive(true);
    wait(500);
    expect(timer.elapsed).toBe(1300);
  });

  it('infers a started clock from an older save and waits while inactive', () => {
    const { timer, wait } = clock();
    timer.restore(1500);
    wait(2000);
    expect(timer.started).toBe(true);
    expect(timer.elapsed).toBe(1500);
    timer.setActive(true);
    wait(1300);
    expect(timer.elapsed).toBe(2800);
  });

  it('starts a new puzzle with a fresh, unstarted clock', () => {
    const { timer, wait } = clock();
    timer.setActive(true);
    timer.start();
    wait(1000);
    timer.restore();
    wait(2000);
    expect(timer.started).toBe(false);
    expect(timer.elapsed).toBe(0);
  });
});
