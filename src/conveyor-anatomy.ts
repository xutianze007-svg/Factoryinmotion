import * as THREE from 'three';

// Mechanical cutaway: the outer cover stays in the clay pass, while shafts,
// bearings and transmission remain exposed in the synchronized inspection pass.
export function buildConveyorAnatomy(scene: THREE.Scene) {
  const steel = new THREE.MeshStandardMaterial({ color: '#c3c8c3', metalness: .55, roughness: .38 });
  const body = new THREE.MeshBasicMaterial({ color: '#b8d0cc' });
  const shaftMat = new THREE.MeshBasicMaterial({ color: '#f4c577' });
  const dark = new THREE.MeshBasicMaterial({ color: '#24434a' });
  const chainMat = new THREE.MeshBasicMaterial({ color: '#e3d6b2' });
  const outline = new THREE.LineBasicMaterial({ color: '#34545b', transparent: true, opacity: .8 });
  const rotating: { root: THREE.Group; speed: number }[] = [];
  const chains: { mesh: THREE.InstancedMesh; z: number; sign: number }[] = [];
  const matrix = new THREE.Matrix4(); const q = new THREE.Quaternion(); const scale = new THREE.Vector3(1, 1, 1);
  function mesh(g: THREE.BufferGeometry, parent: THREE.Object3D, pos: [number, number, number], mat = body, beauty = false) {
    const m = new THREE.Mesh(g, mat); m.position.set(...pos); m.layers.set(1); parent.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 22), outline); e.position.copy(m.position); e.layers.set(1); parent.add(e);
    if (beauty) { const b = new THREE.Mesh(g, steel); b.position.copy(m.position); b.castShadow = true; parent.add(b); }
    return m;
  }
  function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], mat = body, beauty = false) { return mesh(new THREE.BoxGeometry(...size), parent, pos, mat, beauty); }
  function axle(parent: THREE.Object3D, r: number, length: number, pos: [number, number, number], mat = shaftMat, beauty = false) {
    const g = new THREE.CylinderGeometry(r, r, length, 20); g.rotateX(Math.PI / 2); return mesh(g, parent, pos, mat, beauty);
  }
  function sprocket(x: number, y: number, z: number, radius: number, sign: number, visibleOutside = false) {
    const root = new THREE.Group(); root.position.set(x, y, z); scene.add(root);
    axle(root, radius * .8, .13, [0, 0, 0], dark, visibleOutside);
    const ring = new THREE.TorusGeometry(radius * .68, .055, 6, 28); mesh(ring, root, [0, 0, .09], shaftMat, visibleOutside);
    axle(root, .10, .28, [0, 0, 0], shaftMat, visibleOutside);
    for (let i = 0; i < 12; i++) { const angle = i * Math.PI / 6; const tooth = box(root, [.12, .13, .17], [Math.cos(angle) * radius, Math.sin(angle) * radius, 0], shaftMat, visibleOutside); tooth.rotation.z = angle; }
    for (let i = 0; i < 4; i++) { const spoke = box(root, [.07, radius * 1.4, .10], [0, 0, .03], body, visibleOutside); spoke.rotation.z = i * Math.PI / 4; }
    rotating.push({ root, speed: sign * 1.3 / radius });
  }
  for (const [index, z] of [-4, 4].entries()) {
    const sign = index ? -1 : 1;
    // Open ladder chassis and triangulated support, visible through the cover.
    for (const side of [-1, 1]) {
      for (const y of [.65, 1.25]) box(scene, [26.6, .10, .12], [0, y, z + side * 1.5], body);
      for (let x = -12; x <= 12; x += 2) {
        box(scene, [.09, .63, .13], [x, .94, z + side * 1.5], body);
        const brace = box(scene, [2.05, .055, .08], [x + .9, .95, z + side * 1.5], dark); brace.rotation.z = .29;
      }
    }
    for (let x = -12; x <= 12; x += 2) box(scene, [.1, .12, 3], [x, .8, z], body);
    // Individual bearing blocks, inner shaft and end caps on every roller.
    for (let x = -12.8; x < 13; x += .48) {
      axle(scene, .055, 3.65, [x, 1.5, z], shaftMat);
      for (const side of [-1, 1]) {
        box(scene, [.22, .25, .16], [x, 1.46, z + side * 1.67], body, true);
        axle(scene, .095, .12, [x, 1.5, z + side * 1.8], dark, true);
      }
      // A narrow longitudinal seam makes actual roller rotation legible.
      const rotor = new THREE.Group(); rotor.position.set(x, 1.5, z); scene.add(rotor);
      box(rotor, [.025, .025, 3.05], [0, .194, 0], shaftMat, true);
      rotating.push({ root: rotor, speed: -sign * 1.3 / .19 });
    }
    for (const x of [-12.5, 12.5]) sprocket(x, 1.08, z + 1.95, .32, -sign, true);
    // Continuous closed chain loop. Instance transforms follow arc length, not a texture scroll.
    const count = 180;
    const chain = new THREE.InstancedMesh(new THREE.BoxGeometry(.20, .075, .10), chainMat, count);
    chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chain.layers.set(1); chain.frustumCulled = false; scene.add(chain); chains.push({ mesh: chain, z: z + 1.95, sign });
    // Main gearmotor cutaway in the same position as the physical drive module.
    const mz = z + (z < 0 ? -2.2 : 2.2);
    axle(scene, .24, 1.15, [11, 1.1, mz], shaftMat);
    for (let n = 0; n < 8; n++) { const angle = n * Math.PI / 4; box(scene, [.09, .1, .9], [11 + Math.cos(angle) * .28, 1.1 + Math.sin(angle) * .28, mz], chainMat); }
    sprocket(11, 1.1, mz + .55, .31, -sign);
    sprocket(11.55, 1.1, mz + .55, .22, sign);
    axle(scene, .07, Math.abs(mz + .55 - (z + 1.95)), [11, 1.1, (mz + .55 + z + 1.95) / 2], shaftMat);
  }
  const position = new THREE.Vector3(); const axis = new THREE.Vector3(0, 0, 1);
  return { update(t: number) {
    for (const r of rotating) r.root.rotation.z = t * r.speed;
    const straight = 25, radius = .32, perimeter = straight * 2 + Math.PI * radius * 2;
    for (const chain of chains) for (let i = 0; i < chain.mesh.count; i++) {
      let s = ((i / chain.mesh.count * perimeter + t * 1.3 * chain.sign) % perimeter + perimeter) % perimeter;
      let x: number, y: number, angle: number;
      if (s < straight) { x = -12.5 + s; y = 1.08 + radius; angle = 0; }
      else if (s < straight + Math.PI * radius) { s = (s - straight) / radius; x = 12.5 + Math.sin(s) * radius; y = 1.08 + Math.cos(s) * radius; angle = -s; }
      else if (s < straight * 2 + Math.PI * radius) { x = 12.5 - (s - straight - Math.PI * radius); y = 1.08 - radius; angle = Math.PI; }
      else { s = (s - straight * 2 - Math.PI * radius) / radius; x = -12.5 - Math.sin(s) * radius; y = 1.08 - Math.cos(s) * radius; angle = Math.PI - s; }
      position.set(x, y, chain.z); q.setFromAxisAngle(axis, angle); matrix.compose(position, q, scale); chain.mesh.setMatrixAt(i, matrix);
      if (i === chain.mesh.count - 1) chain.mesh.instanceMatrix.needsUpdate = true;
    }
  } };
}
