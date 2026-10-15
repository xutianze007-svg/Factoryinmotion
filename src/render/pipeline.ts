// Frame graph:
//   machine scene  → rtMachine (LiDAR / segmentation / depth, HDR)
//   overlay scene  → rtOverlay (relation arcs, always visible)
//   beauty scene   → RenderPass → N8AO → tilt-shift (focus follows attention)
//                  → LensComposite (tiles reveal rtMachine, glowing edges, scanned cells)
//                  → bloom · AgX · vignette · grain → SMAA

import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  TiltShiftEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { LensGrid } from '../lens/grid';
import { LAYER_BEAUTY, LAYER_MACHINE, LAYER_OVERLAY } from '../world/materials';

const COMPOSITE = /* glsl */ `
uniform sampler2D tMachine;
uniform sampler2D tOverlay;
uniform highp sampler2D tState;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uOrigin;
uniform float uCell;
uniform float uLevels;
uniform vec3 uYOff;
uniform vec3 uCols;
uniform vec3 uRows;
uniform float uGrowth;
uniform float uGap;
uniform float uTime;
uniform vec2 uLens;
uniform float uRadius;
uniform float uPresence;
uniform float uFull;
uniform vec3 uEdge;
uniform float uEdgeGlow;
uniform float uGridReveal;
uniform float uLattice;
uniform float uScanBoxes;
uniform float uAberr;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Coverage of the lens at a css-pixel position; proc = "processing" amount of the winning cell.
float lensCov(vec2 css, out float proc, out vec2 lcOut, out float sOut) {
  float m = 0.0;
  proc = 0.0;
  lcOut = vec2(0.5);
  sOut = uCell;
  for (int L = 0; L < 3; L++) {
    if (float(L) >= uLevels) break;
    float s = uCell / float(1 << L);
    vec2 g = (css - uOrigin) / s;
    vec2 cell = floor(g);
    int cx = int(cell.x);
    int cy = int(cell.y);
    if (cx < 0 || cy < 0 || cx >= int(uCols[L]) || cy >= int(uRows[L])) continue;
    vec2 st = texelFetch(tState, ivec2(cx, int(uYOff[L]) + cy), 0).rg;
    if (st.r < 0.004 && st.g < 0.004) continue;
    vec2 lc = g - cell;
    vec2 q = abs(lc - 0.5);
    float dq = max(q.x, q.y);
    float a = st.r;
    float gapc = uGap / s * 0.5;
    float e = 1.0 - pow(1.0 - a, 3.0);
    float cov;
    if (uGrowth < 0.5) {
      float hw = 0.5 * e - gapc;
      // full tiles must not anti-alias against their own cell border (that leaves seams)
      cov = hw > 0.4995 ? 1.0 : clamp((hw - dq) * s * uDpr + 0.5, 0.0, 1.0);
    } else {
      vec2 qi = floor(lc * 2.0);
      vec2 ql = fract(lc * 2.0);
      float order = fract(h21(cell * 0.73 + float(L) * 5.1) * 4.0 + dot(qi, vec2(1.0, 2.0)) * 0.25);
      float qa = clamp((a - order * 0.7) / 0.3, 0.0, 1.0);
      float qe = 1.0 - pow(1.0 - qa, 3.0);
      vec2 qq = abs(ql - 0.5);
      cov = clamp((0.5 * qe - max(qq.x, qq.y)) * s * 0.5 * uDpr + 0.5, 0.0, 1.0);
      if (qe > 0.999) cov = 1.0;
      cov *= step(dq, 0.5 - gapc);
    }
    if (cov > m || st.g > proc) {
      if (cov > m) m = cov;
      if (st.g > proc) {
        proc = st.g;
        lcOut = lc;
        sOut = s;
      }
    }
  }
  return m;
}

float covOnly(vec2 css) {
  float p;
  vec2 l;
  float s;
  return lensCov(css, p, l, s);
}

float gline(float c, float sp) {
  float f = mod(c, sp);
  float d = min(f, sp - f) * uDpr;
  return 1.0 - smoothstep(0.0, 1.0, d);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 css = vec2(uv.x, 1.0 - uv.y) * uRes;
  float proc;
  vec2 lc;
  float s;
  float m = lensCov(css, proc, lc, s);
  m = mix(m, 1.0, uFull);
  vec3 col = inputColor.rgb;

  float inner = 0.0;
  if (m > 0.0) {
    float k = 1.5;
    float c1 = covOnly(css + vec2(k, 0.0));
    float c2 = covOnly(css - vec2(k, 0.0));
    float c3 = covOnly(css + vec2(0.0, k));
    float c4 = covOnly(css - vec2(0.0, k));
    inner = m * (1.0 - min(min(c1, c2), min(c3, c4)));
    // a whisper of chromatic split on the machine view right at the tile edge
    vec2 off = vec2(uAberr * inner / uRes.x, 0.0);
    vec3 mach = vec3(texture2D(tMachine, uv + off).r, texture2D(tMachine, uv).g, texture2D(tMachine, uv - off).b);
    // faint lattice etched into the machine view
    if (uLattice > 0.0) {
      vec2 c = css - uOrigin + 0.5 / uDpr;
      float lat = max(gline(c.x, uCell / 2.0), gline(c.y, uCell / 2.0));
      mach += uEdge * lat * 0.05 * uLattice;
    }
    col = mix(col, mach, m);
  }
  col += uEdge * inner * uEdgeGlow;

  // freshly scanned cells: an outlined, crossed box in the edge colour
  if (proc > 0.45 && uScanBoxes > 0.5) {
    vec2 e2 = min(lc, 1.0 - lc) * s * uDpr;
    float edge = min(e2.x, e2.y);
    float diag = min(abs(lc.x - lc.y), abs(lc.x + lc.y - 1.0)) * s * uDpr * 0.7071;
    float w = uDpr;
    float box = max(1.0 - smoothstep(w - 0.5, w + 0.5, edge), (1.0 - smoothstep(0.4 * uDpr, 0.4 * uDpr + 1.0, diag)) * 0.6);
    col = mix(col, uEdge * 1.6, box * 0.9);
  }

  // the invisible grid surfaces faintly around the lens
  if (uGridReveal > 0.0 && uPresence > 0.0) {
    float dist = length(css - uLens);
    float reveal = (1.0 - smoothstep(uRadius * 0.6, uRadius * 2.6, dist)) * uPresence * (1.0 - m);
    if (reveal > 0.001) {
      vec2 c = css - uOrigin + 0.5 / uDpr;
      float g0 = max(gline(c.x, uCell), gline(c.y, uCell));
      vec2 f = mod(c, uCell);
      vec2 dd = min(f, uCell - f);
      float plus = ((dd.x * uDpr < 1.0 && dd.y < 5.0) || (dd.y * uDpr < 1.0 && dd.x < 5.0)) ? 1.0 : 0.0;
      col *= 1.0 - max(g0 * uGridReveal, plus * min(1.0, uGridReveal * 4.0)) * reveal;
    }
  }

  vec4 ov = texture2D(tOverlay, uv);
  col = col * (1.0 - ov.a) + ov.rgb;
  outputColor = vec4(col, 1.0);
}
`;

export class LensCompositeEffect extends Effect {
  constructor(machine: THREE.Texture, overlay: THREE.Texture, state: THREE.Texture) {
    super('LensComposite', COMPOSITE, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['tMachine', new THREE.Uniform(machine)],
        ['tOverlay', new THREE.Uniform(overlay)],
        ['tState', new THREE.Uniform(state)],
        ['uRes', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uDpr', new THREE.Uniform(1)],
        ['uOrigin', new THREE.Uniform(new THREE.Vector2())],
        ['uCell', new THREE.Uniform(32)],
        ['uLevels', new THREE.Uniform(2)],
        ['uYOff', new THREE.Uniform(new THREE.Vector3())],
        ['uCols', new THREE.Uniform(new THREE.Vector3())],
        ['uRows', new THREE.Uniform(new THREE.Vector3())],
        ['uGrowth', new THREE.Uniform(0)],
        ['uGap', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        ['uLens', new THREE.Uniform(new THREE.Vector2())],
        ['uRadius', new THREE.Uniform(200)],
        ['uPresence', new THREE.Uniform(0)],
        ['uEdge', new THREE.Uniform(new THREE.Color(0.25, 0.95, 1.4))],
        ['uEdgeGlow', new THREE.Uniform(1)],
        ['uFull', new THREE.Uniform(0)],
        ['uGridReveal', new THREE.Uniform(0.08)],
        ['uLattice', new THREE.Uniform(1)],
        ['uScanBoxes', new THREE.Uniform(1)],
        ['uAberr', new THREE.Uniform(3)],
      ]),
    });
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
}

export interface PostParams {
  ao: number;
  tiltShift: number;
  bloom: number;
  bloomThreshold: number;
  grain: number;
  vignette: number;
  exposure: number;
  focusY: number; // 0..1 from top
  aoRadius?: number; // metres; shrinks as the camera moves in
  aoHalfRes?: boolean; // half-resolution AO with depth-aware upsampling (most of the AO cost)
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly rtMachine: THREE.WebGLRenderTarget;
  readonly rtOverlay: THREE.WebGLRenderTarget;
  readonly stateTex: THREE.DataTexture;
  readonly composite: LensCompositeEffect;
  private ao: N8AOPostPass;
  private tilt: TiltShiftEffect;
  private tiltPass: EffectPass;
  private shadowElapsed = 1;
  private bloom: BloomEffect;
  private vignette: VignetteEffect;
  private noise: NoiseEffect;
  private tone: ToneMappingEffect;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private w = 1;
  private h = 1;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    this.renderer = r;

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 };
    this.rtMachine = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtOverlay = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.stateTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGFormat, THREE.UnsignedByteType);
    this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.magFilter = THREE.NearestFilter;

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    this.ao.configuration.aoRadius = 5;
    this.ao.configuration.distanceFalloff = 1;
    this.ao.configuration.intensity = 3.2;
    this.ao.configuration.color = new THREE.Color('#2b2620');
    this.ao.configuration.gammaCorrection = false;
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);
    this.tilt = new TiltShiftEffect({ focusArea: 0.42, feather: 0.32, offset: 0 });
    this.tiltPass = new EffectPass(camera, this.tilt);
    this.composer.addPass(this.tiltPass);
    this.composite = new LensCompositeEffect(this.rtMachine.texture, this.rtOverlay.texture, this.stateTex);
    this.composer.addPass(new EffectPass(camera, this.composite));
    this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.vignette = new VignetteEffect({ darkness: 0.42, offset: 0.32 });
    this.noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SOFT_LIGHT });
    this.noise.blendMode.opacity.value = 0.18;
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.vignette, this.noise));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  setSize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    this.rtMachine.setSize(pw, ph);
    this.rtOverlay.setSize(pw, ph);
    this.ao.setSize(pw, ph);
    this.composite.u('uRes').value.set(w, h);
    this.composite.u('uDpr').value = dpr;
  }

  uploadGrid(g: LensGrid) {
    const t = this.stateTex;
    if (t.image.width !== g.atlasW || t.image.height !== g.atlasH) {
      t.image = { data: g.atlas, width: g.atlasW, height: g.atlasH } as unknown as typeof t.image;
    } else (t.image as { data: Uint8Array }).data = g.atlas;
    t.needsUpdate = true;
    const u = (n: string) => this.composite.u(n);
    u('uOrigin').value.set(g.originX, g.originY);
    u('uCell').value = g.cell;
    u('uLevels').value = g.levels.length;
    const L = g.levels;
    u('uYOff').value.set(L[0]?.yOff ?? 0, L[1]?.yOff ?? 0, L[2]?.yOff ?? 0);
    u('uCols').value.set(L[0]?.cols ?? 0, L[1]?.cols ?? 0, L[2]?.cols ?? 0);
    u('uRows').value.set(L[0]?.rows ?? 0, L[1]?.rows ?? 0, L[2]?.rows ?? 0);
  }

  setPost(p: PostParams) {
    this.ao.configuration.intensity = 3.2 * p.ao;
    this.ao.enabled = p.ao > 0.01;
    if (p.aoRadius != null && Math.abs(this.ao.configuration.aoRadius - p.aoRadius) > 0.05) this.ao.configuration.aoRadius = p.aoRadius;
    if (p.aoHalfRes != null && this.ao.configuration.halfRes !== p.aoHalfRes) this.ao.configuration.halfRes = p.aoHalfRes;
    this.tiltPass.enabled = p.tiltShift > 0.01;
    this.tilt.focusArea = 0.42 + (1 - p.tiltShift) * 0.9;
    this.tilt.feather = 0.32;
    this.tilt.offset = 0.5 - p.focusY;
    this.bloom.intensity = p.bloom;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.vignette.darkness = p.vignette;
    this.noise.blendMode.opacity.value = p.grain;
    this.renderer.toneMappingExposure = p.exposure;
    (this.tone as unknown as { exposure?: number }).exposure = p.exposure;
  }

  render(dt: number, machineVisible = true, overlayVisible = true) {
    const r = this.renderer;
    const cam = this.camera;
    // machine world
    cam.layers.set(LAYER_MACHINE);
    r.setRenderTarget(this.rtMachine);
    r.setClearColor(0x020306, 1);
    r.clear(true, true, false);
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    if (machineVisible) r.render(this.scene, cam);
    // overlay (relations) — transparent
    cam.layers.set(LAYER_OVERLAY);
    r.setRenderTarget(this.rtOverlay);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    if (overlayVisible) r.render(this.scene, cam);
    this.scene.background = bg;
    this.scene.fog = fog;
    r.setRenderTarget(null);
    // beauty + post (shadow casters are filtered by the camera's layers, so update here)
    cam.layers.set(LAYER_BEAUTY);
    this.shadowElapsed += dt;
    r.shadowMap.needsUpdate = this.shadowElapsed >= 1 / 30;
    if (r.shadowMap.needsUpdate) this.shadowElapsed = 0;
    this.composer.render(dt);
  }

  get size() {
    return { w: this.w, h: this.h };
  }
}
