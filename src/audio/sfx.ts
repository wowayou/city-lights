/** Synthesised sound effects (no audio files). The context is created on the first gesture. */
const PENTA = [0, 2, 4, 7, 9];

function note(step: number, root = 392): number {
  const octave = Math.floor(step / 5);
  return root * 2 ** ((octave * 12 + PENTA[((step % 5) + 5) % 5]) / 12);
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;

  constructor(public muted: boolean) {}

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number, endFreq?: number): void {
    if (this.muted || !this.ctx || !this.out) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(760 + Math.random() * 80, 0, 0.06, 'triangle', 0.14, 520);
  }

  lock(): void {
    this.tone(240, 0, 0.09, 'square', 0.05, 170);
  }

  /** A bell whose pitch climbs with the number of homes lit. */
  light(count: number): void {
    const f = note(Math.min(count - 1, 14));
    this.tone(f, 0, 1.1, 'sine', 0.2);
    this.tone(f * 2, 0, 0.5, 'sine', 0.05);
    this.tone(760, 0, 0.05, 'triangle', 0.08, 520);
  }

  win(): void {
    [0, 2, 4, 5, 7, 10].forEach((s, k) => {
      this.tone(note(s), k * 0.11, 1.6, 'sine', 0.16);
      this.tone(note(s) * 2, k * 0.11, 0.7, 'triangle', 0.03);
    });
    this.tone(note(-5), 0.05, 2.4, 'sine', 0.12);
  }
}
