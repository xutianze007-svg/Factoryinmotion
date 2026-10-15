// World-space intelligence graphics.
//  overlay layer (always visible): relation arcs + a ring under the focused road user
//  machine layer (inside the lens): predicted-path ribbons for everyone, future "ghosts"

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CLASS, LAYER_MACHINE, LAYER_OVERLAY } from '../world/materials';
import type { Agent } from '../world/traffic';
import { predict, type Relation } from './analyst';

const TONE: Record<Relation['tone'], THREE.Color> = {
  risk: new THREE.Color(6, 0.45, 0.3),
  caution: new THREE.Color(5, 2.6, 0.3),
  info: new THREE.Color(0.5, 2.6, 3.6),
};

interface Arc {
  line: Line2;
  geo: LineGeometry;
  mat: LineMaterial;
  head: THREE.Mesh;
  alpha: number;
  key: string;
}

export class IntelVisuals {
  readonly group = new THREE.Group();
  private arcs: Arc[] = [];
  private ring: Line2;
  private ringMat: LineMaterial;
  private ringGeo: LineGeometry;
  private ringAlpha = 0;
  private traj: THREE.Mesh;
  private trajGeo = new THREE.BufferGeometry();
  private trajPos: Float32Array;
  private trajCol: Float32Array;
  private ghosts: THREE.LineSegments[] = [];
  private ghostGeo = new Map<string, THREE.BufferGeometry>();
  private res = new THREE.Vector2(1, 1);
  private alerts: { ring: Line2; mat: LineMaterial; link: Line2; linkGeo: LineGeometry; linkMat: LineMaterial }[] = [];
  private headGeo = new THREE.OctahedronGeometry(0.32, 0);

  constructor() {
    for (let i = 0; i < 4; i++) {
      const geo = new LineGeometry();
      geo.setPositions(Array.from({ length: 33 * 3 }, () => 0));
      const mat = new LineMaterial({
        color: 0xffffff,
        linewidth: 2.2,
        transparent: true,
        dashed: true,
        dashSize: 1.2,
        gapSize: 0.7,
        depthTest: false,
        worldUnits: false,
      });
      const line = new Line2(geo, mat);
      line.layers.set(LAYER_OVERLAY);
      line.frustumCulled = false;
      line.visible = false;
      const head = new THREE.Mesh(this.headGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }));
      head.layers.set(LAYER_OVERLAY);
      head.visible = false;
      this.group.add(line, head);
      this.arcs.push({ line, geo, mat, head, alpha: 0, key: '' });
    }
    this.ringGeo = new LineGeometry();
    const ringPts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(Math.cos(a), 0, Math.sin(a));
    }
    this.ringGeo.setPositions(ringPts);
    this.ringMat = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthTest: false, dashed: true, dashSize: 0.18, gapSize: 0.1, worldUnits: false });
    this.ring = new Line2(this.ringGeo, this.ringMat);
    this.ring.computeLineDistances();
    this.ring.layers.set(LAYER_OVERLAY);
    this.ring.visible = false;
    this.group.add(this.ring);

    // alert rings + danger links for conflicts anywhere on screen
    for (let i = 0; i < 6; i++) {
      const mat = new LineMaterial({ color: 0xffffff, linewidth: 2.4, transparent: true, depthTest: false, worldUnits: false });
      mat.color.copy(TONE.risk);
      const ring = new Line2(this.ringGeo, mat);
      ring.layers.set(LAYER_OVERLAY);
      ring.visible = false;
      ring.frustumCulled = false;
      const linkGeo = new LineGeometry();
      linkGeo.setPositions([0, 0, 0, 1, 0, 0]);
      const linkMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, transparent: true, depthTest: false, dashed: true, dashSize: 0.6, gapSize: 0.45, worldUnits: false });
      linkMat.color.copy(TONE.risk);
      const link = new Line2(linkGeo, linkMat);
      link.layers.set(LAYER_OVERLAY);
      link.visible = false;
      link.frustumCulled = false;
      this.group.add(ring, link);
      this.alerts.push({ ring, mat, link, linkGeo, linkMat });
    }

    // trajectory ribbons
    const MAXQ = 90 * 18;
    this.trajPos = new Float32Array(MAXQ * 6 * 3);
    this.trajCol = new Float32Array(MAXQ * 6 * 3);
    this.trajGeo.setAttribute('position', new THREE.BufferAttribute(this.trajPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trajGeo.setAttribute('color', new THREE.BufferAttribute(this.trajCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.traj = new THREE.Mesh(
      this.trajGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.traj.layers.set(LAYER_MACHINE);
    this.traj.frustumCulled = false;
    this.group.add(this.traj);
  }

  setResolution(w: number, h: number) {
    this.res.set(w, h);
    for (const a of this.alerts) {
      a.mat.resolution.set(w, h);
      a.linkMat.resolution.set(w, h);
    }
    for (const a of this.arcs) a.mat.resolution.copy(this.res);
    this.ringMat.resolution.copy(this.res);
  }

  /** Relation arcs from `from` to each relation target; returns their sampled world paths. */
  updateLinks(dt: number, time: number, from: THREE.Vector3 | null, rels: Relation[], show: boolean) {
    const paths: THREE.Vector3[][] = [];
    const tmp = new THREE.Vector3();
    this.arcs.forEach((arc, i) => {
      const r = show && from ? rels[i] : undefined;
      const want = r ? 1 : 0;
      const key = r ? r.target : arc.key;
      if (r && key !== arc.key) {
        arc.key = key;
        arc.alpha = 0;
      }
      arc.alpha += (want - arc.alpha) * (1 - Math.exp(-dt * (want ? 8 : 10)));
      const vis = arc.alpha > 0.01 && !!from && (r || arc.key);
      arc.line.visible = !!vis && !!r;
      arc.head.visible = arc.line.visible;
      if (!r || !from) return;
      const a = from;
      const b = r.to;
      const dist = a.distanceTo(b);
      const lift = 2.5 + dist * 0.28;
      const mid = tmp.copy(a).add(b).multiplyScalar(0.5);
      mid.y = Math.max(a.y, b.y) + lift;
      const pts: number[] = [];
      const path: THREE.Vector3[] = [];
      const grow = Math.min(1, arc.alpha * 1.4);
      for (let k = 0; k <= 32; k++) {
        const t = (k / 32) * grow;
        const u = 1 - t;
        const x = u * u * a.x + 2 * u * t * mid.x + t * t * b.x;
        const y = u * u * a.y + 2 * u * t * mid.y + t * t * b.y;
        const z = u * u * a.z + 2 * u * t * mid.z + t * t * b.z;
        pts.push(x, y, z);
        path.push(new THREE.Vector3(x, y, z));
      }
      arc.geo.setPositions(pts);
      arc.line.computeLineDistances();
      const c = TONE[r.tone];
      arc.mat.color.copy(c);
      arc.mat.opacity = Math.min(1, arc.alpha);
      arc.mat.dashOffset = -time * 3.2;
      const end = path[path.length - 1];
      arc.head.position.copy(end);
      arc.head.rotation.set(time * 2, time * 3, 0);
      (arc.head.material as THREE.MeshBasicMaterial).color.copy(c);
      (arc.head.material as THREE.MeshBasicMaterial).opacity = arc.alpha;
      paths.push(path);
    });
    return paths;
  }

  updateRing(dt: number, time: number, a: Agent | null, tone: Relation['tone'] | 'focus') {
    const want = a ? 1 : 0;
    this.ringAlpha += (want - this.ringAlpha) * (1 - Math.exp(-dt * 10));
    this.ring.visible = !!a && this.ringAlpha > 0.02;
    if (!a) return;
    const r = Math.max(a.len, a.wid) * 0.62 + 0.8;
    this.ring.position.set(a.x, 0.12, a.z);
    this.ring.scale.setScalar(r * (1.25 - 0.25 * this.ringAlpha));
    this.ring.rotation.y = time * 0.6;
    this.ringMat.color.copy(tone === 'focus' ? TONE.info : TONE[tone]);
    this.ringMat.opacity = this.ringAlpha;
  }

  /** The AI flags conflicts wherever they are: pulsing rings on both parties and a dashed link. */
  updateAlerts(time: number, pairs: { a: Agent; b: Agent; ttc: number }[], skip: Agent | null) {
    let k = 0;
    for (const p of pairs) {
      if (k >= this.alerts.length - 1) break;
      if (p.a === skip || p.b === skip) continue;
      const link = this.alerts[k];
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      for (const ag of [p.a, p.b]) {
        const al = this.alerts[k++];
        const r = Math.max(ag.len, ag.wid) * 0.55 + 0.9 + pulse * 0.5;
        al.ring.position.set(ag.x, 0.15, ag.z);
        al.ring.scale.setScalar(r);
        al.ring.visible = true;
        al.mat.opacity = 0.55 + 0.45 * pulse;
      }
      link.linkGeo.setPositions([p.a.x, 0.3, p.a.z, p.b.x, 0.3, p.b.z]);
      link.link.computeLineDistances();
      link.linkMat.dashOffset = -time * 4;
      link.linkMat.opacity = 0.9;
      link.link.visible = true;
    }
    for (let i = 0; i < this.alerts.length; i++) {
      if (i >= k) this.alerts[i].ring.visible = false;
      if (i % 2 === 1 || i >= k) this.alerts[i].link.visible = i < k && i % 2 === 0;
    }
  }

  /** Predicted paths (3.2 s) for every moving road user, fading into the future. */
  updateTrajectories(agents: Agent[], show: boolean, focus: Agent | null) {
    let q = 0;
    const P = this.trajPos;
    const C = this.trajCol;
    const st = { x: 0, z: 0, hx: 0, hz: 1 };
    if (show) {
      for (const a of agents) {
        const moving = a.v > 0.4 || (a.kind === 'ped' && a.jaywalker && a.state === 'wait');
        if (!moving) continue;
        if (q > P.length / 18 - 20) break;
        const steps = 16;
        const w = (a.kind === 'ped' ? 0.32 : a.kind === 'bike' ? 0.4 : a.wid * 0.42) * (a === focus ? 1.5 : 1);
        const col = CLASS[a.kind === 'ped' ? 'ped' : a.kind === 'bike' ? 'bike' : a.kind === 'bus' ? 'bus' : 'car'];
        const gain = a === focus ? 2.4 : 0.9;
        let px = 0;
        let pz = 0;
        let nx = 0;
        let nz = 0;
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * 3.2;
          predict(a, t, st);
          const cx = st.x;
          const cz = st.z;
          const lx = -st.hz * w;
          const lz = st.hx * w;
          if (i > 0) {
            const fa = (1 - (i - 1) / steps) * gain;
            const fb = (1 - i / steps) * gain;
            const o = q * 18;
            const y = 0.07;
            // two triangles
            const v = [px + nx, y, pz + nz, px - nx, y, pz - nz, cx + lx, y, cz + lz, px - nx, y, pz - nz, cx - lx, y, cz - lz, cx + lx, y, cz + lz];
            const f = [fa, fa, fb, fa, fb, fb];
            for (let k = 0; k < 6; k++) {
              P[o + k * 3] = v[k * 3];
              P[o + k * 3 + 1] = v[k * 3 + 1];
              P[o + k * 3 + 2] = v[k * 3 + 2];
              C[o + k * 3] = col.r * f[k];
              C[o + k * 3 + 1] = col.g * f[k];
              C[o + k * 3 + 2] = col.b * f[k];
            }
            q++;
          }
          px = cx;
          pz = cz;
          nx = lx;
          nz = lz;
        }
      }
    }
    this.trajGeo.setDrawRange(0, q * 6);
    (this.trajGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trajGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Outlined future poses (+1 s, +2 s) of the focused road user. */
  updateGhosts(a: Agent | null) {
    for (let i = 0; i < 2; i++) {
      let g = this.ghosts[i];
      if (!a) {
        if (g) g.visible = false;
        continue;
      }
      const key = `${a.len}:${a.wid}:${a.hgt.toFixed(2)}`; // body sizes vary within a kind
      let geo = this.ghostGeo.get(key);
      if (!geo) {
        geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(a.wid + 0.2, a.hgt + 0.1, a.len + 0.2));
        geo.translate(0, (a.hgt + 0.1) / 2, 0);
        this.ghostGeo.set(key, geo);
      }
      if (!g) {
        g = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
        g.layers.set(LAYER_MACHINE);
        this.group.add(g);
        this.ghosts[i] = g;
      }
      g.geometry = geo;
      const st = predict(a, i + 1);
      g.position.set(st.x, 0.05, st.z);
      g.rotation.y = Math.atan2(st.hx, st.hz);
      const moving = a.v > 0.3 || a.kind === 'ped';
      g.visible = moving;
      const m = g.material as THREE.LineBasicMaterial;
      m.color.setRGB(1.2, 1.6, 2).multiplyScalar(i === 0 ? 0.8 : 0.45);
    }
  }
}
