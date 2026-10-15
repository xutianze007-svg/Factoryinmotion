// Screen-space tile grid (the lens). Same model as version 1: nested tiers, an organic field
// around the cursor, element wraps, corridors along relations, eased per-cell state with a
// short "processing" phase. Output is an RG8 atlas the composite shader samples.

import { createNoise, hash3 } from '../shared/noise';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
}

export interface Corridor {
  pts: { x: number; y: number }[];
  w: number;
  v: number;
}

export interface GridParams {
  lensX: number;
  lensY: number;
  radius: number;
  presence: number;
  organic: number;
  drift: number;
  diamond: number;
  jitter: number;
  attack: number;
  release: number;
  processing: number;
  time: number;
  regions: Region[];
  corridors: Corridor[];
  /** radial reveal wave from (x, y), t in 0..1 */
  wave: { x: number; y: number; t: number } | null;
}

interface Level {
  s: number;
  cols: number;
  rows: number;
  a: Float32Array;
  p: Float32Array;
  tg: Uint8Array;
  yOff: number;
}

const THRESHOLDS: Record<number, number[]> = { 1: [0.4], 2: [0.56, 0.3], 3: [0.64, 0.44, 0.22] };
const BUCKETS = 8;

function distToPolyline(px: number, py: number, pts: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x;
    const ay = pts[i - 1].y;
    const bx = pts[i].x - ax;
    const by = pts[i].y - ay;
    const l2 = bx * bx + by * by;
    let t = l2 > 0 ? ((px - ax) * bx + (py - ay) * by) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + bx * t);
    const dy = py - (ay + by * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export class LensGrid {
  levels: Level[] = [];
  atlas = new Uint8Array(4);
  atlasW = 1;
  atlasH = 1;
  originX = 0;
  originY = 0;
  cell = 32;
  vw = 0;
  vh = 0;
  private noise = createNoise(19);
  private noiseBuf = new Float32Array(4096);

  resize(vw: number, vh: number, cell: number, tiers: number) {
    if (vw === this.vw && vh === this.vh && cell === this.cell && tiers === this.levels.length) return;
    this.vw = vw;
    this.vh = vh;
    this.cell = cell;
    let cols0 = Math.ceil(vw / cell);
    if (cols0 % 2) cols0++;
    let rows0 = Math.ceil(vh / cell);
    if (rows0 % 2) rows0++;
    this.originX = Math.round((vw - cols0 * cell) / 2);
    this.originY = Math.round((vh - rows0 * cell) / 2);
    this.levels = [];
    let yOff = 0;
    for (let L = 0; L < tiers; L++) {
      const s = cell / (1 << L);
      const cols = cols0 << L;
      const rows = rows0 << L;
      this.levels.push({ s, cols, rows, a: new Float32Array(cols * rows), p: new Float32Array(cols * rows), tg: new Uint8Array(cols * rows), yOff });
      yOff += rows;
    }
    this.atlasW = this.levels[this.levels.length - 1].cols;
    this.atlasH = yOff;
    this.atlas = new Uint8Array(this.atlasW * this.atlasH * 2);
  }

  /** Coverage (0..1) of the lens at a screen point — used to decide which labels to show. */
  coverage(x: number, y: number) {
    let m = 0;
    for (const lv of this.levels) {
      const c = Math.floor((x - this.originX) / lv.s);
      const r = Math.floor((y - this.originY) / lv.s);
      if (c < 0 || r < 0 || c >= lv.cols || r >= lv.rows) continue;
      m = Math.max(m, lv.a[r * lv.cols + c]);
    }
    return m;
  }

  update(dt: number, P: GridParams) {
    const thr = THRESHOLDS[this.levels.length] ?? THRESHOLDS[3];
    const R = P.radius;
    const Rf = R * 1.25;
    const nz = this.noise.noise3;
    const ns = 1 / (R * 0.85);
    const tz = P.time * P.drift;
    const fine = this.levels.length ? this.levels[this.levels.length - 1].s : this.cell;
    const fall = fine * 0.85;
    const atk = new Float32Array(BUCKETS);
    const rel = new Float32Array(BUCKETS);
    for (let b = 0; b < BUCKETS; b++) {
      const h = (b + 0.5) / BUCKETS;
      atk[b] = 1 - Math.exp(-P.attack * (0.75 + 0.5 * h) * dt);
      rel[b] = Math.exp(-P.release * (0.85 + 0.3 * (1 - h)) * dt);
    }
    const lensOn = P.presence > 0.005;
    const lx0 = P.lensX - Rf * 1.7;
    const lx1 = P.lensX + Rf * 1.7;
    const ly0 = P.lensY - Rf * 1.7;
    const ly1 = P.lensY + Rf * 1.7;

    // coarse noise lattice
    const NG = 24;
    let ngx0 = 0;
    let ngy0 = 0;
    let ngw = 0;
    let ngh = 0;
    let haveNoise = false;
    if (lensOn && P.organic > 0) {
      const x0 = Math.max(lx0, -NG);
      const x1 = Math.min(lx1, this.vw + NG);
      const y0 = Math.max(ly0, -NG);
      const y1 = Math.min(ly1, this.vh + NG);
      if (x1 > x0 && y1 > y0) {
        ngx0 = Math.floor(x0 / NG);
        ngy0 = Math.floor(y0 / NG);
        ngw = Math.floor(x1 / NG) - ngx0 + 2;
        ngh = Math.floor(y1 / NG) - ngy0 + 2;
        if (this.noiseBuf.length < ngw * ngh) this.noiseBuf = new Float32Array(ngw * ngh * 2);
        const nb = this.noiseBuf;
        for (let j = 0; j < ngh; j++)
          for (let i = 0; i < ngw; i++) {
            const px = (ngx0 + i) * NG;
            const py = (ngy0 + j) * NG;
            nb[j * ngw + i] = nz(px * ns, py * ns, tz) + 0.15 * nz(px * ns * 2.3, py * ns * 2.3, tz * 1.4 + 9);
          }
        haveNoise = true;
      }
    }
    const nb = this.noiseBuf;
    const sampleNoise = (x: number, y: number) => {
      let fx = x / NG - ngx0;
      let fy = y / NG - ngy0;
      fx = fx < 0 ? 0 : fx > ngw - 1.001 ? ngw - 1.001 : fx;
      fy = fy < 0 ? 0 : fy > ngh - 1.001 ? ngh - 1.001 : fy;
      const i = fx | 0;
      const j = fy | 0;
      const tx = fx - i;
      const ty = fy - j;
      const k = j * ngw + i;
      const a = nb[k];
      const b = nb[k + 1];
      const c = nb[k + ngw];
      const d = nb[k + ngw + 1];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };

    const corr = P.corridors.map((c) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const p of c.pts) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      return { ...c, x0: x0 - c.w, y0: y0 - c.w, x1: x1 + c.w, y1: y1 + c.w };
    });
    const W = P.wave;
    const waveR = W ? W.t * Math.hypot(this.vw, this.vh) * 1.05 : 0;
    const waveW = Math.max(this.vw, this.vh) * 0.11;
    const waveV = W ? 0.98 * (1 - W.t * 0.4) : 0;

    const AW = this.atlasW;
    const atlas = this.atlas;
    let active = 0;
    for (let li = 0; li < this.levels.length; li++) {
      const lv = this.levels[li];
      const s = lv.s;
      const t0 = thr[li];
      for (let r = 0; r < lv.rows; r++) {
        const cy = this.originY + (r + 0.5) * s;
        const rowLens = lensOn && cy > ly0 && cy < ly1;
        let rowRegion = false;
        for (const g of P.regions) if (cy > g.y - fall && cy < g.y + g.h + fall) rowRegion = true;
        let rowCorr = false;
        for (const c of corr) if (cy > c.y0 && cy < c.y1) rowCorr = true;
        const rowWave = !!W && Math.abs(cy - W.y) < waveR + waveW;
        const anyRow = rowLens || rowRegion || rowCorr || rowWave;
        const base = r * lv.cols;
        const ay = (lv.yOff + r) * AW * 2;
        for (let c = 0; c < lv.cols; c++) {
          const idx = base + c;
          let a = lv.a[idx];
          let p = lv.p[idx];
          let f = 0;
          let fromWave = false;
          if (anyRow) {
            const cx = this.originX + (c + 0.5) * s;
            if (rowLens && cx > lx0 && cx < lx1) {
              const dx = cx - P.lensX;
              const dy = cy - P.lensY;
              const e = Math.sqrt(dx * dx + dy * dy);
              const m = (Math.abs(dx) + Math.abs(dy)) * 0.78;
              let d = (e + (m - e) * P.diamond) / Rf;
              if (P.organic > 0 && d < 1.6) {
                const n = haveNoise ? sampleNoise(cx, cy) : nz(cx * ns, cy * ns, tz);
                d *= 1 + P.organic * 0.55 * n;
              }
              const fl = (1 - d) * P.presence;
              if (fl > f) f = fl;
            }
            if (rowRegion)
              for (const g of P.regions) {
                const dxo = Math.max(g.x - cx, 0, cx - (g.x + g.w));
                const dyo = Math.max(g.y - cy, 0, cy - (g.y + g.h));
                const dout = Math.max(dxo, dyo);
                if (dout < fall) {
                  const v = g.s * (1 - dout / fall);
                  if (v > f) f = v;
                }
              }
            if (rowCorr && f < 0.6)
              for (const co of corr) {
                if (cx < co.x0 || cx > co.x1 || cy < co.y0 || cy > co.y1) continue;
                const d = distToPolyline(cx, cy, co.pts) / co.w;
                if (d < 1) {
                  const v = co.v * (1 - d * d);
                  if (v > f) f = v;
                }
              }
            if (rowWave && W) {
              const dw = Math.abs(Math.hypot(cx - W.x, cy - W.y) - waveR);
              if (dw < waveW) {
                const v = waveV * (1 - dw / waveW);
                if (v > f) {
                  f = v;
                  fromWave = true;
                }
              }
            }
          }
          const h = hash3(c, r, li * 7 + 1);
          const b = (h * BUCKETS) | 0;
          const on = f > t0 + (h - 0.5) * P.jitter;
          if (on) {
            // the intro wave reveals cleanly; only attention scans cell by cell
            if (!lv.tg[idx] && a < 0.5 && !fromWave) p = P.processing > 0 ? 1 : 0;
            a += (1 - a) * atk[b];
            lv.tg[idx] = 1;
          } else {
            lv.tg[idx] = 0;
            if (a > 0) {
              a *= rel[b];
              if (a < 0.035) a = 0;
            }
          }
          if (p > 0) {
            p = P.processing > 0 ? p - dt / P.processing : 0;
            if (p < 0) p = 0;
          }
          lv.a[idx] = a;
          lv.p[idx] = p;
          if (a > 0 || p > 0) active++;
          const o = ay + c * 2;
          atlas[o] = (a * 255) | 0;
          atlas[o + 1] = (p * 255) | 0;
        }
      }
    }
    return active;
  }

  /** Corridor strength that lands between the two finest tiers (one strand of small tiles). */
  corridorValue() {
    const t = THRESHOLDS[this.levels.length] ?? THRESHOLDS[3];
    return t.length > 1 ? (t[t.length - 1] + t[t.length - 2]) / 2 : t[0] + 0.12;
  }

  fineSize() {
    return this.levels.length ? this.levels[this.levels.length - 1].s : this.cell;
  }
}
