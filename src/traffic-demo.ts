import { createDialKit, createDialRoot } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { springToPhysics } from './shared/spring';
import { dialConfig } from './config';
import { Analyst, type Reading } from './intel/analyst';
import { IntelVisuals } from './intel/visuals';
import { type Corridor, LensGrid, type Region } from './lens/grid';
import { Pipeline } from './render/pipeline';
import { Hud } from './ui/hud';
import './style.css';
import { buildCity, type SignalHead } from './world/city';
import { groupOf } from './world/layout';
import { staticCloud } from './world/lidar';
import { CLASS, G, XRAY_TREES } from './world/materials';
import { type Agent, Traffic } from './world/traffic';

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.className = 'ms-canvas';
app.appendChild(canvas);
const boot = document.createElement('div');
boot.className = 'ms-boot';
boot.innerHTML = '<div><span></span>Node 07 · booting perception</div>';
document.body.appendChild(boot);

const kit = createDialKit('Machine Sight', dialConfig, {
  onAction: (a) => {
    if (a === 'replayIntro') introStart = clock;
    if (a === 'camera.reset') resetCamera();
  },
});
createDialRoot({ position: 'bottom-right', defaultOpen: false, theme: 'light' });
let cfg = kit.values;
kit.subscribe((v) => (cfg = v));

// ------------------------------------------------------------------ scene
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e4dc');
scene.fog = new THREE.Fog('#e7e4dc', 230, 520);
const camera = new THREE.PerspectiveCamera(20, 1, 5, 1200);

const pipeline = new Pipeline(canvas, scene, camera);
const pmrem = new THREE.PMREMGenerator(pipeline.renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.16;

const sun = new THREE.DirectionalLight('#fff3e2', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -130;
sc.right = 130;
sc.top = 130;
sc.bottom = -130;
sc.near = 20;
sc.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#d3ddef', '#efe2cf', 0.6);
scene.add(hemi);

let city: ReturnType<typeof buildCity>;
let cloud: ReturnType<typeof staticCloud>;
let traffic: Traffic;
let analyst: Analyst;
let pointCount = 0;
const visuals = new IntelVisuals();
scene.add(visuals.group);
const grid = new LensGrid();
const hud = new Hud(app);

function applySun(hour: number) {
  const t = (hour - 6) / 13;
  const el = THREE.MathUtils.degToRad(Math.max(3, 58 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))));
  const az = THREE.MathUtils.degToRad(-110 + 220 * t);
  const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  sun.position.copy(dir.multiplyScalar(260));
  sun.target.position.set(0, 0, 0);
  const elDeg = THREE.MathUtils.radToDeg(el);
  const low = 1 - THREE.MathUtils.smoothstep(elDeg, 4, 32);
  sun.color.set('#fff6ea').lerp(new THREE.Color('#ffb06a'), low * 0.85);
  sun.intensity = 2.4 + 1.4 * THREE.MathUtils.smoothstep(elDeg, 3, 25);
  hemi.intensity = 0.45 + 0.3 * THREE.MathUtils.smoothstep(elDeg, 3, 30);
  G.uNight.value = 1 - THREE.MathUtils.smoothstep(elDeg, 3, 16);
  if (city) city.lampGlow.color.setRGB(1, 0.75, 0.5).multiplyScalar(0.6 + G.uNight.value * 5);
}

// ------------------------------------------------------------------ input
const pointer = { x: innerWidth / 2, y: innerHeight / 2, has: false };
const lens = { x: innerWidth / 2, y: innerHeight / 2, vx: 0, vy: 0 };
let presence = 0;
let slow = false;
let slowAmt = 0;
let tracked: Agent | null = null;
let primaryId: string | null = null;
let pendingId: string | null | undefined;
let pendingSince = 0;
let focus = 0;
let followOn = false;
let offscreenFor = 0;
let floodT = 0; // 0 = lens, 1 = the machine view fills the screen

addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  const t = e.target as Element;
  pointer.has = !t.closest?.('.dialkit-root');
});
document.documentElement.addEventListener('mouseleave', () => (pointer.has = false));
addEventListener('blur', () => (pointer.has = false));

function trackUnderPointer() {
  const p = pick();
  tracked = p?.agent ?? null;
  followOn = !!tracked;
}

// Trackpad-first navigation: drag rotates, two-finger scroll pans, pinch zooms.
// Mouse fallbacks: shift / right-drag pans, ⌘-scroll zooms. A click without movement tracks.
let drag: { id: number; x: number; y: number; sx: number; sy: number; pan: boolean; click: boolean; moved: boolean } | null = null;

/** Shifts the camera by a screen-space delta (measured on the ground at the screen centre). */
function panBy(dx: number, dy: number) {
  const k = cfg.camera.invertPan ? -1 : 1;
  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const a = groundAt(cx, cy, gA);
  const b = groundAt(cx + dx * k, cy + dy * k, gB);
  if (!a || !b) return;
  // move the live target too: panning is 1:1 (the trackpad already supplies momentum)
  rig.tx += b.x - a.x;
  rig.tz += b.z - a.z;
  rig.ttx += b.x - a.x;
  rig.ttz += b.z - a.z;
  rig.pivot = null;
  followOn = false;
}

canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.has = true;
  const pan = e.button !== 0 || e.shiftKey;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan, click: !pan, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    canvas.classList.add(drag.pan ? 'is-panning' : 'is-orbiting');
  }
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (drag.pan) panBy(-dx, -dy);
  else {
    const k = cfg.camera.invertRotate ? -1 : 1;
    rig.orbitT += dx * 0.3 * k;
    rig.pitchT = THREE.MathUtils.clamp(rig.pitchT - dy * 0.2 * k, 16, 88);
    writeCam('orbit', rig.orbitT);
    writeCam('pitch', rig.pitchT);
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && drag.click && e.type === 'pointerup') trackUnderPointer();
  drag = null;
  canvas.classList.remove('is-panning', 'is-orbiting');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let gesture: { zoom: number } | null = null;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey) {
      // pinch (Chrome / Firefox / Edge report it as ctrl+wheel); Safari uses gesture events below
      if (!gesture) zoomTo(rig.zoomT * Math.exp(-dy * 0.012), e.clientX, e.clientY);
    } else if (e.metaKey || e.altKey) zoomTo(rig.zoomT * Math.exp(dy * 0.0016), e.clientX, e.clientY);
    else panBy(dx, dy);
  },
  { passive: false },
);
type GestureLike = Event & { scale: number; clientX: number; clientY: number };
canvas.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  gesture = { zoom: rig.zoomT };
});
canvas.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  const g = e as GestureLike;
  if (gesture) zoomTo(gesture.zoom * g.scale, g.clientX, g.clientY);
});
canvas.addEventListener('gestureend', (e) => {
  e.preventDefault();
  gesture = null;
});
addEventListener('keydown', (e) => {
  if ((e.target as Element)?.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === ' ') {
    slow = true;
    e.preventDefault();
  }
  if (e.key === 'Escape') tracked = null;
  if (e.key === '1') kit.setValue('view', 'lidar');
  if (e.key === '2') kit.setValue('view', 'depth');
  if (e.key === '+' || e.key === '=') zoomTo(rig.zoomT * 1.6);
  if (e.key === '-' || e.key === '_') zoomTo(rig.zoomT / 1.6);
  if (e.key === '0') resetCamera();
});
addEventListener('keyup', (e) => {
  if (e.key === ' ') slow = false;
});

// ------------------------------------------------------------------ helpers
const v3 = new THREE.Vector3();
function toScreen(x: number, y: number, z: number) {
  v3.set(x, y, z).project(camera);
  return { x: (v3.x + 1) * 0.5 * innerWidth, y: (1 - v3.y) * 0.5 * innerHeight, z: v3.z };
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const gA = new THREE.Vector3();
const gB = new THREE.Vector3();
function groundAt(x: number, y: number, out: THREE.Vector3) {
  ndc.set((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(groundPlane, out);
}

/** Screen pixels per metre at a world point (for pick radii that grow as the camera moves in). */
function pxPerM(x: number, y: number, z: number) {
  const f = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  return f / Math.max(1, camera.position.distanceTo(v3.set(x, y, z)));
}

function agentBox(a: Agent) {
  const c = Math.cos(Math.atan2(a.hx, a.hz));
  const s = Math.sin(Math.atan2(a.hx, a.hz));
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const lx of [-a.wid / 2 - 0.3, a.wid / 2 + 0.3])
    for (const lz of [-a.len / 2 - 0.3, a.len / 2 + 0.3])
      for (const y of [0, a.hgt + 0.3]) {
        const wx = a.x + lx * c + lz * s;
        const wz = a.z - lx * s + lz * c;
        const p = toScreen(wx, y, wz);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function pick(): { agent?: Agent; head?: SignalHead } | null {
  if (!traffic) return null;
  let best: Agent | null = null;
  let bd = 70;
  for (const a of traffic.agents) {
    const body = 0.45 * Math.max(a.len, a.hgt) * pxPerM(a.x, a.hgt * 0.5, a.z);
    const p = toScreen(a.x, a.hgt * 0.5, a.z);
    const r = Math.max(a.kind === 'ped' ? 6 : a.kind === 'bike' ? 8 : 14, body);
    const d = Math.hypot(p.x - pointer.x, p.y - pointer.y) - r;
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  if (best && bd < 40) return { agent: best };
  for (const h of city.signals) {
    const p = toScreen(h.pos.x, h.pos.y, h.pos.z);
    if (Math.hypot(p.x - pointer.x, p.y - pointer.y) < 34) return { head: h };
  }
  return best ? { agent: best } : null;
}

// ------------------------------------------------------------------ x-ray
// Sight lines from the camera to the subject (its padded box corners and centre) are tested
// against every building footprint and tree crown; whatever they pass through fades as a whole.
const PAD_H = 0.16;
const xrayWant = new Uint8Array(1024);
const xrayFade = new Float32Array(1024);
const sight = Array.from({ length: 9 }, () => new THREE.Vector3());

function segHitsBox(a: THREE.Vector3, b: THREE.Vector3, lo: [number, number, number], hi: [number, number, number]) {
  const o = [a.x, a.y, a.z];
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return false;
      continue;
    }
    let ta = (lo[i] - o[i]) / d[i];
    let tb = (hi[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

function segHitsSphere(a: THREE.Vector3, b: THREE.Vector3, cx: number, cy: number, cz: number, r: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  const px = a.x + dx * t - cx;
  const py = a.y + dy * t - cy;
  const pz = a.z + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

function updateXray(dt: number, s: Agent | null) {
  xrayWant.fill(0);
  if (s) {
    const hl = s.len / 2 + 0.8;
    const hw = s.wid / 2 + 0.8;
    let k = 0;
    for (const u of [-1, 1])
      for (const v of [-1, 1])
        for (const y of [0.3, s.hgt + 0.3]) sight[k++].set(s.x + s.hx * hl * u + s.hz * hw * v, y, s.z + s.hz * hl * u - s.hx * hw * v);
    sight[8].set(s.x, s.hgt * 0.5, s.z);
    const cam = camera.position;
    city.footprints.forEach((f, i) => {
      if (sight.some((p) => segHitsBox(cam, p, [f.x0, 0, f.z0], [f.x1, PAD_H + f.h + 1.2, f.z1]))) xrayWant[i] = 1;
    });
    city.trees.forEach((t, i) => {
      const cy = t.y + 2.6 + t.r;
      if (sight.some((p) => segHitsSphere(cam, p, t.x, cy, t.z, t.r * 1.05))) xrayWant[XRAY_TREES + i] = 1;
    });
  }
  const k = 1 - Math.exp(-dt * 8);
  const tex = G.uFade.value;
  const data = tex.image.data as Uint8Array;
  let dirty = false;
  const step = (i: number) => {
    let f = xrayFade[i] + (xrayWant[i] - xrayFade[i]) * k;
    if (!xrayWant[i] && f < 0.004) f = 0;
    xrayFade[i] = f;
    const byte = Math.round(f * 255);
    if (data[i] !== byte) {
      data[i] = byte;
      dirty = true;
    }
  };
  for (let i = 0; i < city.footprints.length; i++) step(i);
  for (let i = 0; i < city.trees.length; i++) step(XRAY_TREES + i);
  if (dirty) tex.needsUpdate = true;
}

// ------------------------------------------------------------------ resize
let quality = '';
let sized = { w: 0, h: 0 };
function resize() {
  // a page booted in a hidden tab / collapsed pane has no size yet — wait for a real one
  if (!innerWidth || !innerHeight) return;
  sized = { w: innerWidth, h: innerHeight };
  const q = cfg.post.quality;
  quality = q;
  const cap = q === 'ultra' ? 2 : q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 1;
  const dpr = Math.min(devicePixelRatio || 1, cap);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipeline.setSize(innerWidth, innerHeight, dpr);
  visuals.setResolution(innerWidth, innerHeight);
  G.uDpr.value = dpr;
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ camera
// The rig orbits a ground target. Zoom, orbit and pitch mirror the panel; wheel, drag and keys
// write back to it so the sliders always show the live framing.
let clock = 0;
let introStart = 0.15;
const CAM_END = { az: 34, el: 54, dist: 250 };
const CAM_START = { az: 12, el: 84, dist: 320 };
const ZOOM_MAX = 8;
// the panel defaults are the home framing: the intro flies into it and reset returns to it
const HOME = { zoom: dialConfig.camera.zoom[0], orbit: dialConfig.camera.orbit[0], pitch: dialConfig.camera.pitch[0] };
const rig = {
  zoom: HOME.zoom,
  zoomT: HOME.zoom,
  orbit: HOME.orbit,
  orbitT: HOME.orbit,
  pitch: HOME.pitch,
  pitchT: HOME.pitch,
  tx: 0,
  tz: 0,
  ttx: 0,
  ttz: 0,
  pivot: null as THREE.Vector3 | null,
};
const panelCam = { ...HOME }; // last values written to / read from the panel

function writeCam(k: keyof typeof panelCam, v: number) {
  const r = k === 'orbit' ? Math.round(((((v % 360) + 540) % 360) - 180) * 2) / 2 : Math.round(v * 100) / 100;
  if (panelCam[k] === r) return;
  panelCam[k] = r;
  kit.setValue(`camera.${k}`, r);
}

function zoomTo(z: number, sx?: number, sy?: number) {
  z = THREE.MathUtils.clamp(z, 1, ZOOM_MAX);
  if (z === rig.zoomT) return;
  // zoom about the ground under the cursor, unless the camera is following someone
  const following = tracked && followOn && cfg.tracking.follow;
  rig.pivot = sx != null && sy != null && !following ? groundAt(sx, sy, new THREE.Vector3()) : null;
  rig.zoomT = z;
  writeCam('zoom', z);
}

function resetCamera() {
  rig.zoomT = HOME.zoom;
  rig.orbitT = HOME.orbit + 360 * Math.round((rig.orbit - HOME.orbit) / 360);
  rig.pitchT = HOME.pitch;
  rig.ttx = rig.ttz = 0;
  rig.pivot = null;
  followOn = false;
  writeCam('zoom', HOME.zoom);
  writeCam('orbit', HOME.orbit);
  writeCam('pitch', HOME.pitch);
}

function updateRig(dt: number) {
  // panel → rig (only when a slider actually moved)
  const c = cfg.camera;
  if (c.zoom !== panelCam.zoom) {
    panelCam.zoom = c.zoom;
    rig.zoomT = c.zoom;
    rig.pivot = null;
  }
  if (c.orbit !== panelCam.orbit) {
    panelCam.orbit = c.orbit;
    rig.orbitT = c.orbit + 360 * Math.round((rig.orbit - c.orbit) / 360);
  }
  if (c.pitch !== panelCam.pitch) {
    panelCam.pitch = c.pitch;
    rig.pitchT = c.pitch;
  }

  const k = 1 - Math.exp(-dt / Math.max(0.02, c.smoothing));
  const nz = Math.exp(THREE.MathUtils.lerp(Math.log(rig.zoom), Math.log(rig.zoomT), k));
  if (rig.pivot) {
    // scale the rig about the pivot so the point under the cursor stays put
    const s = rig.zoom / nz;
    const P = rig.pivot;
    rig.tx = P.x + (rig.tx - P.x) * s;
    rig.tz = P.z + (rig.tz - P.z) * s;
    rig.ttx = P.x + (rig.ttx - P.x) * s;
    rig.ttz = P.z + (rig.ttz - P.z) * s;
  }
  rig.zoom = nz;
  if (Math.abs(Math.log(rig.zoomT / rig.zoom)) < 1e-4) {
    rig.zoom = rig.zoomT;
    rig.pivot = null;
  }

  if (tracked && followOn && cfg.tracking.follow) {
    // keep the subject framed, leading slightly in its direction of travel
    const lead = Math.min(6, tracked.v * 0.7);
    rig.ttx = tracked.x + tracked.hx * lead;
    rig.ttz = tracked.z + tracked.hz * lead;
  }
  // pan range opens up as you zoom in, so zooming back out drifts home to the intersection
  const maxPan = 25 + 70 * (1 - 1 / rig.zoom);
  const r = Math.hypot(rig.ttx, rig.ttz);
  if (r > maxPan) {
    rig.ttx *= maxPan / r;
    rig.ttz *= maxPan / r;
  }
  rig.tx += (rig.ttx - rig.tx) * k;
  rig.tz += (rig.ttz - rig.tz) * k;
  rig.orbit += (rig.orbitT - rig.orbit) * k;
  rig.pitch += (rig.pitchT - rig.pitch) * k;
}

function updateCamera() {
  const t = Math.min(1, Math.max(0, (clock - introStart) / 3.4));
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const aspectK = Math.max(1, 1.55 / camera.aspect);
  const lerp = THREE.MathUtils.lerp;
  // moving in also lowers the camera a little, towards a street-level read
  const pitch = Math.max(12, rig.pitch - cfg.camera.tiltIn * 24 * (1 - 1 / rig.zoom));
  const az = THREE.MathUtils.degToRad(lerp(CAM_START.az, CAM_END.az + rig.orbit, e) + Math.sin(clock * 0.05) * 1.2 * cfg.camera.sway);
  const el = THREE.MathUtils.degToRad(lerp(CAM_START.el, pitch, e));
  const dist = lerp(CAM_START.dist, CAM_END.dist / rig.zoom, e) * aspectK;
  const tx = rig.tx * e;
  const tz = rig.tz * e;
  camera.position.set(tx + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, tz + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(tx, 0, tz);
  return t;
}

// ------------------------------------------------------------------ frame
let last = 0;
let fps = 60;
let reading: Reading | null = null;
let lastSun = -1;
let lastAlert: { text: string; t: number } | null = null;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  clock += dt;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (cfg.post.quality !== quality || innerWidth !== sized.w || innerHeight !== sized.h) resize();

  // world time
  slowAmt += ((slow ? 1 : 0) - slowAmt) * (1 - Math.exp(-dt * 6));
  const simDt = dt * cfg.world.timeScale * (1 - 0.85 * slowAmt);
  traffic.density = cfg.world.traffic;
  traffic.jaywalkRate = cfg.world.jaywalkers;
  const n = Math.max(1, Math.ceil(simDt / (1 / 60)));
  for (let i = 0; i < n; i++) traffic.step(simDt / n, true);
  traffic.sync();
  analyst.update(simDt);
  if (tracked && !traffic.agents.includes(tracked)) tracked = null;
  if (cfg.world.sunHour !== lastSun) {
    lastSun = cfg.world.sunHour;
    applySun(lastSun);
  }
  city.sensorHead.rotation.y += dt * 9;
  G.uTime.value += dt * (1 - 0.7 * slowAmt);
  G.uMode.value = cfg.view === 'depth' ? 2 : 0;
  G.uColorBy.value = cfg.machine.colorBy === 'height' ? 1 : cfg.machine.colorBy === 'class' ? 2 : 0;
  G.uPointSize.value = cfg.machine.pointSize;
  G.uSweep.value = cfg.machine.sweep;
  const L = cfg.layers;
  G.uContours.value = L.depthContours ? 1 : 0;
  G.uAgentPts.value = L.agentPoints ? 1 : 0;
  cloud.ground.visible = L.groundRings;
  cloud.facades.visible = cloud.canopy.visible = L.facadePoints;
  hud.setScale(cfg.ui.scale);
  hud.setPanels(cfg.ui.hudPanels);

  updateRig(dt);
  const introT = updateCamera();
  camera.updateMatrixWorld();

  // a tracked road user that leaves the frame lets go, so the lens returns to the cursor
  if (tracked && cfg.tracking.releaseOffscreen) {
    const p = toScreen(tracked.x, tracked.hgt * 0.5, tracked.z);
    const out = p.z > 1 || p.x < -30 || p.y < -30 || p.x > innerWidth + 30 || p.y > innerHeight + 30;
    offscreenFor = out ? offscreenFor + dt : 0;
    if (offscreenFor > 0.35) tracked = null;
  }

  // lens follows the cursor — or the road user being tracked (unless the lens is unlocked)
  const lensOnTracked = !!tracked && cfg.tracking.lensLock;
  let tx = pointer.x;
  let ty = pointer.y;
  if (tracked && lensOnTracked) {
    const p = toScreen(tracked.x, tracked.hgt * 0.5, tracked.z);
    tx = p.x;
    ty = p.y;
  }
  const phys = springToPhysics(cfg.lens.follow as Parameters<typeof springToPhysics>[0]);
  for (let i = 0; i < 4; i++) {
    const h = dt / 4;
    lens.vx += (phys.stiffness * (tx - lens.x) - phys.damping * lens.vx) * h;
    lens.vy += (phys.stiffness * (ty - lens.y) - phys.damping * lens.vy) * h;
    lens.x += lens.vx * h;
    lens.y += lens.vy * h;
  }
  // tracking floods the whole screen with the machine view; releasing pulls it back into the lens
  const flooding = !!tracked && cfg.tracking.fullscreen;
  floodT = THREE.MathUtils.clamp(floodT + ((flooding ? 1 : -1.25) * dt) / cfg.tracking.floodTime, 0, 1);
  const fe = floodT * floodT * (3 - 2 * floodT);
  // exponential growth reads as a flood rather than a zoom; 1.8× the diagonal clears the organic edge
  const lensR = cfg.lens.radius * Math.pow(Math.max(1, (Math.hypot(innerWidth, innerHeight) * 1.8) / cfg.lens.radius), fe);
  const want = (pointer.has || lensOnTracked || floodT > 0) && introT >= 1 ? 1 : 0;
  presence += (want - presence) * (1 - Math.exp(-dt * (want ? 6 : 4)));

  // focus: what the intelligence is reading
  const cand = want ? (tracked ? { agent: tracked } : pick()) : null;
  const candId = cand ? (cand.agent ? `a${cand.agent.id}` : `s${cand.head!.dir}`) : null;
  if (candId === primaryId) pendingId = undefined;
  else {
    if (pendingId !== candId) {
      pendingId = candId;
      pendingSince = clock;
    }
    if (clock - pendingSince > (candId ? cfg.intelligence.dwell : cfg.intelligence.dwell * 2 + 160) / 1000 || tracked) {
      primaryId = candId;
      pendingId = undefined;
    }
  }
  let pAgent: Agent | null = null;
  let pHead: SignalHead | null = null;
  if (primaryId?.startsWith('a')) pAgent = traffic.agents.find((a) => `a${a.id}` === primaryId) ?? null;
  else if (primaryId?.startsWith('s')) pHead = city.signals.find((h) => `s${h.dir}` === primaryId) ?? null;
  if (!pAgent && !pHead) primaryId = null;
  reading = pAgent ? analyst.read(pAgent) : pHead ? analyst.readSignal(pHead) : null;
  focus += ((reading ? 1 : 0) - focus) * (1 - Math.exp(-dt * 8));

  // risk colouring of detection boxes
  const risky = new Set<Agent>();
  const caution = new Set<Agent>();
  for (const c of analyst.conflicts) {
    if (c.ttc < 2.4) {
      risky.add(c.a);
      risky.add(c.b);
    } else {
      caution.add(c.a);
      caution.add(c.b);
    }
  }
  // zoomed in, road users far from the framing skip the shadow pass (they are tiny or off screen)
  const shadowR = 60 + 140 / rig.zoom;
  for (const a of traffic.agents) {
    a.vis.body.castShadow = Math.hypot(a.x - rig.tx, a.z - rig.tz) < shadowR;
    const cls = CLASS[a.kind === 'ped' ? 'ped' : a.kind === 'bike' ? 'bike' : a.kind === 'bus' ? 'bus' : 'car'];
    const m = a.vis.boxMat;
    if (risky.has(a)) m.color.setRGB(6, 0.5, 0.35);
    else if (caution.has(a)) m.color.setRGB(5, 2.7, 0.4);
    else m.color.copy(cls).multiplyScalar(a === pAgent ? 6 : 2.6);
    m.opacity = L.boxes ? 1 : 0;
    a.vis.footMat.opacity = L.boxes ? (a === pAgent ? 0.9 : 0.45) : 0;
  }

  // world-space relation graphics
  const from = reading ? reading.at : null;
  let rels = reading?.relations ?? [];
  if (L.connections === 'inside')
    rels = rels.filter((r) => {
      // only relations whose far end sits inside the revealed area
      const p = toScreen(r.to.x, r.to.y, r.to.z);
      return presence > 0.5 && Math.hypot(p.x - lens.x, p.y - lens.y) < lensR * 0.9;
    });
  const arcPaths = visuals.updateLinks(dt, clock, from, rels, L.connections !== 'off' && !!reading);
  const tone = reading?.verdict === 'risk' ? 'risk' : reading?.verdict === 'caution' ? 'caution' : 'focus';
  visuals.updateRing(dt, clock, L.focusRing ? pAgent : null, tone);
  visuals.updateAlerts(clock, L.alerts ? analyst.conflicts.filter((c) => c.ttc < 2.4) : [], pAgent);
  visuals.updateTrajectories(traffic.agents, L.trajectories, pAgent);
  visuals.updateGhosts(L.ghosts ? pAgent : null);

  // x-ray: whole buildings and trees standing between the camera and the subject turn see-through
  updateXray(dt, cfg.tracking.xray === 'tracked' ? tracked : cfg.tracking.xray === 'focused' ? (tracked ?? pAgent) : null);
  G.uGhost.value = cfg.tracking.xrayGhost;

  // lens grid
  grid.resize(innerWidth, innerHeight, cfg.lens.cell, cfg.lens.tiers);
  const regions: Region[] = [];
  if (pAgent && focus > 0.05) regions.push({ ...agentBox(pAgent), s: 0.92 * focus });
  if (pHead && focus > 0.05) {
    const p = toScreen(pHead.pos.x, pHead.pos.y, pHead.pos.z);
    regions.push({ x: p.x - 10, y: p.y - 14, w: 20, h: 28, s: 0.92 * focus });
  }
  const corridors: Corridor[] = [];
  if (L.corridor && L.connections !== 'off')
    for (const path of arcPaths) {
      const pts = path.filter((_, i) => i % 2 === 0).map((p) => toScreen(p.x, p.y, p.z));
      corridors.push({ pts, w: grid.fineSize() * 1.05, v: grid.corridorValue() });
      const end = path[path.length - 1];
      const e = toScreen(end.x, end.y, end.z);
      regions.push({ x: e.x - 14, y: e.y - 14, w: 28, h: 28, s: 0.8 });
    }
  const waveT = (clock - introStart - 3.0) / 1.5;
  grid.update(dt, {
    lensX: lens.x,
    lensY: lens.y,
    radius: lensR,
    presence,
    organic: cfg.lens.organic,
    drift: cfg.lens.drift,
    diamond: cfg.lens.diamond,
    jitter: 0.08,
    attack: cfg.lens.attack,
    release: cfg.lens.release,
    processing: L.scanBoxes ? cfg.lens.processing : 0,
    time: clock,
    regions,
    corridors,
    wave: waveT >= 0 && waveT <= 1 ? { x: innerWidth / 2, y: innerHeight / 2, t: waveT } : null,
  });
  pipeline.uploadGrid(grid);
  const cu = (k: string) => pipeline.composite.u(k);
  cu('uTime').value = clock;
  cu('uLens').value.set(lens.x, lens.y);
  cu('uRadius').value = lensR;
  cu('uPresence').value = presence;
  cu('uGrowth').value = cfg.lens.growth === 'blocks' ? 1 : 0;
  cu('uEdgeGlow').value = cfg.machine.edgeGlow;
  cu('uLattice').value = L.lattice ? 1 : 0;
  cu('uScanBoxes').value = L.scanBoxes ? 1 : 0;
  cu('uGridReveal').value = L.gridMarks ? 0.08 : 0;
  (cu('uEdge').value as THREE.Color).set(cfg.machine.edgeColor).multiplyScalar(1.5);
  pipeline.setPost({
    ao: cfg.post.quality === 'low' ? 0 : cfg.post.ao,
    tiltShift: cfg.post.tiltShift,
    bloom: cfg.post.bloom,
    bloomThreshold: cfg.post.bloomThreshold,
    grain: cfg.post.grain,
    vignette: cfg.post.vignette,
    exposure: cfg.post.exposure,
    focusY: (presence > 0.1 ? lens.y : innerHeight * 0.55) / innerHeight,
    aoRadius: Math.max(1.4, 5 / Math.sqrt(rig.zoom)),
    aoHalfRes: cfg.post.quality !== 'ultra',
  });
  pipeline.render(dt);

  // labels on whatever the lens is revealing
  const labels: { code: string; sub: string; x: number; y: number; tone: string; a: number; d: number }[] = [];
  if (cfg.intelligence.labels && presence > 0.05) {
    for (const a of traffic.agents) {
      const top = toScreen(a.x, a.hgt + (a.kind === 'ped' ? 0.9 : 1.1), a.z);
      if (top.x < 0 || top.x > innerWidth || top.y < 0 || top.y > innerHeight) continue;
      const mid = toScreen(a.x, a.hgt * 0.5, a.z);
      if (grid.coverage(mid.x, mid.y) < 0.5 || a === pAgent) continue;
      const sub = a.kind === 'ped' ? (a.state === 'wait' ? 'waiting' : a.state === 'cross' ? 'crossing' : `${(a.v * 3.6).toFixed(0)} km/h`) : `${Math.round(a.v * 3.6)} km/h`;
      const t = risky.has(a) ? 'risk' : caution.has(a) ? 'caution' : a.kind === 'ped' ? 'ped' : a.kind === 'bike' ? 'bike' : 'car';
      labels.push({ code: a.code, sub, x: top.x, y: top.y, tone: t, a: presence, d: Math.hypot(mid.x - lens.x, mid.y - lens.y) });
    }
    labels.sort((x, y) => x.d - y.d);
    labels.length = Math.min(labels.length, 12);
  }
  hud.labelsRender(labels);

  let anchor: { x: number; y: number } | null = null;
  if (reading) {
    const p = toScreen(reading.at.x, reading.at.y, reading.at.z);
    anchor = { x: p.x, y: p.y };
  }
  const cardAt = tracked && anchor ? { x: anchor.x + 40, y: anchor.y } : pointer;
  hud.cardRender(cfg.intelligence.card ? reading : null, cardAt, anchor, innerWidth, innerHeight, dt, clock);

  let risks = 0;
  for (const c of analyst.conflicts) if (c.ttc < 2.4) risks++;
  const top = analyst.conflicts.find((c) => c.ttc < 2.4);
  if (top) lastAlert = { text: `${top.a.code} × ${top.b.code} · TTC ${top.ttc.toFixed(1)}s`, t: clock };
  hud.telemetry({
    tracked: traffic.agents.filter((a) => Math.abs(a.x) < 80 && Math.abs(a.z) < 80).length,
    risks,
    ns: traffic.signals.light('NS'),
    ew: traffic.signals.light('EW'),
    nsT: traffic.signals.remaining('NS'),
    ewT: traffic.signals.remaining('EW'),
    fps,
    points: pointCount + traffic.agents.length * 400,
    tracking: tracked?.code ?? null,
    alert: lastAlert && clock - lastAlert.t < 4 ? lastAlert.text : null,
  });
}

(window as unknown as { __ms: unknown }).__ms = {
  get reading() {
    return reading;
  },
  get primary() {
    return primaryId;
  },
  get presence() {
    return presence;
  },
  get rig() {
    return rig;
  },
  get tracked() {
    return tracked?.code ?? null;
  },
  /** Debug: a road user hidden behind a building from the current camera (for testing the x-ray). */
  occluded() {
    const c = camera.position;
    for (const a of traffic.agents) {
      const p = toScreen(a.x, a.hgt * 0.5, a.z);
      if (p.x < 80 || p.y < 80 || p.x > innerWidth - 80 || p.y > innerHeight - 80) continue;
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        const x = c.x + (a.x - c.x) * t;
        const y = c.y + (a.hgt * 0.5 - c.y) * t;
        const z = c.z + (a.z - c.z) * t;
        if (city.footprints.some((f) => x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && y < f.h + 0.3)) return { code: a.code, x: p.x, y: p.y };
      }
    }
    return null;
  },
  track(code: string) {
    tracked = traffic.agents.find((a) => a.code === code) ?? null;
    followOn = false;
  },
  pipeline,
  kit,
  get risks() {
    return analyst ? analyst.conflicts.filter((c) => c.ttc < 2.4).length : 0;
  },
  get conflicts() {
    return analyst ? analyst.conflicts.length : 0;
  },
  riskScreen() {
    const c = analyst?.conflicts.find((k) => k.ttc < 2.4);
    if (!c) return null;
    const a = c.a.kind === 'ped' ? c.b : c.a;
    return toScreen(a.x, a.hgt * 0.5, a.z);
  },
};

// ------------------------------------------------------------------ boot
setTimeout(() => {
  city = buildCity();
  scene.add(city.group);
  cloud = staticCloud(G.uSensor.value, city.footprints, city.trees);
  pointCount = cloud.count;
  scene.add(cloud.group);
  traffic = new Traffic(city.signals);
  scene.add(traffic.group);
  traffic.sync();
  analyst = new Analyst(traffic, city.signals);
  applySun(cfg.world.sunHour);
  lastSun = cfg.world.sunHour;
  resize();
  void groupOf;
  requestAnimationFrame((t) => {
    last = t;
    clock = 0;
    introStart = 0.2;
    frame(t);
    boot.classList.add('is-done');
    hud.setLoaded();
  });
}, 60);
