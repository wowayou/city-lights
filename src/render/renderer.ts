import type { Board, Flow } from '../game/board';
import { DIRS, E, N, S, W, degree } from '../game/grid';

const VEC: Record<number, readonly [number, number]> = { [N]: [0, -1], [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0] };
const ROOFS = ['#b4533f', '#4a6fa8', '#5a8f63', '#a77b4f', '#7d5aa6', '#3f8f8f'];
const C = {
  skyTop: '#050918',
  skyBottom: '#1d1944',
  plate: 'rgba(10, 14, 36, 0.92)',
  plateEdge: 'rgba(140, 160, 255, 0.10)',
  cell: '#151c3c',
  cellLocked: '#232d5c',
  pin: '#a9b8f0',
  pinHint: '#7fd8ff',
  wireOff: '#323e6e',
  wireOn: '#ffd27a',
  wireCore: 'rgba(255, 248, 225, 0.75)',
  glow: 'rgba(255, 160, 60, 0.30)',
  body: '#252b50',
  bodyLit: '#3f3a69',
  window: '#12172f',
  windowLit: '#ffd98a',
  station: '#ffcc5c',
  bolt: '#3b2608',
};

export interface View {
  cell: number;
  ox: number;
  oy: number;
}

export interface Scene {
  board: Board | null;
  flow: Flow | null;
  /** Per-tile extra visual rotation (radians) that eases back to 0 after a tap. */
  anim: Float32Array | null;
  hover: number;
  cursor: number;
  /** Seconds timestamp of the solve, or -1. */
  wonAt: number;
  insetTop: number;
  insetBottom: number;
  /** 0..1 share of skyline windows that should be lit. */
  skyline: number;
  ambient: boolean;
  /** Tile that just changed (a ring fades out around it) and why: 0 tap, 1 hint, 2 refused (locked). */
  focus: number;
  focusAt: number;
  focusKind: number;
  /** Tiles locked by a hint get a different pin. */
  hintLocked: ReadonlySet<number>;
  /** Step-by-step playback: the tile the next step turns and the shape it ends with. */
  preview: { i: number; mask: number } | null;
}

interface Lantern {
  x: number;
  y: number;
  vy: number;
  s: number;
  ph: number;
  age: number;
  life: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  wins: { x: number; y: number; k: number }[];
}

/** Cheap deterministic noise in [0, 1). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;
  view: View = { cell: 0, ox: 0, oy: 0 };
  private viewFor: Board | null = null;
  private stars: { x: number; y: number; r: number; ph: number }[] = [];
  private buildings: Building[] = [];
  private skylineLit = 0.3;
  private lanterns: Lantern[] = [];
  private spawnClock = 0;
  private glow: HTMLCanvasElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.glow = document.createElement('canvas');
    this.glow.width = this.glow.height = 64;
    const g = this.glow.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 200, 110, 1)');
    grad.addColorStop(0.35, 'rgba(255, 160, 70, 0.45)');
    grad.addColorStop(1, 'rgba(255, 140, 50, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;

    this.stars = Array.from({ length: Math.round((this.w * this.h) / 9000) }, (_, k) => ({
      x: hash(k) * this.w,
      y: hash(k + 0.5) ** 1.6 * this.h * 0.8,
      r: 0.4 + hash(k + 0.25) * 1.1,
      ph: hash(k + 0.75) * 6.28,
    }));

    this.buildings = [];
    for (let x = -6, k = 0; x < this.w; k++) {
      const bw = 26 + hash(k * 3.1) * 46;
      const bh = this.h * (0.05 + hash(k * 5.7) * 0.11);
      const wins: Building['wins'] = [];
      for (let wy = 8; wy < bh - 8; wy += 11) {
        for (let wx = 6; wx < bw - 8; wx += 9) wins.push({ x: wx, y: wy, k: hash(k * 13.3 + wx * 1.7 + wy * 0.37) });
      }
      this.buildings.push({ x, w: bw, h: bh, wins });
      x += bw + 2 + hash(k * 2.3) * 6;
    }
    this.viewFor = null;
  }

  private targetView(board: Board, top: number, bottom: number): View {
    const { w, h } = board.puzzle;
    const pad = 18;
    const availW = this.w - pad * 2;
    const availH = Math.max(80, this.h - top - bottom - pad * 2);
    const cell = Math.floor(Math.min(availW / w, availH / h, 92));
    return {
      cell,
      ox: Math.round((this.w - cell * w) / 2),
      oy: Math.round(top + pad + (availH - cell * h) / 2),
    };
  }

  hit(board: Board, x: number, y: number): number {
    const { cell, ox, oy } = this.view;
    const cx = Math.floor((x - ox) / cell), cy = Math.floor((y - oy) / cell);
    const { w, h } = board.puzzle;
    return cx >= 0 && cy >= 0 && cx < w && cy < h ? cy * w + cx : -1;
  }

  cellCenter(board: Board, i: number): [number, number] {
    const { cell, ox, oy } = this.view;
    const w = board.puzzle.w;
    return [ox + ((i % w) + 0.5) * cell, oy + (Math.floor(i / w) + 0.5) * cell];
  }

  /** Each lit home releases a sky lantern, in a wave out from the station. */
  celebrate(board: Board, flow: Flow): void {
    for (let i = 0; i < board.size; i++) {
      if (!board.isHouse(i)) continue;
      const [x, y] = this.cellCenter(board, i);
      const s = this.view.cell * (0.11 + hash(i) * 0.06);
      this.lanterns.push({ x, y: y - s, vy: -(26 + hash(i + 9) * 22), s, ph: hash(i + 3) * 6.28, age: -(0.45 + flow.dist[i] * 0.05 + hash(i + 7) * 0.7), life: 16 });
    }
  }

  clearLanterns(): void {
    this.lanterns = [];
  }

  frame(scene: Scene, t: number, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const won = scene.wonAt >= 0 ? Math.min(1, (t - scene.wonAt) / 1.6) : 0;

    this.drawSky(t, won);
    this.skylineLit += (scene.skyline - this.skylineLit) * Math.min(1, dt * 2.5);
    this.drawSkyline();

    const { board, flow, anim } = scene;
    if (board && flow && anim) {
      const target = this.targetView(board, scene.insetTop, scene.insetBottom);
      if (this.viewFor !== board) {
        this.view = target;
        this.viewFor = board;
      } else {
        const k = 1 - Math.exp(-dt * 9);
        this.view = {
          cell: this.view.cell + (target.cell - this.view.cell) * k,
          ox: this.view.ox + (target.ox - this.view.ox) * k,
          oy: this.view.oy + (target.oy - this.view.oy) * k,
        };
      }
      for (let i = 0; i < anim.length; i++) {
        anim[i] *= Math.exp(-dt * 20);
        if (Math.abs(anim[i]) < 0.003) anim[i] = 0;
      }
      this.drawBoard(scene, board, flow, anim, t);
    }

    this.drawLanterns(scene.ambient, dt);
  }

  private drawSky(t: number, won: number): void {
    const ctx = this.ctx;
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, C.skyTop);
    sky.addColorStop(1, C.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.fillStyle = '#e8ecff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.ph)) * (1 - won * 0.4);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    const mx = this.w * 0.84, my = Math.min(90, this.h * 0.11), mr = 15;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18;
    ctx.drawImage(this.glow, mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4ecd0';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200, 190, 160, 0.35)';
    ctx.beginPath();
    ctx.arc(mx - 4, my - 3, 3.2, 0, Math.PI * 2);
    ctx.arc(mx + 5, my + 4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (won > 0) {
      const warm = ctx.createLinearGradient(0, this.h, 0, this.h * 0.25);
      warm.addColorStop(0, `rgba(255, 150, 60, ${0.2 * won})`);
      warm.addColorStop(1, 'rgba(255, 150, 60, 0)');
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawSkyline(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0d24';
    for (const b of this.buildings) ctx.fillRect(b.x, this.h - b.h, b.w, b.h);
    ctx.fillStyle = 'rgba(255, 205, 120, 0.8)';
    for (const b of this.buildings) {
      for (const win of b.wins) if (win.k < this.skylineLit) ctx.fillRect(b.x + win.x, this.h - b.h + win.y, 4, 5);
    }
  }

  private drawBoard(scene: Scene, board: Board, flow: Flow, anim: Float32Array, t: number): void {
    const ctx = this.ctx;
    const { cell, ox, oy } = this.view;
    const { w, h, source } = board.puzzle;
    const n = board.size;
    const half = cell / 2;
    const lw = Math.max(3, cell * 0.12);
    const wonFor = scene.wonAt >= 0 ? t - scene.wonAt : -1;

    // plate + cells
    ctx.fillStyle = C.plate;
    ctx.strokeStyle = wonFor >= 0 ? `rgba(255, 200, 120, ${0.1 + 0.25 * Math.min(1, wonFor)})` : C.plateEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRect(ctx, ox - 8, oy - 8, w * cell + 16, h * cell + 16, 14);
    ctx.fill();
    ctx.stroke();
    for (const locked of [0, 1]) {
      ctx.fillStyle = locked ? C.cellLocked : C.cell;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (board.locked[i] !== locked) continue;
        roundRect(ctx, ox + (i % w) * cell + 1.5, oy + Math.floor(i / w) * cell + 1.5, cell - 3, cell - 3, cell * 0.14);
      }
      ctx.fill();
    }

    // wires: collect half-segments (centre → edge), already rotated by the tap animation
    const on: number[] = [], off: number[] = [], dots: number[] = [], sparks: number[] = [], poles: number[] = [];
    const phase = t * cell * 1.5;
    for (let i = 0; i < n; i++) {
      const cx = ox + ((i % w) + 0.5) * cell, cy = oy + (Math.floor(i / w) + 0.5) * cell;
      const m = board.mask(i);
      const a = anim[i], cos = Math.cos(a), sin = Math.sin(a);
      const k = flow.dist[i];
      const list = k >= 0 ? on : off;
      for (const d of DIRS) {
        if (!(m & d)) continue;
        const [vx, vy] = VEC[d];
        const rx = vx * cos - vy * sin, ry = vx * sin + vy * cos;
        const ex = cx + rx * half, ey = cy + ry * half;
        list.push(cx, cy, ex, ey);
        if (k < 0) continue;
        if (flow.loose[i] & d) {
          sparks.push(ex, ey, i * 4 + d);
          continue;
        }
        // current flows away from the station: inward on the parent side, outward elsewhere
        const nx = i + (d === E ? 1 : d === W ? -1 : d === S ? w : -w);
        const inward = flow.dist[nx] === k - 1;
        const s0 = inward ? (k - 0.5) * cell : k * cell;
        const u = (((phase - s0) % half) + half) % half;
        const [sx, sy, dx, dy] = inward ? [ex, ey, -rx, -ry] : [cx, cy, rx, ry];
        dots.push(sx + dx * u, sy + dy * u);
      }
      if (i !== source && degree(m) === 3) poles.push(cx, cy, k >= 0 ? 1 : 0);
    }

    ctx.lineCap = 'round';
    const strokeSegs = (segs: number[]) => {
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 4) {
        ctx.moveTo(segs[j], segs[j + 1]);
        ctx.lineTo(segs[j + 2], segs[j + 3]);
      }
      ctx.stroke();
    };
    ctx.strokeStyle = C.wireOff;
    ctx.lineWidth = lw;
    strokeSegs(off);

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = C.glow;
    ctx.lineWidth = lw * 3.2;
    strokeSegs(on);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = C.wireOn;
    ctx.lineWidth = lw;
    strokeSegs(on);
    ctx.strokeStyle = C.wireCore;
    ctx.lineWidth = lw * 0.3;
    strokeSegs(on);

    for (let j = 0; j < poles.length; j += 3) {
      ctx.fillStyle = poles[j + 2] ? C.wireOn : C.wireOff;
      ctx.beginPath();
      ctx.arc(poles[j], poles[j + 1], lw * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff6dc';
    ctx.beginPath();
    for (let j = 0; j < dots.length; j += 2) {
      ctx.moveTo(dots[j] + lw * 0.34, dots[j + 1]);
      ctx.arc(dots[j], dots[j + 1], lw * 0.34, 0, Math.PI * 2);
    }
    ctx.fill();

    // sparks where a live wire ends in the air
    const flick = Math.floor(t * 18);
    for (let j = 0; j < sparks.length; j += 3) {
      const x = sparks[j], y = sparks[j + 1], seed = sparks[j + 2] * 7.1 + flick;
      ctx.globalAlpha = 0.5 + hash(seed) * 0.5;
      const gs = lw * (2.2 + hash(seed + 1) * 1.6);
      ctx.drawImage(this.glow, x - gs, y - gs, gs * 2, gs * 2);
      ctx.fillStyle = '#fff1b8';
      for (let p = 0; p < 3; p++) {
        const ang = hash(seed + p * 3.3) * 6.28, r = hash(seed + p * 5.1) * lw * 1.5;
        ctx.fillRect(x + Math.cos(ang) * r - 1, y + Math.sin(ang) * r - 1, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // next step of a walkthrough: the target shape, dashed, under a breathing ring
    if (scene.preview && scene.preview.i < n) {
      const { i, mask } = scene.preview;
      const cx = ox + ((i % w) + 0.5) * cell, cy = oy + (Math.floor(i / w) + 0.5) * cell;
      ctx.beginPath();
      for (const d of DIRS) {
        if (!(mask & d)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + VEC[d][0] * half, cy + VEC[d][1] * half);
      }
      // a dark underlay keeps the target readable even over a glowing wire
      ctx.strokeStyle = 'rgba(8, 11, 30, 0.85)';
      ctx.lineWidth = Math.max(4, lw * 0.95);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.95)';
      ctx.lineWidth = Math.max(2, lw * 0.4);
      ctx.setLineDash([lw * 0.7, lw * 0.6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // homes and the station sit upright on top of their wire stub
    for (let i = 0; i < n; i++) {
      const isSource = i === source;
      if (!isSource && !board.isHouse(i)) continue;
      const cx = ox + ((i % w) + 0.5) * cell, cy = oy + (Math.floor(i / w) + 0.5) * cell;
      const lit = flow.dist[i] >= 0;
      const flash = wonFor >= 0 ? Math.max(0, Math.sin(Math.min(1, Math.max(0, (wonFor - flow.dist[i] * 0.05) / 0.7)) * Math.PI)) : 0;
      if (lit) {
        const gs = cell * (isSource ? 0.95 + 0.08 * Math.sin(t * 3) : 0.7) * (1 + flash * 0.6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (isSource ? 0.7 : 0.5) + flash * 0.4;
        ctx.drawImage(this.glow, cx - gs, cy - gs, gs * 2, gs * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (isSource) this.drawStation(cx, cy, cell, t);
      else this.drawHouse(cx, cy, cell * 0.62, lit, ROOFS[Math.floor(hash(i * 1.37 + w) * ROOFS.length)]);
    }

    // lock pins, hover, keyboard cursor and the last-changed tile
    const sinceFocus = t - scene.focusAt;
    for (let i = 0; i < n; i++) {
      if (!board.locked[i]) continue;
      const x = ox + (i % w) * cell, y = oy + Math.floor(i / w) * cell;
      const shake = i === scene.focus && scene.focusKind === 2 && sinceFocus < 0.35 ? Math.sin(sinceFocus * 60) * 2 * (1 - sinceFocus / 0.35) : 0;
      ctx.fillStyle = scene.hintLocked.has(i) ? C.pinHint : C.pin;
      ctx.beginPath();
      ctx.arc(x + cell * 0.16 + shake, y + cell * 0.16, Math.max(2.2, cell * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
    const outline = (i: number, color: string, width: number) => {
      if (i < 0 || i >= n) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      roundRect(ctx, ox + (i % w) * cell + 2, oy + Math.floor(i / w) * cell + 2, cell - 4, cell - 4, cell * 0.13);
      ctx.stroke();
    };
    if (wonFor < 0) {
      outline(scene.hover, 'rgba(255, 255, 255, 0.16)', 1.5);
      outline(scene.cursor, 'rgba(255, 207, 107, 0.85)', 2);
    }
    if (scene.preview && scene.preview.i < n) {
      ctx.setLineDash([6, 5]);
      outline(scene.preview.i, `rgba(255, 214, 140, ${0.6 + 0.35 * Math.sin(t * 5)})`, 2.5);
      ctx.setLineDash([]);
    }
    if (scene.focus >= 0 && scene.focus < n && sinceFocus < 0.8) {
      const fade = 1 - sinceFocus / 0.8;
      const rgb = scene.focusKind === 1 ? '127, 216, 255' : scene.focusKind === 2 ? '169, 184, 240' : '255, 214, 140';
      outline(scene.focus, `rgba(${rgb}, ${0.9 * fade})`, 2 + 2 * fade);
    }
  }

  private drawHouse(x: number, y: number, s: number, lit: boolean, roof: string): void {
    const ctx = this.ctx;
    const bw = s * 0.66, bh = s * 0.46;
    const top = y - bh * 0.2;
    ctx.fillStyle = lit ? '#4a3d4e' : '#1e2342';
    ctx.fillRect(x + bw * 0.16, top - s * 0.3, s * 0.09, s * 0.2);
    ctx.fillStyle = lit ? C.bodyLit : C.body;
    ctx.fillRect(x - bw / 2, top, bw, bh);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2 - s * 0.09, top + 1);
    ctx.lineTo(x, top - s * 0.34);
    ctx.lineTo(x + bw / 2 + s * 0.09, top + 1);
    ctx.closePath();
    ctx.fill();
    if (!lit) {
      ctx.fillStyle = 'rgba(6, 9, 26, 0.55)';
      ctx.fill();
    }
    const ws = bw * 0.24;
    ctx.fillStyle = lit ? C.windowLit : C.window;
    ctx.fillRect(x - bw * 0.25 - ws / 2, top + bh * 0.24, ws, ws);
    ctx.fillRect(x + bw * 0.25 - ws / 2, top + bh * 0.24, ws, ws);
  }

  private drawStation(x: number, y: number, cell: number, t: number): void {
    const ctx = this.ctx;
    const r = cell * 0.3;
    ctx.strokeStyle = `rgba(255, 214, 130, ${0.35 + 0.25 * Math.sin(t * 3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * (1.25 + 0.06 * Math.sin(t * 3)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.station;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.bolt;
    ctx.beginPath();
    const pts = [0.18, -0.72, -0.38, 0.1, -0.03, 0.1, -0.16, 0.72, 0.4, -0.12, 0.05, -0.12];
    for (let j = 0; j < pts.length; j += 2) ctx.lineTo(x + pts[j] * r, y + pts[j + 1] * r);
    ctx.closePath();
    ctx.fill();
  }

  private drawLanterns(ambient: boolean, dt: number): void {
    const ctx = this.ctx;
    if (ambient) {
      this.spawnClock -= dt;
      if (this.spawnClock <= 0 && this.lanterns.length < 40) {
        this.spawnClock = 0.9 + Math.random() * 1.4;
        this.lanterns.push({ x: Math.random() * this.w, y: this.h + 20, vy: -(16 + Math.random() * 16), s: 4 + Math.random() * 5, ph: Math.random() * 6.28, age: 0, life: 60 });
      }
    }
    const keep: Lantern[] = [];
    for (const l of this.lanterns) {
      l.age += dt;
      if (l.age < 0) {
        keep.push(l);
        continue;
      }
      l.y += l.vy * dt;
      l.x += Math.sin(l.age * 0.9 + l.ph) * 5 * dt;
      if (l.age > l.life || l.y < -40) continue;
      keep.push(l);
      const fade = Math.min(1, l.age / 0.6, (l.life - l.age) / 1.5);
      const fl = 0.85 + 0.15 * Math.sin(l.age * 9 + l.ph);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * fade * fl;
      ctx.drawImage(this.glow, l.x - l.s * 2.6, l.y - l.s * 2.6, l.s * 5.2, l.s * 5.2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ffb44f';
      ctx.beginPath();
      ctx.moveTo(l.x - l.s * 0.42, l.y - l.s * 0.62);
      ctx.lineTo(l.x + l.s * 0.42, l.y - l.s * 0.62);
      ctx.lineTo(l.x + l.s * 0.32, l.y + l.s * 0.55);
      ctx.lineTo(l.x - l.s * 0.32, l.y + l.s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff1c2';
      ctx.fillRect(l.x - l.s * 0.14, l.y + l.s * 0.3, l.s * 0.28, l.s * 0.22);
    }
    ctx.globalAlpha = 1;
    this.lanterns = keep;
  }
}
