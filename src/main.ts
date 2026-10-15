import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Pipeline } from './render/pipeline';
import { LensGrid } from './lens/grid';
import './factory.css';
import { mountFactoryUI } from './factory-ui';
import { buildConveyorAnatomy } from './conveyor-anatomy';
import { addFactoryDetails, updateInspection } from './factory-details';

const app = document.querySelector<HTMLDivElement>('#app')!;
const factoryUI = mountFactoryUI(app);
const canvas = app.querySelector('canvas')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#efeee8');
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 400);
const pipeline = new Pipeline(canvas, scene, camera);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .46; controls.minDistance = 7; controls.maxDistance = 95;
controls.target.set(0, 1, 0);
let defaultView = true;
controls.addEventListener('start', () => { defaultView = false; });
function framingZoom() { return innerWidth / innerHeight > 1.45 ? 1.23 : 1.04; }
function reset() { defaultView = true; camera.zoom = framingZoom(); camera.updateProjectionMatrix(); controls.minDistance = 7; camera.position.set(35, 29.8, 38.4); controls.target.set(0, 1, 0); controls.update(); }
reset();
scene.add(new THREE.HemisphereLight('#ffffff', '#a69e8f', 2));
const sun = new THREE.DirectionalLight('#fff7e9', 3.5); sun.position.set(-20, 35, 15); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 100 }); sun.shadow.normalBias = .035; scene.add(sun);
const clay = new THREE.MeshStandardMaterial({ color: '#dcdad3', roughness: .75, metalness: .12 });
const lightClay = new THREE.MeshStandardMaterial({ color: '#f1eee6', roughness: .6, metalness: .15 });
const dark = new THREE.MeshStandardMaterial({ color: '#888b88', roughness: .8 });
const cyan = new THREE.LineBasicMaterial({ color: '#52f3dd', transparent: true, opacity: .65 });
const amber = new THREE.LineBasicMaterial({ color: '#ffbd63', transparent: true, opacity: .8 });
const machineSurface = new THREE.MeshBasicMaterial({ color: '#102b31', transparent: true, opacity: .38, depthWrite: false });
const robots: { joints: THREE.Group[]; tip: THREE.Group; base: THREE.Group; index: number }[] = [];
const rollers: THREE.Object3D[] = [];
const geometryCache = new Map<string, THREE.BufferGeometry>();
const edgesCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
function sharedGeometry(key: string, create: () => THREE.BufferGeometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) { geometry = create(); geometryCache.set(key, geometry); }
  return geometry;
}
function part(g: THREE.BufferGeometry, parent: THREE.Object3D, pos: [number, number, number], mat = clay, technical = true) {
  const node = new THREE.Group(); node.position.set(...pos); parent.add(node);
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; node.add(mesh);
  if (technical) { const body = new THREE.Mesh(g, machineSurface); body.layers.set(1); node.add(body); let edges = edgesCache.get(g); if (!edges) { edges = new THREE.EdgesGeometry(g, 28); edgesCache.set(g, edges); } const edge = new THREE.LineSegments(edges, cyan); edge.layers.set(1); node.add(edge); }
  return node;
}
function box(w: number, h: number, d: number, parent: THREE.Object3D, x: number, y: number, z: number, mat = clay, radius = .06) { return part(sharedGeometry(`box:${w}:${h}:${d}:${radius}`, () => new RoundedBoxGeometry(w, h, d, 2, radius)), parent, [x, y, z], mat); }
function cylinder(r: number, h: number, parent: THREE.Object3D, x: number, y: number, z: number, mat = clay) { return part(sharedGeometry(`cylinder:${r}:${h}`, () => new THREE.CylinderGeometry(r, r, h, 24)), parent, [x, y, z], mat); }
const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.55; floor.receiveShadow = true; scene.add(floor);
box(32, .55, 21, scene, 0, -.25, 0, lightClay, .18);
const gridHelper = new THREE.GridHelper(32, 32, '#22565c', '#163c42'); gridHelper.position.y = .05; gridHelper.layers.set(1); scene.add(gridHelper);
// Twin conveyors: every roller and parcel shares its transform between both render layers.
for (const z of [-4, 4]) {
  const cover = box(27, .45, 3.4, scene, 0, 1.15, z, dark);
  // Omit the solid casing from the cutaway so the chassis and transmission can be read.
  for (const child of cover.children) if (child.layers.isEnabled(1)) child.visible = false;
  for (const side of [-1, 1]) { box(27.3, .35, .18, scene, 0, 1.45, z + side * 1.8, lightClay); box(27, .15, .15, scene, 0, .65, z + side * 1.5); }
  for (let x = -12.8; x < 13; x += .48) { const roll = cylinder(.19, 3.2, scene, x, 1.5, z, lightClay); roll.rotation.x = Math.PI / 2;
    for (const child of roll.children) if (child instanceof THREE.Mesh && child.layers.isEnabled(1)) {
      child.material = machineSurface.clone(); (child.material as THREE.MeshBasicMaterial).opacity = .12;
    }
    rollers.push(roll); }
  for (const x of [-12, -6, 0, 6, 12]) for (const side of [-1, 1]) { box(.22, 1, .22, scene, x, .5, z + side * 1.4); box(.7, .12, .65, scene, x, .08, z + side * 1.4, dark); }
  // Vision inspection gates.
  for (const side of [-1, 1]) box(.3, 4, .32, scene, -8, 2, z + side * 2.1);
  box(.65, .35, 4.6, scene, -8, 4.1, z, lightClay);
  box(.65, .4, .8, scene, -8, 3.75, z, dark);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), new THREE.MeshBasicMaterial({ color: '#47ffe0', transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false })); scan.rotation.y = Math.PI / 2; scan.position.set(-8, 2.6, z); scan.layers.set(1); scene.add(scan);
}
// Two articulated pick-and-place cells, with actual two-link inverse kinematics.
for (let index = 0; index < 2; index++) {
  const x = index === 0 ? -2 : 6;
  const base = new THREE.Group(); base.position.set(x, 0, 0); scene.add(base);
  box(3.4, .28, 3.4, base, 0, .15, 0, dark); cylinder(1.05, .75, base, 0, .65, 0, lightClay);
  const yaw = new THREE.Group(); yaw.position.y = 1.05; base.add(yaw);
  cylinder(.75, .5, yaw, 0, 0, 0);
  const shoulder = new THREE.Group(); shoulder.position.y = .45; yaw.add(shoulder);
  const joint = cylinder(.62, 1.1, shoulder, 0, 0, 0, dark); joint.rotation.x = Math.PI / 2;
  box(.85, 3.5, .9, shoulder, 0, 1.75, 0, lightClay, .2); box(.12, 2.5, .65, shoulder, .48, 1.7, 0, dark);
  const elbow = new THREE.Group(); elbow.position.y = 3.5; shoulder.add(elbow);
  const ej = cylinder(.48, 1.15, elbow, 0, 0, 0); ej.rotation.x = Math.PI / 2;
  box(.65, 3.3, .7, elbow, 0, 1.65, 0, lightClay, .15);
  const tip = new THREE.Group(); tip.position.y = 3.3; elbow.add(tip);
  cylinder(.4, .45, tip, 0, 0, 0, dark);
  box(1.2, .25, .6, tip, 0, -.3, 0);
  for (const side of [-1, 1]) box(.14, .65, .45, tip, side * .48, -.65, 0, dark);
  robots.push({ joints: [yaw, shoulder, elbow], tip, base, index });
  for (const dx of [-1.25, 1.25]) for (const dz of [-1.25, 1.25]) cylinder(.1, .08, base, dx, .32, dz, dark);
}
// Industrial equipment and anatomical robot overlays share the same articulated hierarchy.
const details = addFactoryDetails(scene, robots, clay, lightClay, dark);
const conveyorAnatomy = buildConveyorAnatomy(scene);
const pathPoints = [new THREE.Vector3(-13, 1.8, -4), new THREE.Vector3(13, 1.8, -4), new THREE.Vector3(13, 1.8, 4), new THREE.Vector3(-13, 1.8, 4)];
const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPoints), amber); route.layers.set(1); scene.add(route);
const parcels: { root: THREE.Group; id: number; label: HTMLDivElement; picked: boolean }[] = [];
for (let i = 0; i < 14; i++) {
  const root = new THREE.Group(); scene.add(root);
  box(1.35, .85, 1.15, root, 0, .43, 0, lightClay, .09);
  box(.15, .025, 1.15, root, 0, .87, 0, dark);
  box(.4, .025, .3, root, .35, .87, .1, clay);
  const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.15, 1.4)), i % 3 ? cyan : amber); bounds.position.y = .48; bounds.layers.set(1); root.add(bounds);
  const label = document.createElement('div'); label.className = 'unit-label'; app.querySelector('#labels')!.append(label);
  parcels.push({ root, id: i, label, picked: false });
}
let section = true;
let paused = false, full = false, slow = false, t = 0, last = performance.now(), selected: number | null = null;
let pointerDown = { x: 0, y: 0 }; const cursor = new THREE.Vector2(innerWidth * .57, innerHeight * .54); let presence = .0;
window.addEventListener('pointermove', e => { cursor.set(e.clientX, e.clientY); presence = section ? 1 : 0; });
canvas.addEventListener('pointerleave', () => { presence = 0; });
canvas.addEventListener('pointerdown', e => { pointerDown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => { if (Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 5) return; let best = 40; selected = null;
  for (const p of parcels) { const v = p.root.position.clone().project(camera); const d = Math.hypot((v.x + 1) * innerWidth / 2 - e.clientX, (1 - v.y) * innerHeight / 2 - e.clientY); if (d < best) { best = d; selected = p.id; } } });
const pauseButton = app.querySelector<HTMLButtonElement>('#pause')!;
pauseButton.onclick = () => { paused = !paused; pauseButton.textContent = paused ? '▶' : 'Ⅱ'; pauseButton.setAttribute('aria-label', paused ? 'Resume production' : 'Pause production'); };
const modeButton = app.querySelector<HTMLButtonElement>('#mode')!;
const physicalButton = app.querySelector<HTMLButtonElement>('#physical')!;
function setSection(value: boolean) {
  section = value; selected = null; full = false; presence = value ? 1 : 0;
  modeButton.classList.toggle('active', value); physicalButton.classList.toggle('active', !value);
}
modeButton.onclick = () => setSection(true);
physicalButton.onclick = () => setSection(false);
app.querySelector<HTMLButtonElement>('#detail')!.onclick = () => {
  setSection(true); defaultView = false; camera.zoom = 1; camera.updateProjectionMatrix(); selected = null; controls.target.set(10.5, 1.1, 4.8); camera.position.set(20, 9, 15); controls.minDistance = 7;
  controls.update(); cursor.set(innerWidth / 2, innerHeight / 2); presence = 1;
};
app.querySelector<HTMLButtonElement>('#reset')!.onclick = () => { selected = null; reset(); };
app.querySelector<HTMLButtonElement>('#home')!.onclick = () => { selected = null; reset(); };
app.querySelector<HTMLButtonElement>('#inspect-drive')!.onclick = () => app.querySelector<HTMLButtonElement>('#detail')!.click();
for (const button of app.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.onclick = () => {
  for (const item of app.querySelectorAll('[data-tab]')) item.classList.toggle('active', item === button);
  const tab = button.dataset.tab;
  app.querySelector<HTMLDetailsElement>('#structure-panel')!.open = tab !== 'technical';
  app.querySelector<HTMLDetailsElement>('#drive-panel')!.open = tab === 'systems';
  app.querySelector<HTMLDetailsElement>('#spec-panel')!.open = tab === 'technical';
  if (tab === 'overview') { selected = null; reset(); }
};
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); slow = true; } if (e.code === 'Escape') selected = null; });
window.addEventListener('keyup', e => { if (e.code === 'Space') slow = false; });
window.addEventListener('blur', () => { slow = false; });
const grid = new LensGrid();
// Start conservatively; sustained slow frames lower GPU load without changing the model.
let quality = 1;
let sampleStart = 0, sampleFrames = 0, slowSamples = 0;
const pixelRatios = [.75, 1, 1.5];
const qualitySelect = document.createElement('select');
qualitySelect.setAttribute('aria-label', 'Preview quality');
qualitySelect.innerHTML = '<option value="auto">Auto quality</option><option value="0">Smooth</option><option value="1">Balanced</option><option value="2">High</option>';
app.querySelector('.controls')!.prepend(qualitySelect);
qualitySelect.onchange = () => { quality = qualitySelect.value === 'auto' ? 1 : Number(qualitySelect.value); slowSamples = 0; sampleStart = 0; resize(); };
function measureQuality(now: number) {
  if (!sampleStart) { sampleStart = now; sampleFrames = 0; }
  sampleFrames++;
  if (now - sampleStart < 2500) return;
  const fps = sampleFrames * 1000 / (now - sampleStart);
  slowSamples = fps < 42 ? slowSamples + 1 : 0;
  if (qualitySelect.value === 'auto' && slowSamples >= 2 && quality > 0) { quality--; resize(); slowSamples = 0; }
  sampleStart = now; sampleFrames = 0;
}

function resize() { camera.aspect = innerWidth / innerHeight; if (defaultView) camera.zoom = framingZoom(); camera.setViewOffset(innerWidth, innerHeight, innerWidth > 760 ? innerWidth * .07 : 0, innerWidth / innerHeight > 1.45 ? innerHeight * .035 : 0, innerWidth, innerHeight); camera.updateProjectionMatrix(); pipeline.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio, pixelRatios[quality], Math.sqrt(2400000 / (innerWidth * innerHeight)))); }
window.addEventListener('resize', resize); resize();
let nextInspection = 0;
const target = new THREE.Vector3();
function frame(now: number) {
  requestAnimationFrame(frame); if (document.hidden) { last = now; sampleStart = 0; return; } measureQuality(now); const dt = Math.min((now - last) / 1000, .05); last = now; if (!paused) t += dt * (slow ? .2 : 1);
  for (const [i, r] of rollers.entries()) r.rotation.y = t * (i < rollers.length / 2 ? 1 : -1) * 1.3 / .19;
  conveyorAnatomy.update(t);
  details.animate(t);
  for (const p of parcels) { const row = p.id < 7 ? 0 : 1; const phase = ((p.id % 7) * 3.7 + t * 1.3) % 26; p.root.position.set(row ? 13 - phase : -13 + phase, 1.7, row ? 4 : -4); p.picked = false; }
  // One synchronized parcel pickup per cell. Reparenting isn't needed: a single world transform drives both views.
  for (const robot of robots) {
    const { joints: [yaw, shoulder, elbow], base, index } = robot;
    const cycle = (t + index * 3.1) % 8; const transfer = THREE.MathUtils.smoothstep(cycle, 1.4, 5.7);
    const z = THREE.MathUtils.lerp(-4, 4, transfer); const y = 2.7 + Math.sin(transfer * Math.PI) * 2.2;
    const dx = .45 * Math.sin(t * .5 + index); const distance = Math.hypot(dx, z); const dy = y - 1.5; const a = 3.5, b = 3.3;
    const bend = Math.acos(THREE.MathUtils.clamp((distance * distance + dy * dy - a * a - b * b) / (2 * a * b), -.999, .999));
    yaw.rotation.y = Math.atan2(dx, z); shoulder.rotation.x = Math.atan2(distance, dy) - Math.atan2(b * Math.sin(bend), a + b * Math.cos(bend)); elbow.rotation.x = bend;
    robot.tip.rotation.x = -shoulder.rotation.x - elbow.rotation.x;
    base.updateMatrixWorld(true);
    const p = parcels[index * 3];
    const pickupX = base.position.x + dx;
    if (cycle <= 1.4) {
      p.root.position.set(THREE.MathUtils.lerp(-13, pickupX, cycle / 1.4), 1.7, -4);
    } else if (cycle < 5.7) {
      robot.tip.getWorldPosition(target); p.root.position.copy(target); p.root.position.y -= 1; p.picked = true;
    } else {
      p.root.position.set(THREE.MathUtils.lerp(pickupX, 13, (cycle - 5.7) / 2.3), 1.7, 4);
    }
  }
  if (selected !== null) { const p = parcels[selected]; controls.target.lerp(p.root.position, 1 - Math.exp(-dt * 3)); cursor.copy(new THREE.Vector2(innerWidth / 2, innerHeight / 2)); }
  controls.update();
  if (now >= nextInspection) { updateInspection(details, camera, cursor, section && (presence > 0 || full), t, app); nextInspection = now + 100; }
  grid.resize(innerWidth, innerHeight, 24, 2);
  const radius = full ? Math.max(innerWidth, innerHeight) * 2 : Math.min(220, innerWidth * .23);
  grid.update(dt, { lensX: cursor.x, lensY: cursor.y, radius, presence: full || selected !== null ? 1 : presence, organic: .28, drift: .16, diamond: .1, jitter: .05, attack: 12, release: 7, processing: .12, time: t, regions: [], corridors: [], wave: null });
  pipeline.uploadGrid(grid);
  const u = (k: string) => pipeline.composite.u(k);
  factoryUI.update(now / 1000, grid, full);
  u('uFull').value = full ? 1 : 0; u('uTime').value = t; u('uLens').value.set(cursor.x, cursor.y); u('uRadius').value = radius; u('uPresence').value = full ? 1 : presence; u('uGrowth').value = 1; u('uEdgeGlow').value = .65; u('uLattice').value = .3; u('uScanBoxes').value = 1; u('uGridReveal').value = 0; u('uEdge').value.set('#65dbc5');
  pipeline.setPost({ ao: quality === 0 ? 0 : 1, tiltShift: quality === 0 ? 0 : .18, bloom: .45, bloomThreshold: 1, grain: .07, vignette: .15, exposure: 1, focusY: .55, aoRadius: 1.4, aoHalfRes: true });
  pipeline.render(dt, section, false);
  let labelCount = 0;
  for (const p of parcels) { const v = p.root.position.clone().add(new THREE.Vector3(0, 1.7, 0)).project(camera); const x = (v.x + 1) * innerWidth / 2, y = (1 - v.y) * innerHeight / 2; p.label.style.display = v.z < 1 && grid.coverage(x, y) > .6 && labelCount++ < 2 ? 'block' : 'none'; p.label.style.transform = `translate(${x}px,${y}px)`; p.label.textContent = `PKG-${String(p.id + 1).padStart(3, '0')} / ${p.picked ? 'TRANSFER' : '99.8%'}`; }
  app.querySelector('#units')!.textContent = String(Math.floor(t / 8) * 2).padStart(4, '0');
  app.querySelector('#stage')!.textContent = paused ? 'Paused' : (t % 8 > 1.4 && t % 8 < 5.7 ? 'Transferring' : 'Running');
  if (selected !== null) app.querySelector('#inspection')!.textContent = `TRACKING PKG-${String(selected + 1).padStart(3, '0')}\n${parcels[selected].picked ? 'Robotic transfer in progress' : 'Conveyor speed 1.30 m/s'} · ESC to release`;
}
requestAnimationFrame(frame);
