// Materials for the two worlds:
//  - beauty (layer 0): architectural clay, etched windows, a few lit at dusk
//  - machine (layer 1): what the perception stack sees — segmentation / depth surfaces and LiDAR points

import * as THREE from 'three';

export const LAYER_BEAUTY = 0;
export const LAYER_MACHINE = 1;
export const LAYER_OVERLAY = 2;

/** Uniforms shared by every machine-world shader (one write updates all of them). */
export const G = {
  uTime: { value: 0 },
  uMode: { value: 0 }, // 0 lidar, 1 segmentation, 2 depth
  uColorBy: { value: 0 }, // 0 distance, 1 height, 2 class
  uSensor: { value: new THREE.Vector3(9.4, 6.2, -9.4) },
  uPointSize: { value: 2.2 },
  uDpr: { value: 1 },
  uSweep: { value: 1 },
  uNight: { value: 0.35 },
  uContours: { value: 1 }, // depth view range contours
  uAgentPts: { value: 1 }, // LiDAR returns on road users
  // x-ray: per building / tree fade (0 solid … 1 see-through), written by the occlusion test
  uFade: { value: makeFadeTexture() },
  uGhost: { value: 0.16 }, // how much of a see-through building stays visible
};

/** Building ids are footprint indices; tree ids start here. */
export const XRAY_TREES = 512;

function makeFadeTexture() {
  const t = new THREE.DataTexture(new Uint8Array(1024), 1024, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Buildings and trees that block the subject fade as a whole, the way games keep the player in
 * view: the solid passes dissolve them (a stable dither), a ghost pass keeps a faint glass shell.
 */
const XRAY_VERT = /* glsl */ `
attribute float aBld;
uniform sampler2D uFade;
float bldFade() { return texelFetch(uFade, ivec2(int(aBld + 0.5), 0), 0).r; }`;
const XRAY_FRAG = /* glsl */ `
float xrIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void xrayDissolve(float f) { if (f > 0.003 && f > xrIgn(gl_FragCoord.xy)) discard; }`;

/** Lets whole buildings / trees dissolve in a built-in (standard) material. */
export function withXray<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uFade = G.uFade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${XRAY_VERT}\nvarying float vFade;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = bldFade();');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vFade;\n${XRAY_FRAG}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nxrayDissolve(vFade);');
  };
  m.customProgramCacheKey = () => `${key}|xray`;
  return m;
}

/** The faint glass shell left of a see-through building (beauty pass only, never writes depth). */
export function ghostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uFade: G.uFade, uGhost: G.uGhost, uColor: { value: new THREE.Color('#5f6d7c') } },
    vertexShader: /* glsl */ `
${XRAY_VERT}
varying float vFade;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vFade = bldFade();
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWP = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  // solid buildings collapse out of the clip volume: the ghost pass costs nothing for them
  gl_Position = vFade < 0.004 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform float uGhost;
uniform vec3 uColor;
varying float vFade;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWP);
  float fr = pow(1.0 - abs(dot(N, V)), 2.0);
  // floor lines and window bays drawn faintly on the walls, like a section drawing
  float vertical = 1.0 - abs(N.y);
  vec2 fuv = vec2(dot(vWP.xz, vec2(-N.z, N.x)), vWP.y - 0.16) / vec2(2.8, 3.4);
  vec2 gl = abs(fract(fuv - 0.5) - 0.5) / max(fwidth(fuv), vec2(1e-4));
  float line = (1.0 - min(min(gl.x, gl.y), 1.0)) * vertical;
  gl_FragColor = vec4(uColor, min(0.9, vFade * uGhost * (0.4 + 0.6 * fr + 1.8 * line)));
}`,
    transparent: true,
    depthWrite: false,
  });
}

export const CLASS = {
  road: new THREE.Color('#7a3fa8'),
  sidewalk: new THREE.Color('#c04ab0'),
  building: new THREE.Color('#5a6070'),
  vegetation: new THREE.Color('#6f9a26'),
  pole: new THREE.Color('#9aa0a8'),
  signal: new THREE.Color('#ffb21e'),
  ground: new THREE.Color('#3a3f4c'),
  car: new THREE.Color('#2fd2ff'),
  bus: new THREE.Color('#4d7dff'),
  bike: new THREE.Color('#ffd03a'),
  ped: new THREE.Color('#ff3ddc'),
  sensor: new THREE.Color('#ffffff'),
};
export type ClassName = keyof typeof CLASS;

// ---------------------------------------------------------------- beauty

export function clay(color = '#f1efe9', opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...opts });
}

/** Clay with etched window bays; at dusk a scatter of windows glows warm. */
export function buildingClay() {
  const m = clay('#f3f1ec');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWP;
varying vec3 vWN;
uniform float uNight;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float vertical = 1.0 - abs(vWN.y);
vec2 fuv = vec2(dot(vWP.xz, vec2(-vWN.z, vWN.x)), vWP.y);
vec2 bayc = vec2(2.8, 3.4);
vec2 gcell = floor(fuv / bayc);
vec2 g = fract(fuv / bayc);
float win = step(0.2, g.x) * step(g.x, 0.8) * step(0.28, g.y) * step(g.y, 0.82) * step(3.2, vWP.y);
diffuseColor.rgb *= 1.0 - win * vertical * 0.16;
float lit = step(0.86, h21(gcell + floor(vWP.xz * 0.05) * 7.0)) * win * vertical * uNight;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * lit * 2.2;',
      );
  };
  return m;
}

// ---------------------------------------------------------------- walking figures

/**
 * Limbs swing in the vertex shader: aLimb = (id, pivot y, pivot z) with id 0 body, 1/2 legs,
 * 3/4 arms (arms swing against the same-side leg); uWalk = (phase, leg swing, arm swing).
 */
const WALK_GLSL = /* glsl */ `
attribute vec3 aLimb;
uniform vec3 uWalk;
mat3 limbRot() {
  float id = aLimb.x;
  float side = (id < 1.5 || (id > 2.5 && id < 3.5)) ? 1.0 : -1.0;
  float a = id < 2.5 ? sin(uWalk.x) * uWalk.y * side : -sin(uWalk.x) * uWalk.z * side;
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
vec3 limbPose(vec3 p) {
  if (aLimb.x < 0.5) return p;
  vec3 piv = vec3(0.0, aLimb.y, aLimb.z);
  return limbRot() * (p - piv) + piv;
}
vec3 limbNormal(vec3 n) { return aLimb.x < 0.5 ? n : limbRot() * n; }`;

/** Animates a built-in material's limbs (one program shared by every person; each has its own uWalk). */
export function walker<T extends THREE.Material>(m: T, walk: { value: THREE.Vector3 }, normals: boolean): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWalk = walk;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WALK_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = limbPose(transformed);');
    if (normals) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = limbNormal(objectNormal);');
  };
  m.customProgramCacheKey = () => `walker${normals ? 'N' : ''}`;
  return m;
}

// ---------------------------------------------------------------- machine surfaces

function machineVert(walk: boolean, xray: boolean) {
  return /* glsl */ `
${walk ? WALK_GLSL : ''}
${xray ? XRAY_VERT : ''}
varying vec3 vWP;
varying vec3 vWN;
varying float vViewZ;
varying float vFade;
void main() {
  vFade = ${xray ? 'bldFade()' : '0.0'};
  vec3 pos = ${walk ? 'limbPose(position)' : 'position'};
  vec3 nrm = ${walk ? 'limbNormal(normal)' : 'normal'};
  vec4 w = modelMatrix * vec4(pos, 1.0);
  vWP = w.xyz;
  vWN = normalize(mat3(modelMatrix) * nrm);
  vec4 mv = viewMatrix * w;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
}

const MACHINE_FRAG = /* glsl */ `
uniform vec3 uClass;
uniform int uMode;
uniform vec3 uSensor;
uniform float uTime;
uniform float uContours;
varying vec3 vWP;
varying vec3 vWN;
varying float vViewZ;
varying float vFade;
${XRAY_FRAG}
void main() {
  xrayDissolve(vFade);
  float lam = 0.6 + 0.4 * max(dot(normalize(vWN), normalize(vec3(0.35, 1.0, 0.25))), 0.0);
  vec3 col;
  if (uMode == 0) {
    col = uClass * 0.028 * lam + vec3(0.004, 0.006, 0.012);
  } else {
    float d = length(vWP - uSensor);
    float g = 1.0 - smoothstep(2.0, 95.0, d);
    float k = d / 2.5;
    float f = fract(k);
    float w = fwidth(k) * 1.2;
    float iso = 1.0 - smoothstep(0.0, w, min(f, 1.0 - f));
    float k2 = d / 12.5;
    float f2 = fract(k2);
    float iso2 = 1.0 - smoothstep(0.0, fwidth(k2) * 1.5, min(f2, 1.0 - f2));
    // dark range map with contour lines every 2.5 m (bold every 12.5 m)
    col = mix(vec3(0.002, 0.004, 0.01), vec3(0.03, 0.085, 0.15), pow(g, 1.8)) * lam;
    col += vec3(0.25, 0.75, 1.0) * (iso * 0.18 + iso2 * 0.75) * (0.3 + 0.7 * g) * uContours;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const XRAY: ClassName[] = ['building', 'vegetation'];

export function machineMaterial(cls: ClassName, walk?: { value: THREE.Vector3 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uClass: { value: CLASS[cls] },
      uMode: G.uMode,
      uSensor: G.uSensor,
      uTime: G.uTime,
      uContours: G.uContours,
      uFade: G.uFade,
      ...(walk ? { uWalk: walk } : {}),
    },
    vertexShader: machineVert(!!walk, XRAY.includes(cls)),
    fragmentShader: MACHINE_FRAG,
  });
}

// ---------------------------------------------------------------- LiDAR points

const POINTS_VERT = /* glsl */ `
uniform float uPointSize;
uniform float uDpr;
uniform float uTime;
uniform float uSweep;
uniform vec3 uSensor;
uniform int uColorBy;
uniform int uMode;
uniform vec3 uClass;
uniform float uFacing;
uniform float uAgentPts;
uniform float uXrayOn;
varying vec3 vCol;
varying float vA;
${XRAY_VERT}

vec3 turbo(float x) {
  const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2));
}

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec2 rel = w.xz - uSensor.xz;
  float d = length(rel);
  vec3 c;
  if (uColorBy == 0) c = turbo(1.0 - clamp(d / 78.0, 0.0, 1.0) * 0.92);
  else if (uColorBy == 1) c = mix(vec3(0.15, 0.4, 1.0), vec3(1.0, 0.95, 0.85), clamp(w.y / 26.0, 0.0, 1.0));
  else c = uClass;
  c = pow(max(c, 0.0), vec3(2.2));
  // rotating scan: bright head with a decaying tail
  float ang = atan(rel.y, rel.x);
  float ph = fract((ang / 6.2831853) - uTime * 0.16);
  float head = pow(1.0 - ph, 14.0);
  float boost = 1.0 + uSweep * 2.6 * head;
  // agents carry normals: points on the far side of the sensor read dimmer
  float facing = 1.0;
  if (uFacing > 0.5) {
    vec3 n = normalize(mat3(modelMatrix) * normal);
    facing = 0.25 + 0.75 * step(0.0, dot(n, normalize(uSensor - w.xyz)));
  }
  vCol = c * boost * facing * 2.1;
  vec4 mv = viewMatrix * w;
  gl_PointSize = uPointSize * uDpr * clamp(190.0 / -mv.z, 0.55, 2.6);
  gl_Position = projectionMatrix * mv;
  vA = uMode == 0 ? 1.0 : 0.0;
  if (uFacing > 0.5 && uAgentPts < 0.5) vA = 0.0;
  // returns off a see-through building / tree thin out with it
  if (uXrayOn > 0.5 && vA > 0.0) {
    float f = bldFade();
    if (f > 0.003 && f > fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453)) vA = 0.0;
  }
}`;

const POINTS_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  if (vA < 0.01) discard;
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.04, r);
  gl_FragColor = vec4(vCol * a, a);
}`;

export function pointsMaterial(cls: ClassName, facing = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPointSize: G.uPointSize,
      uDpr: G.uDpr,
      uTime: G.uTime,
      uSweep: G.uSweep,
      uSensor: G.uSensor,
      uColorBy: G.uColorBy,
      uMode: G.uMode,
      uClass: { value: CLASS[cls] },
      uFacing: { value: facing ? 1 : 0 },
      uAgentPts: G.uAgentPts,
      uFade: G.uFade,
      uXrayOn: { value: XRAY.includes(cls) && !facing ? 1 : 0 },
    },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Glowing outline material for detection cuboids (HDR colour so bloom picks it up). */
export function boxMaterial(cls: ClassName, strength = 3) {
  const c = CLASS[cls].clone().multiplyScalar(strength);
  return new THREE.LineBasicMaterial({ color: c, transparent: true, depthWrite: false });
}
