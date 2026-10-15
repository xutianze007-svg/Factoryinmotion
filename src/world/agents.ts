// Agent visuals. Architectural-model road users in clay for the beauty pass — four car bodies
// built from extruded side profiles (wheel arches, glass cabin, pillars, lights), a detailed bus,
// cyclists and varied pedestrians whose legs and arms move in the vertex shader. For the machine
// pass each agent also carries a classed body, a glowing detection cuboid, a ground footprint
// and its own LiDAR returns.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/noise';
import { agentCloud } from './lidar';
import { boxMaterial, type ClassName, CLASS, LAYER_BEAUTY, LAYER_MACHINE, machineMaterial, walker } from './materials';

export type Kind = 'car' | 'bus' | 'bike' | 'ped';

export interface AgentVisual {
  root: THREE.Group;
  bob: THREE.Group; // walking bob / lean
  tail?: THREE.MeshBasicMaterial;
  indL?: THREE.Object3D;
  indR?: THREE.Object3D;
  boxMat: THREE.LineBasicMaterial;
  footMat: THREE.MeshBasicMaterial;
  body: THREE.Mesh;
  /** limb animation (phase, leg swing, arm swing) for pedestrians and cyclists */
  walk?: THREE.Vector3;
  walkAmp: number;
  len: number;
  wid: number;
  hgt: number;
}

// ------------------------------------------------------------------ geometry helpers

type V3 = [number, number, number];
/** limb id (0 body, 1/2 left/right leg, 3/4 left/right arm) and its pivot (y, z) */
type Limb = [number, number, number];
const BODY_LIMB: Limb = [0, 0, 0];
const Y = new THREE.Vector3(0, 1, 0);

function part(g: THREE.BufferGeometry, color: string, limb: Limb | null = null) {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = ng.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (limb) {
    const l = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) l.set(limb, i * 3);
    ng.setAttribute('aLimb', new THREE.BufferAttribute(l, 3));
  }
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color', 'aLimb'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** A cylinder, capsule or square bar running from a to b. */
function between(a: V3, b: V3, r: number, capsule = false, seg = 6) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const len = d.length();
  const g = capsule
    ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 2, seg)
    : seg <= 4
      ? new THREE.BoxGeometry(r * 2, len, r * 2)
      : new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** A side-profile polygon (z forward, y up) extruded across the width, with rounded edges. */
function extrude(shape: THREE.Shape, width: number, bevel: number) {
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.rotateY(-Math.PI / 2);
  return g.translate(depth / 2, 0, 0);
}

function poly(pts: [number, number][]) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  return s;
}

/** Body side: the top outline (rear-bottom corner → front-bottom corner) closed by a sill with arches. */
function bodyShape(top: [number, number][], zF: number, zR: number, arch: number, clear: number) {
  const s = new THREE.Shape();
  const last = top[top.length - 1];
  s.moveTo(last[0], last[1]);
  s.lineTo(zF + arch, clear);
  s.absarc(zF, clear, arch, 0, Math.PI, false);
  s.lineTo(zR + arch, clear);
  s.absarc(zR, clear, arch, 0, Math.PI, false);
  for (let i = 0; i < top.length - 1; i++) s.lineTo(top[i][0], top[i][1]);
  return s;
}

const TIRE = '#46484c';
const RIM = '#cdd0d4';
const TRIM = '#5d6066';

function wheels(out: THREE.BufferGeometry[], r: number, w: number, x: number, zs: number[]) {
  for (const z of zs)
    for (const sx of [-1, 1]) {
      const tire = new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2);
      out.push(part(at(tire, sx * x, r, z), TIRE));
      const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10).rotateZ(Math.PI / 2);
      out.push(part(at(rim, sx * x, r, z), RIM));
    }
}

function merge(list: THREE.BufferGeometry[]) {
  return mergeGeometries(list, false)!;
}

/** Body (clay) and glass as two groups of one geometry: materials [clay, glass]. */
function grouped(body: THREE.BufferGeometry[], glass: THREE.BufferGeometry[]) {
  return mergeGeometries([merge(body), merge(glass)], true)!;
}

// ------------------------------------------------------------------ cars

interface CarSpec {
  L: number;
  W: number;
  H: number;
  r: number;
  zF: number;
  zR: number;
  arch: number;
  clear: number;
  top: [number, number][];
  glass: [number, number][];
  roof: [number, number][];
  glassW: number;
  pillars: [number, number, number, number][];
  lightF: [number, number, number]; // z, y, x
  lightR: [number, number, number];
  mirror: [number, number];
  extras?: (body: THREE.BufferGeometry[], glass: THREE.BufferGeometry[], color: string) => void;
  colors: string[];
}

const PAINT = ['#f4f2ed', '#f4f2ed', '#ecebe6', '#e2e0da', '#d3d6d9', '#b9bfc5', '#8e959c', '#4a4d52', '#d9ccb4', '#b9c5b4', '#a8b8c8', '#c98f7c'];

const CARS: Record<string, CarSpec> = {
  sedan: {
    L: 4.5,
    W: 1.82,
    H: 1.47,
    r: 0.33,
    zF: 1.38,
    zR: -1.3,
    arch: 0.41,
    clear: 0.28,
    top: [
      [-2.18, 0.32],
      [-2.22, 0.6],
      [-2.17, 0.84],
      [-1.98, 0.95],
      [-1.3, 0.99],
      [1.12, 0.98],
      [1.85, 0.86],
      [2.16, 0.74],
      [2.2, 0.48],
      [2.14, 0.32],
    ],
    glass: [
      [-1.32, 0.96],
      [-0.66, 1.41],
      [0.36, 1.43],
      [1.14, 0.95],
    ],
    roof: [
      [-0.72, 1.38],
      [-0.62, 1.46],
      [0.36, 1.47],
      [0.46, 1.38],
    ],
    glassW: 1.5,
    pillars: [
      [1.12, 0.98, 0.38, 1.42],
      [-0.12, 0.98, -0.14, 1.43],
      [-1.3, 0.98, -0.66, 1.41],
    ],
    lightF: [2.23, 0.66, 0.6],
    lightR: [-2.24, 0.76, 0.62],
    mirror: [1.0, 1.06],
    colors: PAINT,
  },
  hatch: {
    L: 4.05,
    W: 1.76,
    H: 1.51,
    r: 0.31,
    zF: 1.26,
    zR: -1.2,
    arch: 0.39,
    clear: 0.27,
    top: [
      [-1.98, 0.31],
      [-2.02, 0.58],
      [-2.0, 0.98],
      [0.98, 0.97],
      [1.62, 0.85],
      [1.96, 0.72],
      [2.0, 0.46],
      [1.94, 0.31],
    ],
    glass: [
      [-2.0, 0.95],
      [-1.84, 1.45],
      [0.28, 1.47],
      [1.0, 0.94],
    ],
    roof: [
      [-1.92, 1.42],
      [-1.84, 1.5],
      [0.28, 1.51],
      [0.38, 1.42],
    ],
    glassW: 1.46,
    pillars: [
      [1.0, 0.97, 0.3, 1.46],
      [-0.32, 0.98, -0.34, 1.46],
      [-1.5, 0.98, -1.62, 1.46],
    ],
    lightF: [2.03, 0.64, 0.58],
    lightR: [-2.06, 0.84, 0.6],
    mirror: [0.88, 1.04],
    colors: PAINT,
  },
  suv: {
    L: 4.7,
    W: 1.92,
    H: 1.8,
    r: 0.38,
    zF: 1.45,
    zR: -1.42,
    arch: 0.47,
    clear: 0.36,
    top: [
      [-2.3, 0.42],
      [-2.35, 0.74],
      [-2.32, 1.14],
      [1.22, 1.12],
      [1.95, 1.02],
      [2.3, 0.92],
      [2.36, 0.55],
      [2.28, 0.4],
    ],
    glass: [
      [-2.3, 1.1],
      [-2.18, 1.68],
      [0.6, 1.72],
      [1.24, 1.09],
    ],
    roof: [
      [-2.24, 1.65],
      [-2.18, 1.76],
      [0.6, 1.78],
      [0.7, 1.66],
    ],
    glassW: 1.62,
    pillars: [
      [1.22, 1.12, 0.62, 1.7],
      [-0.2, 1.12, -0.22, 1.72],
      [-1.32, 1.12, -1.36, 1.72],
      [-2.3, 1.12, -2.18, 1.68],
    ],
    lightF: [2.39, 0.86, 0.64],
    lightR: [-2.39, 1.0, 0.68],
    mirror: [1.1, 1.2],
    extras: (body) => {
      for (const sx of [-1, 1]) body.push(part(at(new THREE.BoxGeometry(0.05, 0.05, 2.4), sx * 0.62, 1.83, -0.8), TRIM));
    },
    colors: PAINT,
  },
  van: {
    L: 5.0,
    W: 1.98,
    H: 2.15,
    r: 0.36,
    zF: 1.62,
    zR: -1.55,
    arch: 0.45,
    clear: 0.33,
    top: [
      [-2.46, 0.4],
      [-2.5, 0.7],
      [-2.5, 2.0],
      [-2.42, 2.1],
      [0.86, 2.1],
      [0.86, 1.12],
      [1.62, 1.1],
      [2.15, 0.96],
      [2.48, 0.85],
      [2.52, 0.5],
      [2.45, 0.36],
    ],
    glass: [
      [0.84, 1.08],
      [0.84, 2.0],
      [1.2, 2.0],
      [1.66, 1.06],
    ],
    roof: [
      [0.8, 1.97],
      [0.8, 2.1],
      [1.18, 2.1],
      [1.28, 1.97],
    ],
    glassW: 1.9,
    pillars: [[1.66, 1.1, 1.2, 2.0]],
    lightF: [2.55, 0.8, 0.66],
    lightR: [-2.56, 0.92, 0.72],
    mirror: [1.45, 1.42],
    extras: (body) => {
      // sliding-door and rear-door seams
      for (const sx of [-1, 1])
        for (const z of [0.15, -0.95]) body.push(part(at(new THREE.BoxGeometry(0.012, 1.45, 0.025), sx * 1.0, 1.25, z), TRIM));
      body.push(part(at(new THREE.BoxGeometry(0.025, 1.5, 0.012), 0, 1.25, -2.57), TRIM));
    },
    colors: ['#f4f2ed', '#f4f2ed', '#ecebe6', '#d3d6d9', '#a8b8c8'],
  },
};
const CAR_MIX = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'van'];

const cache = new Map<string, THREE.BufferGeometry>();

function carGeo(spec: CarSpec, color: string, key: string) {
  if (cache.has(key)) return cache.get(key)!;
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  body.push(part(extrude(bodyShape(spec.top, spec.zF, spec.zR, spec.arch, spec.clear), spec.W, 0.06), color));
  glass.push(part(extrude(poly(spec.glass), spec.glassW, 0.025), '#ffffff'));
  body.push(part(extrude(poly(spec.roof), spec.glassW + 0.05, 0.025), color));
  const px = spec.glassW / 2 + 0.005;
  for (const [z0, y0, z1, y1] of spec.pillars)
    for (const sx of [-1, 1]) body.push(part(between([sx * px, y0, z0], [sx * px, y1, z1], 0.045, false, 4), color));
  // nose and tail: grille, bumpers, plate
  const [fz, fy, fx] = spec.lightF;
  const [rz, ry] = spec.lightR;
  body.push(part(at(new THREE.BoxGeometry(fx * 1.25, 0.16, 0.05), 0, fy - 0.17, fz - 0.03), TRIM));
  body.push(part(at(new THREE.BoxGeometry(spec.W * 0.96, 0.14, 0.16), 0, spec.clear + 0.1, fz - 0.06), TRIM));
  body.push(part(at(new THREE.BoxGeometry(spec.W * 0.96, 0.14, 0.16), 0, spec.clear + 0.12, rz + 0.06), TRIM));
  body.push(part(at(new THREE.BoxGeometry(0.42, 0.11, 0.02), 0, ry - 0.22, rz - 0.01), '#f7f6f2'));
  // mirrors
  for (const sx of [-1, 1]) {
    body.push(part(at(new THREE.BoxGeometry(0.2, 0.12, 0.09), sx * (spec.W / 2 + 0.08), spec.mirror[1], spec.mirror[0]), color));
    body.push(part(at(new THREE.BoxGeometry(0.1, 0.03, 0.04), sx * (spec.W / 2 + 0.01), spec.mirror[1] - 0.03, spec.mirror[0] + 0.02), TRIM));
  }
  wheels(body, spec.r, 0.22, spec.W / 2 - 0.13, [spec.zF, spec.zR]);
  spec.extras?.(body, glass, color);
  const g = grouped(body, glass);
  cache.set(key, g);
  return g;
}

function busGeo() {
  if (cache.has('bus')) return cache.get('bus')!;
  const W = 2.5;
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const paint = '#e8b892';
  const top: [number, number][] = [
    [-5.45, 0.42],
    [-5.5, 2.85],
    [-5.36, 3.02],
    [5.28, 3.02],
    [5.48, 2.86],
    [5.52, 0.52],
    [5.46, 0.38],
  ];
  body.push(part(extrude(bodyShape(top, 3.5, -3.3, 0.56, 0.36), W, 0.07), paint));
  const sx0 = W / 2 + 0.012;
  // window band with mullions, doors on the kerb side, wraparound screen
  for (const sx of [-1, 1]) {
    glass.push(part(at(new THREE.BoxGeometry(0.03, 1.05, 9.2), sx * sx0, 2.15, -0.45), '#ffffff'));
    for (let z = -4.6; z < 3.4; z += 1.32) body.push(part(at(new THREE.BoxGeometry(0.035, 1.07, 0.09), sx * (sx0 + 0.008), 2.15, z), paint));
    body.push(part(at(new THREE.BoxGeometry(0.03, 0.16, 10.2), sx * (sx0 + 0.004), 0.82, 0), '#c99673'));
  }
  for (const z of [4.45, -0.3]) glass.push(part(at(new THREE.BoxGeometry(0.035, 2.05, 1.05), -(sx0 + 0.01), 1.5, z), '#ffffff'));
  glass.push(part(at(new THREE.BoxGeometry(2.24, 1.5, 0.03), 0, 2.02, 5.6), '#ffffff'));
  glass.push(part(at(new THREE.BoxGeometry(2.0, 0.62, 0.03), 0, 2.38, -5.57), '#ffffff'));
  // roof plant, mirrors on stalks, bumpers
  body.push(part(at(new RoundedBoxGeometry(1.7, 0.3, 2.8, 2, 0.08), 0, 3.15, -0.9), '#dedcd6'));
  body.push(part(at(new RoundedBoxGeometry(1.2, 0.22, 1.0, 2, 0.06), 0, 3.11, 3.0), '#dedcd6'));
  for (const sx of [-1, 1]) {
    body.push(part(between([sx * 1.27, 2.75, 5.35], [sx * 1.5, 2.7, 5.55], 0.025, false, 4), TRIM));
    body.push(part(at(new THREE.BoxGeometry(0.1, 0.38, 0.14), sx * 1.52, 2.5, 5.56), TRIM));
  }
  body.push(part(at(new THREE.BoxGeometry(W * 0.98, 0.22, 0.2), 0, 0.5, 5.52), TRIM));
  body.push(part(at(new THREE.BoxGeometry(W * 0.98, 0.22, 0.2), 0, 0.5, -5.5), TRIM));
  wheels(body, 0.48, 0.32, W / 2 - 0.18, [3.5, -3.3]);
  const g = grouped(body, glass);
  cache.set('bus', g);
  return g;
}

// ------------------------------------------------------------------ people

const SKIN = ['#f1d6c0', '#e9c8ad', '#d7a98a', '#b07c5c', '#8a5a3c', '#5e3d2a'];
const HAIR = ['#2b2622', '#1c1c1c', '#5a4332', '#8a6a4a', '#d9c9a5', '#9a9a96'];
const TOPS = ['#ece7dd', '#c9d3dc', '#d8c3a5', '#7d8a96', '#b85c4a', '#3f4a57', '#a7b59a', '#e3d6bd', '#46505c', '#c7a24e'];
const BOTTOMS = ['#3d4148', '#5b6470', '#c9c3b6', '#2f3237', '#8a7f6e', '#4b5b70'];
const SHOES = ['#2a2b2e', '#f2f1ec', '#6b5a4a'];
const PACKS = ['#3f4a57', '#b85c4a', '#2f3237', '#c7a24e', '#7d8a96'];

const HIP = 0.92;
const SHOULDER = 1.43;

function pedGeo(variant: number) {
  const key = `ped${variant}`;
  if (cache.has(key)) return cache.get(key)!;
  const rnd = mulberry32(variant * 7919 + 13);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const top = pick(TOPS);
  const bottom = pick(BOTTOMS);
  const shoe = pick(SHOES);
  const skirt = rnd() < 0.22;
  const coat = !skirt && rnd() < 0.25;
  const longSleeve = coat || rnd() < 0.55;
  const hairStyle = rnd();
  const hat = rnd() < 0.14;
  const pack = rnd() < 0.3;
  const build = 0.92 + rnd() * 0.18;
  const parts: THREE.BufferGeometry[] = [];

  // legs (limbs 1, 2) — swing about the hip
  for (const [id, sx] of [
    [1, 1],
    [2, -1],
  ] as const) {
    const limb: Limb = [id, HIP, 0];
    const legColor = skirt ? (rnd() < 0.5 ? skin : '#2f3237') : bottom;
    parts.push(part(at(new THREE.CapsuleGeometry(0.066 * build, 0.74, 2, 6), sx * 0.095, 0.5, 0), legColor, limb));
    parts.push(part(at(new THREE.BoxGeometry(0.11, 0.08, 0.25), sx * 0.095, 0.04, 0.045), shoe, limb));
  }
  // pelvis, torso, neck, head
  parts.push(part(at(new THREE.BoxGeometry(0.31 * build, 0.16, 0.2), 0, HIP + 0.02, 0), bottom, BODY_LIMB));
  parts.push(part(at(new THREE.CapsuleGeometry(0.15, 0.27, 2, 8).scale(1.22 * build, 1, 0.72), 0, 1.22, 0), top, BODY_LIMB));
  if (skirt) parts.push(part(at(new THREE.CylinderGeometry(0.16, 0.25, 0.4, 10, 1, true).scale(build, 1, 0.82), 0, 0.76, 0), bottom, BODY_LIMB));
  if (coat) parts.push(part(at(new THREE.CylinderGeometry(0.19, 0.24, 0.46, 10, 1, true).scale(build, 1, 0.78), 0, 0.86, 0), top, BODY_LIMB));
  parts.push(part(at(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6, 1, true), 0, 1.53, 0), skin, BODY_LIMB));
  parts.push(part(at(new THREE.SphereGeometry(0.1, 10, 7).scale(0.92, 1.06, 1), 0, 1.63, 0.005), skin, BODY_LIMB));
  if (hat) {
    parts.push(part(at(new THREE.SphereGeometry(0.108, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 1.655, 0), pick(PACKS), BODY_LIMB));
    parts.push(part(at(new THREE.BoxGeometry(0.15, 0.015, 0.1), 0, 1.66, 0.12), pick(PACKS), BODY_LIMB));
  } else if (hairStyle > 0.08) {
    parts.push(part(at(new THREE.SphereGeometry(0.108, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.56), 0, 1.648, -0.012), hair, BODY_LIMB));
    if (hairStyle > 0.62) parts.push(part(at(new THREE.BoxGeometry(0.19, 0.24, 0.07), 0, 1.53, -0.075), hair, BODY_LIMB));
  }
  if (pack) parts.push(part(at(new RoundedBoxGeometry(0.27, 0.34, 0.13, 1, 0.04), 0, 1.22, -0.16), pick(PACKS), BODY_LIMB));

  // arms (limbs 3, 4) — swing about the shoulder, opposite to the legs
  for (const [id, sx] of [
    [3, 1],
    [4, -1],
  ] as const) {
    const limb: Limb = [id, SHOULDER, 0];
    const x = sx * (0.205 * build);
    if (longSleeve) parts.push(part(between([x, SHOULDER, 0], [x * 1.06, 0.93, 0.01], 0.05, true, 6), top, limb));
    else {
      parts.push(part(between([x, SHOULDER, 0], [x * 1.03, 1.24, 0.004], 0.056, true, 6), top, limb));
      parts.push(part(between([x * 1.03, 1.25, 0.004], [x * 1.06, 0.93, 0.01], 0.044, true, 6), skin, limb));
    }
    parts.push(part(at(new THREE.SphereGeometry(0.045, 6, 4), x * 1.06, 0.88, 0.012), skin, limb));
  }
  const g = merge(parts);
  cache.set(key, g);
  return g;
}

function bikeGeo(variant: number) {
  const key = `bike${variant}`;
  if (cache.has(key)) return cache.get(key)!;
  const rnd = mulberry32(variant * 104729 + 7);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const frame = pick(['#3f4a57', '#b85c4a', '#e3e1db', '#2f3237', '#a7b59a', '#4b5b70']);
  const skin = pick(SKIN);
  const top = pick(TOPS);
  const bottom = pick(BOTTOMS);
  const helmet = pick(['#f2f1ec', '#2f3237', '#b85c4a', '#c7a24e', '#7d8a96']);
  const parts: THREE.BufferGeometry[] = [];
  const B = BODY_LIMB;
  // wheels
  for (const z of [0.56, -0.56]) {
    parts.push(part(at(new THREE.TorusGeometry(0.34, 0.03, 4, 20).rotateY(Math.PI / 2), 0, 0.36, z), TIRE, B));
    parts.push(part(at(new THREE.TorusGeometry(0.3, 0.012, 3, 16).rotateY(Math.PI / 2), 0, 0.36, z), RIM, B));
  }
  // frame
  const bb: V3 = [0, 0.36, -0.02];
  const seat: V3 = [0, 0.88, -0.2];
  const head: V3 = [0, 0.84, 0.38];
  const headTop: V3 = [0, 0.98, 0.41];
  const rearHub: V3 = [0, 0.36, -0.56];
  const frontHub: V3 = [0, 0.36, 0.56];
  for (const [a, b] of [
    [bb, seat],
    [seat, head],
    [bb, head],
    [bb, rearHub],
    [seat, rearHub],
    [headTop, frontHub],
    [head, headTop],
  ] as [V3, V3][])
    parts.push(part(between(a, b, 0.022, false, 4), frame, B));
  parts.push(part(between([-0.24, 1.0, 0.43], [0.24, 1.0, 0.43], 0.017, false, 4), TRIM, B));
  parts.push(part(at(new THREE.BoxGeometry(0.15, 0.05, 0.27), 0, 0.93, -0.21), TRIM, B));
  // rider
  parts.push(part(at(new THREE.BoxGeometry(0.3, 0.15, 0.22), 0, 1.0, -0.17), bottom, B));
  parts.push(part(between([0, 1.04, -0.15], [0, 1.42, 0.1], 0.15, true, 8), top, B));
  parts.push(part(at(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6, 1, true), 0, 1.54, 0.17), skin, B));
  parts.push(part(at(new THREE.SphereGeometry(0.1, 10, 7), 0, 1.62, 0.24), skin, B));
  parts.push(part(at(new THREE.SphereGeometry(0.122, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(1, 0.9, 1.22), 0, 1.66, 0.21), helmet, B));
  for (const sx of [-1, 1]) {
    parts.push(part(between([sx * 0.18, 1.4, 0.08], [sx * 0.22, 1.01, 0.42], 0.045, true, 6), top, B));
    parts.push(part(at(new THREE.SphereGeometry(0.042, 6, 4), sx * 0.22, 1.0, 0.43), skin, B));
  }
  // legs (limbs 1, 2) — pedal about the hip
  for (const [id, sx] of [
    [1, 1],
    [2, -1],
  ] as const) {
    const limb: Limb = [id, 1.0, -0.16];
    parts.push(part(between([sx * 0.1, 0.99, -0.14], [sx * 0.1, 0.46, 0.02], 0.062, true, 6), bottom, limb));
    parts.push(part(at(new THREE.BoxGeometry(0.1, 0.07, 0.22), sx * 0.1, 0.42, 0.07), '#2a2b2e', limb));
  }
  const g = merge(parts);
  cache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ materials

const clayV = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
const glassMat = new THREE.MeshStandardMaterial({ color: '#3a424b', roughness: 0.14, metalness: 0.2, envMapIntensity: 1.6 });
const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.4) });
const indMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.1) });
const signMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.35) });
const lightGeo = new RoundedBoxGeometry(0.36, 0.11, 0.06, 1, 0.025);
const indGeo = new THREE.BoxGeometry(0.1, 0.08, 0.08);

// shared per body geometry / class so spawning stays cheap
const cloudCache = new Map<THREE.BufferGeometry, THREE.Points>();
const edgeCache = new Map<string, THREE.BufferGeometry>();
const footCache = new Map<string, THREE.BufferGeometry>();
const machCache = new Map<ClassName, THREE.ShaderMaterial>();

function lights(group: THREE.Group, f: [number, number, number], r: [number, number, number], wid: number, scale = 1) {
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    m.layers.enable(LAYER_MACHINE);
    group.add(m);
    return m;
  };
  for (const sx of [-1, 1]) add(headMat, lightGeo, sx * f[2], f[1], f[0]);
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.05, 0.04) });
  for (const sx of [-1, 1]) add(tail, lightGeo, sx * r[2], r[1], r[0]);
  const mkInd = (side: number) => {
    const g = new THREE.Group();
    for (const [z, y] of [
      [f[0] - 0.06, f[1]],
      [r[0] + 0.06, r[1]],
    ]) {
      const m = new THREE.Mesh(indGeo, indMat);
      m.position.set(side * (wid / 2 + 0.02), y, z);
      m.layers.enable(LAYER_MACHINE);
      g.add(m);
    }
    g.visible = false;
    group.add(g);
    return g;
  };
  return { tail, indL: mkInd(1), indR: mkInd(-1) };
}

// ------------------------------------------------------------------ assembly

export function makeAgent(kind: Kind, rand: () => number): AgentVisual {
  const root = new THREE.Group();
  const bob = new THREE.Group();
  root.add(bob);
  let geo: THREE.BufferGeometry;
  let len: number;
  let wid: number;
  let hgt: number;
  let cls: ClassName;
  let pts: number;
  let spec: CarSpec | null = null;
  let walk: { value: THREE.Vector3 } | null = null;
  if (kind === 'car') {
    const type = CAR_MIX[Math.floor(rand() * CAR_MIX.length)];
    spec = CARS[type];
    const color = spec.colors[Math.floor(rand() * spec.colors.length)];
    geo = carGeo(spec, color, `${type}${color}`);
    [len, wid, hgt, cls, pts] = [spec.L, spec.W, spec.H, 'car', 560];
  } else if (kind === 'bus') {
    geo = busGeo();
    [len, wid, hgt, cls, pts] = [11, 2.5, 3.3, 'bus', 1300];
  } else if (kind === 'bike') {
    geo = bikeGeo(Math.floor(rand() * 10));
    [len, wid, hgt, cls, pts] = [1.8, 0.6, 1.8, 'bike', 190];
    walk = { value: new THREE.Vector3() };
  } else {
    const v = Math.floor(rand() * 28);
    geo = pedGeo(v);
    const h = 1.58 + mulberry32(v * 31 + 5)() * 0.32;
    geo = scaledPed(geo, v, h);
    [len, wid, hgt, cls, pts] = [0.5, 0.5, h, 'ped', 150];
    walk = { value: new THREE.Vector3() };
  }

  let bodyMat: THREE.Material | THREE.Material[] = geo.groups.length ? [clayV, glassMat] : clayV;
  let machMat: THREE.ShaderMaterial;
  let depthMat: THREE.MeshDepthMaterial | undefined;
  if (walk) {
    // per-person materials share one program; only the walk uniform differs
    bodyMat = walker(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), walk, true);
    depthMat = walker(new THREE.MeshDepthMaterial(), walk, false);
    machMat = machineMaterial(cls, walk);
  } else {
    if (!machCache.has(cls)) machCache.set(cls, machineMaterial(cls));
    machMat = machCache.get(cls)!;
  }

  const body = new THREE.Mesh(geo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.layers.set(LAYER_BEAUTY);
  if (depthMat) body.customDepthMaterial = depthMat;
  const mach = new THREE.Mesh(geo, machMat);
  mach.layers.set(LAYER_MACHINE);
  bob.add(body, mach);

  let proto = cloudCache.get(geo);
  if (!proto) {
    proto = agentCloud(geo, pts, cls);
    cloudCache.set(geo, proto);
  }
  const cloud = new THREE.Points(proto.geometry, proto.material);
  cloud.layers.set(LAYER_MACHINE);
  cloud.frustumCulled = false;
  bob.add(cloud);

  // detection cuboid
  const pad = kind === 'ped' ? 0.18 : 0.12;
  const ekey = `${kind}:${len}:${wid}:${hgt.toFixed(2)}`;
  let bgeo = edgeCache.get(ekey);
  if (!bgeo) {
    bgeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(wid + pad * 2, hgt + pad, len + pad * 2));
    bgeo.translate(0, (hgt + pad) / 2, 0);
    edgeCache.set(ekey, bgeo);
  }
  const boxMat = boxMaterial(cls, 3.2);
  const cub = new THREE.LineSegments(bgeo, boxMat);
  cub.layers.set(LAYER_MACHINE);
  root.add(cub);

  // ground footprint (bird's-eye detection mask)
  const footMat = new THREE.MeshBasicMaterial({
    color: CLASS[cls].clone().multiplyScalar(0.55),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let fgeo = footCache.get(`${len}:${wid}`);
  if (!fgeo) {
    fgeo = new THREE.PlaneGeometry(wid + 0.6, len + 0.6).rotateX(-Math.PI / 2);
    footCache.set(`${len}:${wid}`, fgeo);
  }
  const foot = new THREE.Mesh(fgeo, footMat);
  foot.position.y = 0.06;
  foot.layers.set(LAYER_MACHINE);
  root.add(foot);

  const vis: AgentVisual = { root, bob, boxMat, footMat, body, len, wid, hgt, walkAmp: 0, walk: walk?.value };
  if (spec) {
    const l = lights(bob, spec.lightF, spec.lightR, wid);
    vis.tail = l.tail;
    vis.indL = l.indL;
    vis.indR = l.indR;
  } else if (kind === 'bus') {
    const l = lights(bob, [5.6, 0.78, 0.86], [-5.58, 0.98, 0.95], wid, 1.25);
    vis.tail = l.tail;
    vis.indL = l.indL;
    vis.indR = l.indR;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.03), signMat);
    sign.position.set(0, 2.86, 5.6);
    sign.layers.enable(LAYER_MACHINE);
    bob.add(sign);
  }
  return vis;
}

/** People come in different heights: scale the figure (and its limb pivots) per variant. */
function scaledPed(base: THREE.BufferGeometry, v: number, h: number) {
  const key = `ped${v}@${h.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key)!;
  const s = h / 1.72;
  const g = base.clone().scale(s, s, s);
  const l = g.attributes.aLimb as THREE.BufferAttribute;
  for (let i = 0; i < l.count; i++) l.setXYZ(i, l.getX(i), l.getY(i) * s, l.getZ(i) * s);
  cache.set(key, g);
  return g;
}
