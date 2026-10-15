import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Robot = { joints: THREE.Group[]; tip: THREE.Group; base: THREE.Group; index: number };
type Subject = { root: THREE.Object3D; title: string; info: string; anchor: THREE.Vector3; highlight: THREE.LineSegments; label: HTMLDivElement };
const aqua = new THREE.MeshBasicMaterial({ color: '#76ffdd', depthTest: false, transparent: true, opacity: .95 });
const orange = new THREE.MeshBasicMaterial({ color: '#ffc782', depthTest: false, transparent: true, opacity: .95 });
const line = new THREE.LineBasicMaterial({ color: '#63dac5', transparent: true, opacity: .38 });
const shell = new THREE.MeshBasicMaterial({ color: '#16383f', transparent: true, opacity: .16, depthWrite: false });

export function addFactoryDetails(scene: THREE.Scene, robots: Robot[], clay: THREE.MeshStandardMaterial, white: THREE.MeshStandardMaterial, dark: THREE.MeshStandardMaterial) {
  const subjects: Subject[] = [];
  const moving: { object: THREE.Object3D; axis: 'x' | 'y' | 'z'; offset: number }[] = [];
  const pickMeshes: THREE.Object3D[] = [];
  function component(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material = white) {
    const g = new THREE.BoxGeometry(...size);
    const outer = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, .025), material); outer.position.set(...position); outer.castShadow = true; outer.receiveShadow = true; parent.add(outer);
    const technical = new THREE.Mesh(g, shell); technical.position.copy(outer.position); technical.layers.set(1); parent.add(technical);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), line); edges.position.copy(outer.position); edges.layers.set(1); parent.add(edges);
    return outer;
  }
  function register(root: THREE.Object3D, title: string, info: string, anchor: [number, number, number], size: [number, number, number]) {
    const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), new THREE.LineBasicMaterial({ color: '#ffa966', transparent: true, opacity: .9, depthTest: false }));
    highlight.position.set(0, size[1] / 2, 0); highlight.visible = false; highlight.renderOrder = 30; highlight.layers.enable(1); root.add(highlight);
    const label = document.createElement('div'); label.className = 'equipment-label'; document.querySelector('#labels')!.append(label);
    const subject = { root, title, info, anchor: new THREE.Vector3(...anchor), highlight, label }; subjects.push(subject);
    root.traverse(o => { if (o instanceof THREE.Mesh && o.layers.isEnabled(0)) { o.userData.subject = subject; pickMeshes.push(o); } });
  }
  function core(parent: THREE.Object3D, length: number) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, length, 12), aqua); strut.position.y = length / 2; strut.layers.set(1); strut.renderOrder = 15; parent.add(strut);
    for (const y of [0, length]) { const joint = new THREE.Mesh(new THREE.SphereGeometry(.23, 16, 12), orange); joint.position.y = y; joint.layers.set(1); joint.renderOrder = 16; parent.add(joint); }
    const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.9, length, .9)), line); cage.position.y = length / 2; cage.layers.set(1); parent.add(cage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .025, 6, 40), aqua); ring.layers.set(1); parent.add(ring);
  }
  for (const r of robots) {
    core(r.joints[1], 3.5); core(r.joints[2], 3.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.15, .15, .6), orange); grip.position.y = -.3; grip.layers.set(1); r.tip.add(grip);
    // Side cover bolts and visible joint housings in the physical model.
    for (const joint of [r.joints[1], r.joints[2]]) for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .12, 24), white); cap.rotation.x = Math.PI / 2; cap.position.z = side * .6; joint.add(cap);
      for (let i = 0; i < 6; i++) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(.035, 6, 4), dark); bolt.position.set(Math.cos(i * Math.PI / 3) * .24, Math.sin(i * Math.PI / 3) * .24, side * .68); joint.add(bolt); }
    }
    register(r.base, `ROBOT 0${r.index + 1} / KINEMATICS`, 'BASE → SHOULDER → ELBOW → GRIPPER\nAmber: rotary joints · Mint: load-bearing links\nTwo-link inverse kinematics / synchronized transfer', [0, 6.5, 0], [3.6, 6.2, 3.6]);
  }
  for (const [index, x] of [-10, -6, 10].entries()) {
    const cabinet = new THREE.Group(); cabinet.position.set(x, 0, -8); scene.add(cabinet);
    // Rear chassis is open in the technical view: internal racks stay visible.
    const housing = new THREE.Mesh(new RoundedBoxGeometry(2.5, 3.6, 1.5, 2, .08), white); housing.position.y = 1.8; housing.castShadow = true; cabinet.add(housing);
    component(cabinet, [2.25, 3.25, .06], [0, 1.85, .79], clay);
    component(cabinet, [.95, .6, .08], [-.3, 2.85, .87], dark);
    component(cabinet, [.08, .5, .12], [.85, 1.8, .87], dark);
    for (let row = 0; row < 4; row++) {
      component(cabinet, [1.9, .35, .85], [0, .65 + row * .53, 0], dark);
      for (let j = 0; j < 4; j++) component(cabinet, [.25, .16, .3], [-.65 + j * .43, .65 + row * .53, .5], clay);
    }
    for (let j = 0; j < 6; j++) component(cabinet, [1.3, .035, .045], [-.15, .55 + j * .12, .85], dark);
    const wires = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.9, .4, .6), new THREE.Vector3(-.9, 3.2, .6), new THREE.Vector3(.8, 3.2, .6), new THREE.Vector3(.8, .4, .6)]), new THREE.LineBasicMaterial({ color: '#ffbd78' })); wires.layers.set(1); cabinet.add(wires);
    register(cabinet, ['PLC 01 / LINE CONTROL', 'SERVO 02 / MOTOR DRIVES', 'VISION 03 / PROCESSOR'][index], 'ENCLOSURE → POWER RAIL → CONTROL MODULES\nFour modular racks · internal cable bus\nStatus: online / local simulation', [0, 4.1, 0], [2.7, 3.8, 1.8]);
  }
  for (const [index, x] of [-11, -5, 2, 9].entries()) {
    const pallet = new THREE.Group(); pallet.position.set(x, 0, 8); scene.add(pallet);
    for (const z of [-.8, 0, .8]) component(pallet, [3.3, .14, .25], [0, .15, z], dark);
    for (const px of [-1.25, 0, 1.25]) component(pallet, [.3, .25, 2], [px, .33, 0], clay);
    for (let n = 0; n < 5; n++) component(pallet, [.5, .12, 2.2], [-1.2 + n * .6, .5, 0], white);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      component(pallet, [.87, .75, .85], [-1 + col, .93 + row * .78, row ? 0 : -.45], white);
      component(pallet, [.12, .012, .86], [-1 + col, 1.31 + row * .78, row ? 0 : -.45], dark);
      component(pallet, [.32, .22, .016], [-1 + col, 1 + row * .78, (row ? 0 : -.45) + .44], clay);
    }
    register(pallet, `PALLET 0${index + 1} / DISPATCH`, 'STACK → CARTONS → SHIPPING PALLET\n6 packed units · barcode labels\nDestination: outbound dispatch', [0, 2.9, 0], [3.5, 2.6, 2.3]);
  }
  for (const [index, z] of [-4, 4].entries()) {
    const motor = new THREE.Group(); motor.position.set(11, 0, z + (z < 0 ? -2.2 : 2.2)); scene.add(motor);
    component(motor, [1.5, .65, .8], [0, 1.1, 0], dark);
    for (let i = 0; i < 7; i++) component(motor, [.08, .78, .95], [-.6 + i * .2, 1.1, 0], clay);
    component(motor, [.7, .2, 1.2], [0, .65, 0], white);
    register(motor, `DRIVE 0${index + 1} / CONVEYOR`, 'MOTOR → GEARBOX → ROLLER CHAIN\nRoller transport / 1.30 m/s\nDirection: ' + (index ? 'return line' : 'inspection line'), [0, 2.3, 0], [1.8, 1.8, 1.3]);
    for (const side of [-1, 1]) for (let x = -12; x <= 12; x += 3) component(scene, [.12, .55, .12], [x, 1.7, z + side * 1.8], dark);
    const arrows = new THREE.Group(); scene.add(arrows);
    for (let i = 0; i < 9; i++) {
      const shape = new THREE.ConeGeometry(.16, .42, 3); shape.rotateZ(index ? Math.PI / 2 : -Math.PI / 2);
      const arrow = new THREE.Mesh(shape, aqua); arrow.position.set(-12 + i * 3, 1.8, z + 1.9); arrow.layers.set(1); arrows.add(arrow);
    }
    moving.push({ object: arrows, axis: 'x', offset: index ? -1 : 1 });
    // Inspecting the transport bed itself also reveals information.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(26, 1.8, 3.4), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, 1, z); scene.add(hit);
    register(hit, `LINE 0${index + 1} / ROLLER TRANSPORT`, 'SECTION: FRAME → BEARINGS → SHAFTS\nMotor rotor → gears → circulating chain\nRollers 65.3 rpm / transport 1.30 m/s', [0, 2, 0], [26, 1.8, 3.4]);
  }
  return { subjects, pickMeshes, animate(t: number) {
    for (const item of moving) item.object.position[item.axis] = (t * 1.3 % 3) * item.offset;
    for (const robot of robots) {
      const subject = subjects.find(s => s.root === robot.base)!;
      const shoulder = THREE.MathUtils.radToDeg(robot.joints[1].rotation.x).toFixed(1);
      const elbow = THREE.MathUtils.radToDeg(robot.joints[2].rotation.x).toFixed(1);
      subject.info = `BASE → SHOULDER → ELBOW → GRIPPER\nShoulder ${shoulder}° / Elbow ${elbow}°\nAmber: joints · Mint: structural links`;
    }
  } };
}
const ray = new THREE.Raycaster();
let previous: Subject | undefined;
export function updateInspection(details: ReturnType<typeof addFactoryDetails>, camera: THREE.Camera, cursor: THREE.Vector2, active: boolean, t: number, app: HTMLElement) {
  ray.setFromCamera(new THREE.Vector2(cursor.x / innerWidth * 2 - 1, 1 - cursor.y / innerHeight * 2), camera);
  const hit = active ? ray.intersectObjects(details.pickMeshes, false)[0] : undefined;
  const panelRect = app.querySelector('.readout')!.getBoundingClientRect();
  const onPanel = cursor.x >= panelRect.left && cursor.x <= panelRect.right && cursor.y >= panelRect.top && cursor.y <= panelRect.bottom;
  const subject: Subject | undefined = onPanel ? previous : hit?.object.userData.subject;
  if (previous !== subject) { if (previous) previous.highlight.visible = false; previous = subject; }
  for (const s of details.subjects) {
    const p = s.root.localToWorld(s.anchor.clone()).project(camera);
    const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
    const visible = active && (s === subject || (s.title.startsWith('ROBOT') && Math.hypot(x - cursor.x, y - cursor.y) < 150));
    s.label.style.display = visible && p.z < 1 ? 'block' : 'none';
    s.label.style.transform = `translate(${Math.min(innerWidth - 220, Math.max(12, x))}px,${Math.max(85, y)}px)`;
    s.label.textContent = s.title;
  }
  if (subject) { subject.highlight.visible = true; (subject.highlight.material as THREE.LineBasicMaterial).opacity = .55 + Math.sin(t * 3) * .15; }
  const title = app.querySelector<HTMLElement>('#equipment-title')!;
  const subtitle = app.querySelector<HTMLElement>('#equipment-subtitle')!;
  const one = app.querySelector<HTMLElement>('#param-one')!;
  const two = app.querySelector<HTMLElement>('#param-two')!;
  const firstLabel = app.querySelector<HTMLElement>('#param-one-label')!;
  const secondLabel = app.querySelector<HTMLElement>('#param-two-label')!;
  const robot = subject?.title.startsWith('ROBOT');
  const list = app.querySelector<HTMLElement>('#structure-list')!;
  const kind = subject?.title.split(' ')[0] ?? 'ROBOT';
  if (list.dataset.kind !== kind) {
    if (!list.dataset.original) list.dataset.original = list.innerHTML;
    list.dataset.kind = kind;
    if (kind === 'ROBOT') list.innerHTML = list.dataset.original;
    else {
      const parts = kind === 'LINE' || kind === 'DRIVE' ? ['Frame & bearings', 'Motor & gearbox', 'Chain transmission', 'Roller shafts'] : kind === 'PALLET' ? ['Shipping pallet', 'Stacked cartons', 'Package labels', 'Dispatch station'] : ['Enclosure', 'Power rail', 'Control modules', 'Cable bus'];
      list.replaceChildren(...parts.map((part, i) => { const row = document.createElement('div'); const n = document.createElement('span'); n.textContent = `0${i + 1}`; n.className = 'part-number'; const label = document.createElement('span'); label.textContent = part; row.append(n, label); return row; }));
    }
  }
  title.textContent = subject ? subject.title.split(' / ')[0].replace(/ (\d+)$/, ' / $1') : 'FACTORY / 01';
  subtitle.textContent = robot ? 'Pick-and-place system' : subject?.title.includes('PALLET') ? 'Outbound shipping station' : subject?.title.includes('LINE') || subject?.title.includes('DRIVE') ? 'Roller transmission system' : subject ? 'Industrial control module' : 'Interactive production system';
  const angles = subject?.info.match(/Shoulder ([\d.-]+)° \/ Elbow ([\d.-]+)°/);
  firstLabel.textContent = robot ? 'Shoulder' : 'Transport';
  secondLabel.textContent = robot ? 'Elbow' : 'Units sorted';
  one.textContent = angles ? angles[1] + '°' : '1.30 m/s';
  two.textContent = angles ? angles[2] + '°' : app.querySelector('#units')!.textContent;
  const card = app.querySelector<HTMLElement>('#inspection')!;
  card.classList.toggle('has-subject', !!subject);
  card.textContent = subject ? subject.title + '\n\n' + subject.info : 'Move across the line to reveal\nwhat the machines see.';
}
