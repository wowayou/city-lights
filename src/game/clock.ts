/** Active play time, independent of animation frames and the undoable move count. */
export class PlayClock {
  started = false;
  private total = 0;
  private since: number | null = null;
  private active = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get elapsed(): number {
    return this.total + (this.since === null ? 0 : Math.max(0, this.now() - this.since));
  }

  /** Starts a new puzzle, or restores one. Older saves infer a start from elapsed time. */
  restore(elapsed = 0, started = elapsed > 0): void {
    this.total = elapsed;
    this.started = started;
    this.since = this.active && started ? this.now() : null;
  }

  /** The first successful turn or hint starts the clock; undo/restart never un-start it. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.active) this.since = this.now();
  }

  /** Only the visible play screen is active; menus, results and hidden tabs are not. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.total = this.elapsed;
    this.active = active;
    this.since = active && this.started ? this.now() : null;
  }
}
