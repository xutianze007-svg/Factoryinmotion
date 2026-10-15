// The static city: an architectural-model intersection. Every surface exists twice — clay for
// the beauty pass (layer 0) and a classed material for the machine pass (layer 1).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/noise';
import { DIRS, type Dir, EXTENT, heading, rightOf, ROAD, STOP, XW_IN, XW_OUT } from './layout';
import { buildingClay, type ClassName, clay, CLASS, G, ghostMaterial, LAYER_BEAUTY, LAYER_MACHINE, machineMaterial, withXray, XRAY_TREES } from './materials';

export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
}

export interface SignalHead {
  dir: Dir;
  pos: THREE.Vector3; // world position of the head (for picking + links)
  red: THREE.MeshBasicMaterial;
  amber: THREE.MeshBasicMaterial;
  green: THREE.MeshBasicMaterial;
}

export interface Tree {
  x: number;
  z: number;
  y: number;
  r: number;
}

export interface City {
  group: THREE.Group;
  footprints: Footprint[];
  trees: Tree[];
  signals: SignalHead[];
  sensorHead: THREE.Object3D;
  lampGlow: THREE.MeshBasicMaterial;
}

const PAD_H = 0.16;

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Stamps a building / tree id on every vertex (the x-ray fades whole objects by id). */
function tag(g: THREE.BufferGeometry, id: number) {
  g.setAttribute('aBld', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

export function buildCity(seed = 7): City {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const geos: Partial<Record<ClassName | 'marking', THREE.BufferGeometry[]>> = {};
  const add = (cls: ClassName | 'marking', g: THREE.BufferGeometry) => {
    (geos[cls] ||= []).push(g);
  };

  // Ground, roads, raised quadrant pads (sidewalk + blocks)
  const ground = new THREE.PlaneGeometry(900, 900);
  ground.rotateX(-Math.PI / 2);
  add('ground', ground);
  const L = EXTENT * 2 + 120;
  add('road', box(L, 0.02, ROAD * 2, 0, 0.01, 0));
  add('road', box(ROAD * 2, 0.02, L, 0, 0.01, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const size = EXTENT + 60;
      add('sidewalk', box(size, PAD_H, size, sx * (ROAD + size / 2), PAD_H / 2, sz * (ROAD + size / 2)));
    }

  // Road markings (arm-local, then rotated into each arm)
  for (const d of DIRS) {
    const h = heading(d);
    const r = rightOf(h);
    const toW = (u: number, w: number) => [h[0] * u + r[0] * w, h[1] * u + r[1] * w];
    const along = (u0: number, u1: number, w: number, width: number) => {
      const [ax, az] = toW(u0, w);
      const [bx, bz] = toW(u1, w);
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, bz - az);
      const alongX = Math.abs(h[0]) > 0.5;
      return box(alongX ? len : width, 0.035, alongX ? width : len, cx, 0.03, cz);
    };
    // centre double line (drawn on the approach half only: the other half belongs to the opposite arm)
    add('marking', along(-EXTENT - 40, -STOP, -0.2, 0.12));
    // lane divider dashes
    for (let u = -STOP - 3; u > -EXTENT - 40; u -= 9) add('marking', along(u - 3, u, 3.5, 0.12));
    // stop line across the approach lanes
    {
      const [cx, cz] = toW(-STOP, 3.5);
      const alongX = Math.abs(h[0]) > 0.5;
      add('marking', box(alongX ? 0.45 : 7, 0.036, alongX ? 7 : 0.45, cx, 0.031, cz));
    }
    // zebra crossing
    for (let w = -6.3; w <= 6.31; w += 1.15) add('marking', along(-XW_OUT, -XW_IN, w, 0.55));
  }

  // Buildings
  const footprints: Footprint[] = [];
  const trees: Tree[] = [];
  const lot = 15;
  const gap = 4.5;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          const lx = ROAD + 6 + i * (lot + gap);
          const lz = ROAD + 6 + j * (lot + gap);
          if (lx > 150 || lz > 150) continue;
          const w = lot - rand() * 3.5;
          const dd = lot - rand() * 3.5;
          if (rand() < 0.07 && i + j > 1) {
            // pocket plaza with trees
            for (let k = 0; k < 4; k++)
              trees.push({ x: sx * (lx + 3 + rand() * (w - 6)), z: sz * (lz + 3 + rand() * (dd - 6)), y: PAD_H, r: 1.6 + rand() * 0.8 });
            continue;
          }
          // low near the junction (it must stay visible), taller further out, a few towers
          const ring = Math.min(i, j);
          let hgt = 5 + rand() * 7 + Math.max(i, j) * 1.6;
          if (ring === 0) hgt = Math.min(hgt, 7 + rand() * 9);
          if (i === 0 && j === 0) hgt = 6 + rand() * 4;
          if (ring >= 1 && i + j >= 4 && rand() < 0.16) hgt = 34 + rand() * 30;
          const cx = sx * (lx + w / 2);
          const cz = sz * (lz + dd / 2);
          const bid = footprints.length;
          if (hgt > 30) {
            const pod = 9 + rand() * 4;
            add('building', tag(box(w, pod, dd, cx, PAD_H + pod / 2, cz), bid));
            const tw = w * (0.55 + rand() * 0.2);
            const td = dd * (0.55 + rand() * 0.2);
            const ox = (rand() - 0.5) * (w - tw);
            const oz = (rand() - 0.5) * (dd - td);
            add('building', tag(box(tw, hgt - pod, td, cx + ox, PAD_H + pod + (hgt - pod) / 2, cz + oz), bid));
          } else {
            add('building', tag(box(w, hgt, dd, cx, PAD_H + hgt / 2, cz), bid));
            const units = Math.floor(rand() * 3);
            for (let k = 0; k < units; k++) {
              const uw = 1.6 + rand() * 2;
              add('building', tag(box(uw, 1.1, uw, cx + (rand() - 0.5) * (w - 4), PAD_H + hgt + 0.55, cz + (rand() - 0.5) * (dd - 4)), bid));
            }
          }
          footprints.push({
            x0: Math.min(cx - w / 2, cx + w / 2),
            x1: Math.max(cx - w / 2, cx + w / 2),
            z0: Math.min(cz - dd / 2, cz + dd / 2),
            z1: Math.max(cz - dd / 2, cz + dd / 2),
            h: hgt,
          });
        }
    }

  // Street trees along the curbs (kept clear of the crossings)
  for (const d of DIRS) {
    const h = heading(d);
    const r = rightOf(h);
    for (const side of [-1, 1])
      for (let u = -19; u > -EXTENT; u -= 10 + rand() * 4) {
        const w = side * (ROAD + 1.5);
        trees.push({ x: h[0] * u + r[0] * w, z: h[1] * u + r[1] * w, y: PAD_H, r: 1.5 + rand() * 0.6 });
      }
  }
  trees.forEach((t, i) => {
    const canopy = new THREE.IcosahedronGeometry(t.r, 1);
    canopy.translate(t.x, t.y + 2.6 + t.r, t.z);
    add('vegetation', tag(canopy, XRAY_TREES + i));
    const trunk = new THREE.CylinderGeometry(0.11, 0.15, 2.8, 6);
    trunk.translate(t.x, t.y + 1.4, t.z);
    add('vegetation', tag(trunk, XRAY_TREES + i));
  });

  // Street lamps
  const lampHeads: THREE.BufferGeometry[] = [];
  for (const d of DIRS) {
    const h = heading(d);
    const r = rightOf(h);
    for (let u = -24; u > -EXTENT; u -= 26) {
      for (const side of [-1, 1]) {
        const w = side * (ROAD + 0.6);
        const x = h[0] * u + r[0] * w;
        const z = h[1] * u + r[1] * w;
        const pole = new THREE.CylinderGeometry(0.08, 0.1, 7, 6);
        pole.translate(x, PAD_H + 3.5, z);
        add('pole', pole);
        const ax = -r[0] * side * 1.2;
        const az = -r[1] * side * 1.2;
        add('pole', box(Math.abs(ax) + 0.12, 0.1, Math.abs(az) + 0.12, x + ax / 2, PAD_H + 6.95, z + az / 2));
        const head = new THREE.BoxGeometry(0.6, 0.12, 0.6);
        head.translate(x + ax, PAD_H + 6.85, z + az);
        lampHeads.push(head);
      }
    }
  }

  // Traffic signals: one mast per approach, on the near-right corner, arm over the lanes
  const signals: SignalHead[] = [];
  const lampGeo = new THREE.SphereGeometry(0.2, 12, 8);
  for (const d of DIRS) {
    const h = heading(d);
    const r = rightOf(h);
    const toW = (u: number, w: number) => new THREE.Vector3(h[0] * u + r[0] * w, 0, h[1] * u + r[1] * w);
    const base = toW(-STOP + 0.8, ROAD + 1.0);
    const pole = new THREE.CylinderGeometry(0.13, 0.16, 6.2, 8);
    pole.translate(base.x, PAD_H + 3.1, base.z);
    add('pole', pole);
    const tip = toW(-STOP + 0.8, 3.0);
    const mid = base.clone().add(tip).multiplyScalar(0.5);
    const len = base.distanceTo(tip);
    const alongX = Math.abs(r[0]) > 0.5;
    add('pole', box(alongX ? len : 0.14, 0.14, alongX ? 0.14 : len, mid.x, PAD_H + 6.0, mid.z));
    const housing = toW(-STOP + 0.8, 3.6);
    add('signal', box(alongX ? 0.5 : 0.5, 1.5, alongX ? 0.5 : 0.5, housing.x, PAD_H + 5.2, housing.z));
    const mk = (c: string, y: number) => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c) });
      const mesh = new THREE.Mesh(lampGeo, m);
      // lamps face the approaching traffic (towards -h)
      mesh.position.set(housing.x - h[0] * 0.28, PAD_H + y, housing.z - h[1] * 0.28);
      mesh.layers.enable(LAYER_MACHINE);
      group.add(mesh);
      return m;
    };
    signals.push({
      dir: d,
      pos: new THREE.Vector3(housing.x, PAD_H + 5.2, housing.z),
      red: mk('#ff2a1a', 5.68),
      amber: mk('#ffb000', 5.2),
      green: mk('#20ff8a', 4.72),
    });
  }

  // LiDAR node: the "eye" whose view the lens reveals
  const S = G.uSensor.value;
  const sPole = new THREE.CylinderGeometry(0.12, 0.16, S.y - 0.4, 8);
  sPole.translate(S.x, (S.y - 0.4) / 2 + PAD_H, S.z);
  add('pole', sPole);
  const sensorHead = new THREE.Group();
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 24), clay('#2a2c31', { roughness: 0.4 }));
  puck.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.43, 0.43, 0.08, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 3.2) }),
  );
  ring.position.y = 0.05;
  ring.layers.enable(LAYER_MACHINE);
  sensorHead.add(puck, ring);
  sensorHead.position.set(S.x, S.y + PAD_H, S.z);
  group.add(sensorHead);

  // Materialise: merged clay mesh (beauty) + classed mesh (machine) per class
  const beautyMat: Record<string, THREE.Material> = {
    ground: clay('#e6e4dd'),
    road: clay('#d9d6cf'),
    sidewalk: clay('#efede8'),
    marking: clay('#fbfaf6'),
    building: withXray(buildingClay()),
    vegetation: withXray(clay('#e7eadf')),
    pole: clay('#d5d3cd'),
    signal: clay('#3a3c42', { roughness: 0.5 }),
  };
  for (const [cls, list] of Object.entries(geos)) {
    if (!list?.length) continue;
    const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (!merged) continue;
    merged.computeVertexNormals();
    const beauty = new THREE.Mesh(merged, beautyMat[cls]);
    beauty.castShadow = cls !== 'ground' && cls !== 'road' && cls !== 'marking';
    beauty.receiveShadow = true;
    beauty.layers.set(LAYER_BEAUTY);
    const mcls: ClassName = cls === 'marking' ? 'road' : (cls as ClassName);
    const machine = new THREE.Mesh(merged, machineMaterial(mcls));
    machine.layers.set(LAYER_MACHINE);
    if (cls === 'marking') (machine.material as THREE.ShaderMaterial).uniforms.uClass.value = CLASS.road.clone().multiplyScalar(1.8);
    group.add(beauty, machine);
    if (cls === 'building' || cls === 'vegetation') {
      const ghost = new THREE.Mesh(merged, ghostMaterial());
      ghost.layers.set(LAYER_BEAUTY);
      ghost.renderOrder = 2;
      group.add(ghost);
    }
  }
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.55) });
  const heads = new THREE.Mesh(mergeGeometries(lampHeads)!, lampGlow);
  heads.layers.enable(LAYER_MACHINE);
  group.add(heads);

  return { group, footprints, trees, signals, sensorHead, lampGlow };
}
