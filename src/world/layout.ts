// Street geometry for one four-way intersection (metres; x = east, z = south, y = up).
// Right-hand traffic, two lanes per direction, crosswalks on every arm.

export const LANE = 3.5;
export const ROAD = 7; // half-width of each road (curb line)
export const WALK = 5; // sidewalk width
export const BUILD = ROAD + WALK; // building line
export const XW_IN = 8.2; // crosswalk band, distance from centre
export const XW_OUT = 12.2;
export const STOP = 13.4; // stop line
export const EXTENT = 170;
export const SIDEWALK_C = ROAD + WALK / 2;

export type Dir = 'N' | 'E' | 'S' | 'W'; // where a vehicle comes FROM
export type Group = 'NS' | 'EW';
export type Maneuver = 'straight' | 'left' | 'right';

export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];

/** Heading (x, z) of traffic arriving from `d`. */
export function heading(d: Dir): [number, number] {
  return d === 'N' ? [0, 1] : d === 'S' ? [0, -1] : d === 'E' ? [-1, 0] : [1, 0];
}

/** Right-hand vector of a heading. */
export function rightOf(h: [number, number]): [number, number] {
  return [-h[1], h[0]];
}

export function groupOf(d: Dir): Group {
  return d === 'N' || d === 'S' ? 'NS' : 'EW';
}

export interface Path {
  id: string;
  xs: Float32Array;
  zs: Float32Array;
  cum: Float32Array;
  length: number;
  /** Arc length of the stop line (vehicles) or curb wait point (pedestrians). */
  stopS: number;
  /** Arc length where the path leaves the conflict zone (box or crosswalk). */
  clearS: number;
  approach: Dir;
  group: Group;
  maneuver: Maneuver;
  lane: number;
  kind: 'vehicle' | 'bike' | 'ped';
  /** For pedestrians: which arm's crosswalk they use. */
  crossArm?: Dir;
}

function build(points: [number, number][], step = 0.5) {
  // resample to ~uniform spacing
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) {
      xs.push(ax + ((bx - ax) * k) / n);
      zs.push(az + ((bz - az) * k) / n);
    }
  }
  const last = points[points.length - 1];
  xs.push(last[0]);
  zs.push(last[1]);
  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return { xs: Float32Array.from(xs), zs: Float32Array.from(zs), cum, length: cum[cum.length - 1] };
}

/** Arc length of the point on the path closest to (x, z). */
function sAt(p: { xs: Float32Array; zs: Float32Array; cum: Float32Array }, x: number, z: number) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < p.xs.length; i++) {
    const d = (p.xs[i] - x) ** 2 + (p.zs[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return p.cum[best];
}

function toWorld(h: [number, number], r: [number, number], u: number, w: number): [number, number] {
  return [h[0] * u + r[0] * w, h[1] * u + r[1] * w];
}

/** Vehicle path in the approach's local frame (u forward, w right), then mapped to world. */
export function vehiclePath(d: Dir, lane: number, m: Maneuver, offset?: number): Path {
  const h = heading(d);
  const r = rightOf(h);
  const o = offset ?? LANE * (lane + 0.5);
  const local: [number, number][] = [[-EXTENT, o]];
  if (m === 'straight') {
    local.push([EXTENT, o]);
  } else if (m === 'right') {
    const R = 5;
    const cu = -o - R;
    const cw = o + R;
    local.push([cu, o]);
    for (let i = 1; i <= 14; i++) {
      const p = (i / 14) * (Math.PI / 2);
      local.push([cu + R * Math.sin(p), cw - R * Math.cos(p)]);
    }
    local.push([-o, EXTENT]);
  } else {
    const R = 8.75;
    const cu = o - R;
    const cw = o - R;
    local.push([cu, o]);
    for (let i = 1; i <= 20; i++) {
      const p = (i / 20) * (Math.PI / 2);
      local.push([cu + R * Math.sin(p), cw + R * Math.cos(p)]);
    }
    local.push([o, -EXTENT]);
  }
  const pts = local.map(([u, w]) => toWorld(h, r, u, w));
  const b = build(pts);
  const stopS = EXTENT - STOP;
  const exit = m === 'straight' ? toWorld(h, r, STOP, o) : m === 'right' ? toWorld(h, r, -o, STOP) : toWorld(h, r, o, -STOP);
  return {
    id: `${d}${lane}${m[0]}${offset ? 'b' : ''}`,
    ...b,
    stopS,
    clearS: sAt(b, exit[0], exit[1]),
    approach: d,
    group: groupOf(d),
    maneuver: m,
    lane,
    kind: offset ? 'bike' : 'vehicle',
  };
}

export function allVehiclePaths() {
  const out: Path[] = [];
  for (const d of DIRS) {
    out.push(vehiclePath(d, 0, 'straight'));
    out.push(vehiclePath(d, 0, 'left'));
    out.push(vehiclePath(d, 1, 'straight'));
    out.push(vehiclePath(d, 1, 'right'));
  }
  return out;
}

export function bikePaths() {
  return DIRS.map((d) => vehiclePath(d, 1, 'straight', ROAD - 0.85));
}

/** Crosswalk band centre line for an arm: crossing it means walking across that road. */
export function crosswalkCentre() {
  return (XW_IN + XW_OUT) / 2;
}

/** Signal group whose green conflicts with walking across arm `a`. */
export function crossConflict(a: Dir): Group {
  return groupOf(a);
}

/**
 * Pedestrian route: along a sidewalk to a corner, across one arm's crosswalk, then away along
 * another sidewalk. `jitter` spreads people across the sidewalk / crosswalk width.
 */
export function pedPath(arm: Dir, forward: boolean, rand: () => number): Path {
  const h = heading(arm); // direction of traffic on that arm (into the junction)
  const r = rightOf(h);
  const c = crosswalkCentre() + (rand() - 0.5) * 2.6;
  const side = ROAD + 1.4 + rand() * 0.8; // curb wait point, just on the sidewalk
  const sw = SIDEWALK_C + (rand() - 0.5) * 2.8;
  // In arm-local coords: u along the arm (negative = away from junction), w across the road.
  const wFrom = forward ? -side : side;
  const wTo = -wFrom;
  const u = -c;
  // approach along one sidewalk of the arm, or come round the corner from the cross street
  const startAlongArm = rand() < 0.5;
  const endAlongArm = rand() < 0.5;
  const s0 = Math.sign(wFrom);
  const s1 = Math.sign(wTo);
  const pts: [number, number][] = [];
  if (startAlongArm) {
    pts.push(toWorld(h, r, -EXTENT * 0.55 - rand() * 40, s0 * sw));
    pts.push(toWorld(h, r, u - 3, s0 * sw));
  } else {
    pts.push(toWorld(h, r, -sw + 0.0 + (rand() - 0.5), s0 * (EXTENT * 0.55 + rand() * 40)));
    pts.push(toWorld(h, r, -sw, s0 * (ROAD + 3)));
    pts.push(toWorld(h, r, u - 1, s0 * (side + 1.2)));
  }
  const wait = toWorld(h, r, u, wFrom);
  const across = toWorld(h, r, u, wTo);
  pts.push(wait, across);
  if (endAlongArm) {
    pts.push(toWorld(h, r, u - 3, s1 * sw));
    pts.push(toWorld(h, r, -EXTENT * 0.55 - rand() * 40, s1 * sw));
  } else {
    pts.push(toWorld(h, r, u - 1, s1 * (side + 1.2)));
    pts.push(toWorld(h, r, -sw, s1 * (ROAD + 3)));
    pts.push(toWorld(h, r, -sw + (rand() - 0.5), s1 * (EXTENT * 0.55 + rand() * 40)));
  }
  const b = build(pts, 0.4);
  return {
    id: `p${arm}${forward ? 'f' : 'b'}`,
    ...b,
    stopS: sAt(b, wait[0], wait[1]),
    clearS: sAt(b, across[0], across[1]),
    approach: arm,
    group: groupOf(arm),
    maneuver: 'straight',
    lane: 0,
    kind: 'ped',
    crossArm: arm,
  };
}

export function sample(p: Path, s: number, out: { x: number; z: number; hx: number; hz: number }) {
  const n = p.cum.length;
  if (s <= 0) {
    out.x = p.xs[0];
    out.z = p.zs[0];
    const dx = p.xs[1] - p.xs[0];
    const dz = p.zs[1] - p.zs[0];
    const l = Math.hypot(dx, dz) || 1;
    out.hx = dx / l;
    out.hz = dz / l;
    return out;
  }
  if (s >= p.length) {
    out.x = p.xs[n - 1];
    out.z = p.zs[n - 1];
    const dx = p.xs[n - 1] - p.xs[n - 2];
    const dz = p.zs[n - 1] - p.zs[n - 2];
    const l = Math.hypot(dx, dz) || 1;
    out.hx = dx / l;
    out.hz = dz / l;
    return out;
  }
  // binary search
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const t = (s - p.cum[lo]) / seg;
  out.x = p.xs[lo] + (p.xs[hi] - p.xs[lo]) * t;
  out.z = p.zs[lo] + (p.zs[hi] - p.zs[lo]) * t;
  // heading smoothed over a couple of metres for nicer turns
  const a = Math.max(0, lo - 2);
  const b = Math.min(n - 1, hi + 2);
  const dx = p.xs[b] - p.xs[a];
  const dz = p.zs[b] - p.zs[a];
  const l = Math.hypot(dx, dz) || 1;
  out.hx = dx / l;
  out.hz = dz / l;
  return out;
}
