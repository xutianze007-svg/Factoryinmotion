// DOM layer: telemetry, labels on revealed road users, and the
// verdict-first reading card (with a leader line to what it describes).

import type { Reading } from '../intel/analyst';

const GLYPHS = '▚▞▙▟▛▜░▒/\\<>_-=+*#01';
const LEVEL: Record<Reading['verdict'], string> = { safe: 'Safe', note: 'Note', caution: 'Caution', risk: 'Risk' };
const ICON: Record<Reading['verdict'], string> = { safe: '●', note: '◆', caution: '▲', risk: '■' };
const TONE_ICON = { risk: '≠', caution: '▲', info: '↳' } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Decode {
  el: HTMLElement;
  text: string;
  start: number;
  done: boolean;
}

export interface Telemetry {
  tracked: number;
  risks: number;
  ns: string;
  ew: string;
  nsT: number;
  ewT: number;
  fps: number;
  points: number;
  tracking: string | null;
  alert: string | null;
}

export class Hud {
  readonly root: HTMLDivElement;
  private card: HTMLDivElement;
  private cardId = '';
  private cardHead = '';
  private decodes: Decode[] = [];
  private vis = 0;
  private pos = { x: 0, y: 0, init: false };
  private leader: SVGPathElement;
  private leaderDot: SVGCircleElement;
  private labels: HTMLDivElement[] = [];
  private tel: HTMLDivElement;
  private trackChip: HTMLDivElement;
  private scale = 1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ms-hud', parent);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ms-wires');
    this.leader = document.createElementNS(svgNS, 'path');
    this.leader.setAttribute('class', 'ms-leader');
    this.leaderDot = document.createElementNS(svgNS, 'circle');
    this.leaderDot.setAttribute('class', 'ms-leader-dot');
    this.leaderDot.setAttribute('r', '3.5');
    svg.append(this.leader, this.leaderDot);
    this.root.appendChild(svg);

    this.tel = el('div', 'ms-tel', this.root);
    el('div', 'ms-hint', this.root, '<span>Move</span> look · <span>Click</span> track · <span>Drag</span> rotate · <span>Scroll</span> pan · <span>Pinch</span> zoom · <span>Space</span> slow time · <span>1 2</span> LiDAR / depth');
    this.trackChip = el('div', 'ms-track', this.root);
    this.card = el('div', 'ms-card', this.root);
  }

  /** Scales every HUD element (tags, card, leader, telemetry) — for legible screen captures. */
  setScale(s: number) {
    if (s === this.scale) return;
    this.scale = s;
    this.root.style.setProperty('--ui', String(s));
    this.leader.style.strokeWidth = String(1.25 * s);
    this.leaderDot.style.strokeWidth = String(1.25 * s);
    this.leaderDot.setAttribute('r', String(3.5 * s));
  }

  /** Telemetry and hints — hide them for clean footage. */
  setPanels(on: boolean) {
    this.root.classList.toggle('is-bare', !on);
  }

  setLoaded() {
    this.root.classList.add('is-ready');
  }

  telemetry(t: Telemetry) {
    const dot = (l: string) => `<i class="ms-l ms-l--${l}"></i>`;
    const html = `
      <div class="ms-tel__row"><span>tracked</span><b>${String(t.tracked).padStart(2, '0')}</b></div>
      <div class="ms-tel__row"><span>conflicts</span><b class="${t.risks ? 'is-hot' : ''}">${String(t.risks).padStart(2, '0')}</b></div>
      <div class="ms-tel__row"><span>N–S</span><b>${dot(t.ns)}${t.nsT.toFixed(1)}s</b></div>
      <div class="ms-tel__row"><span>E–W</span><b>${dot(t.ew)}${t.ewT.toFixed(1)}s</b></div>
      <div class="ms-tel__row"><span>returns</span><b>${(t.points / 1000).toFixed(0)}k</b></div>
      <div class="ms-tel__row"><span>frame</span><b>${t.fps.toFixed(0)} fps</b></div>
      <div class="ms-tel__alert${t.alert ? ' is-on' : ''}"><i>■</i>${t.alert ? t.alert : 'No conflicts predicted'}</div>`;
    if (this.tel.dataset.h !== html) {
      this.tel.innerHTML = html;
      this.tel.dataset.h = html;
    }
    this.trackChip.classList.toggle('is-on', !!t.tracking);
    if (t.tracking) {
      const txt = `◉ Tracking ${t.tracking} — click empty street or Esc to release`;
      if (this.trackChip.textContent !== txt) this.trackChip.textContent = txt;
    }
  }

  labelsRender(items: { code: string; sub: string; x: number; y: number; tone: string; a: number }[]) {
    // greedy de-overlap: stack colliding tags upwards
    const s = this.scale;
    const th = 19 * s;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = items.map((_, i) => i).sort((a, b) => items[b].y - items[a].y);
    for (const i of order) {
      const it = items[i];
      const w = ((it.code.length + it.sub.length) * 6.1 + 36) * s;
      let y = it.y;
      for (let k = 0; k < 5; k++) {
        const hit = placed.some((p) => it.x - w / 2 < p.x1 && it.x + w / 2 > p.x0 && y - th < p.y1 && y > p.y0);
        if (!hit) break;
        y -= 21 * s;
      }
      it.y = y;
      placed.push({ x0: it.x - w / 2, x1: it.x + w / 2, y0: y - th, y1: y });
    }
    for (let i = 0; i < items.length; i++) {
      let l = this.labels[i];
      if (!l) {
        l = el('div', 'ms-tag', this.root);
        this.labels.push(l);
      }
      const it = items[i];
      const html = `<i class="ms-tag__d ms-tag__d--${it.tone}"></i>${it.code}<em>${it.sub}</em>`;
      if (l.dataset.h !== html) {
        l.innerHTML = html;
        l.dataset.h = html;
      }
      l.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -100%) scale(${s})`;
      l.style.opacity = String(it.a);
    }
    for (let i = items.length; i < this.labels.length; i++) this.labels[i].style.opacity = '0';
  }

  private build(r: Reading, time: number) {
    const facts = r.facts
      .map((f) => `<div class="ms-kv${f.hot ? ' is-hot' : ''}"><span class="k">${esc(f.k)}</span><span class="v" data-v>${esc(f.v)}</span></div>`)
      .join('');
    const rels = r.relations
      .map(
        (x) =>
          `<div class="ms-rel ms-rel--${x.tone}"><i>${TONE_ICON[x.tone]}</i><span class="k">${esc(x.label)}</span><span class="v">${esc(x.target)}</span>${x.detail ? `<em>${esc(x.detail)}</em>` : ''}</div>`,
      )
      .join('');
    this.card.dataset.sev = r.verdict;
    this.card.innerHTML = `
      <div class="ms-sev"><span class="ms-lvl"><i>${ICON[r.verdict]}</i><span data-d>${LEVEL[r.verdict]}</span></span><span class="ms-code">${esc(r.code)}</span></div>
      <div class="ms-head" data-d>${esc(r.headline)}</div>
      <div class="ms-body">
        <p class="ms-sum" data-d>${esc(r.summary)}</p>
        <div class="ms-subj"><span>on</span>${esc(r.kind)} · ${esc(r.code)}</div>
        <div class="ms-facts">${facts}</div>
        ${rels ? `<div class="ms-rels">${rels}</div>` : ''}
      </div>`;
    this.decodes = [];
    let i = 0;
    this.card.querySelectorAll<HTMLElement>('[data-d]').forEach((e) => {
      this.decodes.push({ el: e, text: e.textContent || '', start: time + i * 0.05, done: false });
      e.textContent = '';
      i++;
    });
  }

  private patch(r: Reading, time: number) {
    if (r.headline !== this.cardHead) {
      // the situation changed — re-decode the verdict
      this.build(r, time);
      this.cardHead = r.headline;
      return;
    }
    const vs = this.card.querySelectorAll<HTMLElement>('[data-v]');
    r.facts.forEach((f, i) => {
      const e = vs[i];
      if (e && e.textContent !== f.v) e.textContent = f.v;
      e?.parentElement?.classList.toggle('is-hot', !!f.hot);
    });
    const sum = this.card.querySelector<HTMLElement>('.ms-sum');
    const d = this.decodes.find((x) => x.el === sum);
    if (sum && d?.done && sum.textContent !== r.summary) {
      sum.textContent = r.summary;
      d.text = r.summary;
    }
  }

  cardRender(r: Reading | null, cursor: { x: number; y: number }, anchor: { x: number; y: number } | null, vw: number, vh: number, dt: number, time: number) {
    const want = !!r;
    if (r) {
      if (r.id !== this.cardId) {
        this.cardId = r.id;
        this.cardHead = r.headline;
        this.build(r, time);
      } else this.patch(r, time);
    }
    this.vis += ((want ? 1 : 0) - this.vis) * (1 - Math.exp(-dt * (want ? 14 : 10)));
    if (!want && this.vis < 0.02) {
      this.vis = 0;
      this.card.style.visibility = 'hidden';
      this.leader.setAttribute('d', '');
      this.leaderDot.style.opacity = '0';
      this.cardId = '';
      this.pos.init = false;
      return;
    }
    this.card.style.visibility = 'visible';
    const s = this.scale;
    const w = (this.card.offsetWidth || 320) * s;
    const h = (this.card.offsetHeight || 300) * s;
    const off = 30 * s;
    let tx = cursor.x + off;
    if (tx + w > vw - 16) tx = cursor.x - off - w;
    let ty = cursor.y - h * 0.3;
    ty = Math.max(16, Math.min(vh - h - 16, ty));
    tx = Math.max(16, tx);
    if (!this.pos.init) {
      this.pos.x = tx;
      this.pos.y = ty;
      this.pos.init = true;
    }
    const k = 1 - Math.exp(-dt * 14);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (ty - this.pos.y) * k;
    const e = 1 - Math.pow(1 - this.vis, 3);
    this.card.style.opacity = String(e);
    this.card.style.transform = `translate(${Math.round(this.pos.x)}px, ${Math.round(this.pos.y + (1 - e) * 8 * s)}px) scale(${s})`;

    if (anchor && want) {
      const left = anchor.x < this.pos.x + w / 2;
      const sx = left ? this.pos.x : this.pos.x + w;
      const sy = Math.min(Math.max(anchor.y, this.pos.y + 20 * s), this.pos.y + 44 * s);
      const mx = sx + (left ? -22 : 22) * s;
      this.leader.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)}H${mx.toFixed(1)}L${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)}`);
      this.leader.style.opacity = String(e);
      this.leaderDot.setAttribute('cx', anchor.x.toFixed(1));
      this.leaderDot.setAttribute('cy', anchor.y.toFixed(1));
      this.leaderDot.style.opacity = String(e);
    } else {
      this.leader.setAttribute('d', '');
      this.leaderDot.style.opacity = '0';
    }

    for (const d of this.decodes) {
      if (d.done) continue;
      const t = time - d.start;
      if (t < 0) continue;
      const n = Math.floor(t * 85);
      if (n >= d.text.length) {
        d.el.textContent = d.text;
        d.done = true;
        continue;
      }
      let s = d.text.slice(0, n);
      const rem = Math.min(d.text.length - n, 8);
      for (let i = 0; i < rem; i++) s += d.text[n + i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      d.el.textContent = s;
    }
  }
}
