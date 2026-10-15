// LiDAR point clouds. The static cloud is built the way a real spinning sensor paints a
// street: beams at fixed elevation angles sweep 360°, the first surface each ray meets is
// recorded, so buildings cast long "shadows" with no returns behind them.

import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mulberry32 } from '../shared/noise';
import type { Footprint, Tree } from './city';
import { ROAD } from './layout';
import { type ClassName, LAYER_MACHINE, pointsMaterial, XRAY_TREES } from './materials';

const BINS = 1800;
const PAD_H = 0.16;

/** Nearest building hit per azimuth bin, from the sensor. */
function occlusion(S: THREE.Vector3, fps: Footprint[]) {
  const near = new Float32Array(BINS).fill(Infinity);
  const which = new Int32Array(BINS).fill(-1);
  for (let b = 0; b < BINS; b++) {
    const a = ((b + 0.5) / BINS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let i = 0; i < fps.length; i++) {
      const f = fps[i];
      // slab test
      let t0 = -Infinity;
      let t1 = Infinity;
      if (Math.abs(dx) < 1e-9) {
        if (S.x < f.x0 || S.x > f.x1) continue;
      } else {
        let ta = (f.x0 - S.x) / dx;
        let tb = (f.x1 - S.x) / dx;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (Math.abs(dz) < 1e-9) {
        if (S.z < f.z0 || S.z > f.z1) continue;
      } else {
        let ta = (f.z0 - S.z) / dz;
        let tb = (f.z1 - S.z) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (t1 >= Math.max(0, t0) && t0 > 0 && t0 < near[b]) {
        near[b] = t0;
        which[b] = i;
      }
    }
  }
  return { near, which };
}

function binOf(a: number) {
  let t = a / (Math.PI * 2);
  t -= Math.floor(t);
  return Math.min(BINS - 1, Math.floor(t * BINS));
}

function pointsObject(arr: number[], cls: ClassName, normals?: number[], ids?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (ids) g.setAttribute('aBld', new THREE.Float32BufferAttribute(ids, 1));
  const p = new THREE.Points(g, pointsMaterial(cls, !!normals));
  p.layers.set(LAYER_MACHINE);
  p.frustumCulled = false;
  return p;
}

export function staticCloud(S: THREE.Vector3, fps: Footprint[], trees: Tree[], seed = 3) {
  const rand = mulberry32(seed);
  const { near } = occlusion(S, fps);
  const groundPts: number[] = [];
  const buildPts: number[] = [];
  const buildIds: number[] = [];
  const vegPts: number[] = [];
  const vegIds: number[] = [];
  const LIM = 125;

  // Ground rings: one ring per downward beam.
  for (let e = -62; e <= -2.4; e += 0.75) {
    const r = S.y / Math.tan((-e * Math.PI) / 180);
    if (r > 150) continue;
    const n = Math.min(BINS, Math.max(140, Math.floor((2 * Math.PI * r) / 0.26)));
    for (let i = 0; i < n; i++) {
      const a = ((i + rand() * 0.3) / n) * Math.PI * 2;
      const rr = r * (1 + (rand() - 0.5) * 0.004);
      if (rr > near[binOf(a)]) continue;
      const x = S.x + Math.cos(a) * rr;
      const z = S.z + Math.sin(a) * rr;
      if (Math.abs(x) > LIM || Math.abs(z) > LIM) continue;
      const y = Math.abs(x) > ROAD && Math.abs(z) > ROAD ? PAD_H + 0.02 : 0.04;
      groundPts.push(x, y, z);
    }
  }

  // Facades: where each azimuth ray first hits a building, a column of returns, one per beam.
  for (let b = 0; b < BINS; b++) {
    const d = near[b];
    if (!isFinite(d) || d > 140) continue;
    const a = ((b + 0.5) / BINS) * Math.PI * 2;
    const x = S.x + Math.cos(a) * d;
    const z = S.z + Math.sin(a) * d;
    if (Math.abs(x) > LIM || Math.abs(z) > LIM) continue;
    // find height (and id, for the x-ray) of the hit building
    let h = 0;
    let id = 0;
    fps.forEach((f, i) => {
      if (x >= f.x0 - 0.05 && x <= f.x1 + 0.05 && z >= f.z0 - 0.05 && z <= f.z1 + 0.05 && f.h > h) {
        h = f.h;
        id = i;
      }
    });
    for (let e = -20; e <= 26; e += 0.66) {
      const y = S.y + d * Math.tan((e * Math.PI) / 180);
      if (y < PAD_H + 0.1 || y > h + PAD_H) continue;
      buildPts.push(x, y, z);
      buildIds.push(id);
    }
  }

  // Tree canopies: the sensor-facing half of each crown, if not hidden behind a building.
  trees.forEach((t, ti) => {
    const cx = t.x;
    const cy = t.y + 2.6 + t.r;
    const cz = t.z;
    const dist = Math.hypot(cx - S.x, cz - S.z);
    if (dist > near[binOf(Math.atan2(cz - S.z, cx - S.x))] || dist > 130) return;
    for (let k = 0; k < 170; k++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const nx = s * Math.cos(th);
      const ny = u;
      const nz = s * Math.sin(th);
      const px = cx + nx * t.r;
      const py = cy + ny * t.r;
      const pz = cz + nz * t.r;
      if (nx * (S.x - px) + ny * (S.y - py) + nz * (S.z - pz) < 0) continue;
      vegPts.push(px, py, pz);
      vegIds.push(XRAY_TREES + ti);
    }
  });

  const group = new THREE.Group();
  const ground = pointsObject(groundPts, 'road');
  const facades = pointsObject(buildPts, 'building', undefined, buildIds);
  const canopy = pointsObject(vegPts, 'vegetation', undefined, vegIds);
  group.add(ground, facades, canopy);
  return { group, ground, facades, canopy, count: (groundPts.length + buildPts.length + vegPts.length) / 3 };
}

/** Points scattered over an agent's body (with normals so far-side returns dim). */
export function agentCloud(geo: THREE.BufferGeometry, count: number, cls: ClassName) {
  const mesh = new THREE.Mesh(geo);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const pos: number[] = [];
  const nrm: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(p, n);
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
  }
  return pointsObject(pos, cls, nrm);
}
