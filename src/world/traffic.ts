// A small but honest traffic simulation: signal phases, car-following (IDM), stop lines,
// amber decisions, permissive left turns that yield, walk signals and the odd jaywalker.

import * as THREE from 'three';
import { mulberry32 } from '../shared/noise';
import { type AgentVisual, type Kind, makeAgent } from './agents';
import {
  allVehiclePaths,
  bikePaths,
  type Dir,
  DIRS,
  type Group,
  groupOf,
  type Path,
  pedPath,
  ROAD,
  sample,
} from './layout';
import type { SignalHead } from './city';

export type Light = 'green' | 'amber' | 'red';

const PHASES: { NS: Light; EW: Light; d: number }[] = [
  { NS: 'green', EW: 'red', d: 12 },
  { NS: 'amber', EW: 'red', d: 3 },
  { NS: 'red', EW: 'red', d: 1.6 },
  { NS: 'red', EW: 'green', d: 12 },
  { NS: 'red', EW: 'amber', d: 3 },
  { NS: 'red', EW: 'red', d: 1.6 },
];

export class Signals {
  t = 0;
  i = 0;
  update(dt: number) {
    this.t += dt;
    while (this.t >= PHASES[this.i].d) {
      this.t -= PHASES[this.i].d;
      this.i = (this.i + 1) % PHASES.length;
    }
  }
  light(g: Group): Light {
    return PHASES[this.i][g];
  }
  /** Seconds until this group's light changes. */
  remaining(g: Group) {
    const cur = this.light(g);
    let t = PHASES[this.i].d - this.t;
    for (let k = 1; k < PHASES.length; k++) {
      const p = PHASES[(this.i + k) % PHASES.length];
      if (p[g] !== cur) break;
      t += p.d;
    }
    return t;
  }
  /** Seconds until this group turns green (0 if green). */
  untilGreen(g: Group) {
    if (this.light(g) === 'green') return 0;
    let t = PHASES[this.i].d - this.t;
    for (let k = 1; k < PHASES.length; k++) {
      const p = PHASES[(this.i + k) % PHASES.length];
      if (p[g] === 'green') return t;
      t += p.d;
    }
    return t;
  }
  /** Walking across arm `a` is allowed while that road's traffic is held and the cross street has time left. */
  walk(a: Dir) {
    const g = groupOf(a);
    const other: Group = g === 'NS' ? 'EW' : 'NS';
    return this.light(g) === 'red' && this.light(other) === 'green' && this.remaining(other) > 3.5;
  }
  walkRemaining(a: Dir) {
    const g = groupOf(a);
    const other: Group = g === 'NS' ? 'EW' : 'NS';
    return Math.max(0, this.remaining(other) - 3.5);
  }
}

export type PedState = 'walk' | 'wait' | 'cross' | 'away';

export interface Agent {
  id: number;
  code: string;
  kind: Kind;
  path: Path;
  s: number;
  v: number;
  v0: number;
  acc: number;
  len: number;
  wid: number;
  hgt: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  vis: AgentVisual;
  // driving
  amberRun: boolean;
  aggressive: boolean;
  hold: '' | 'red' | 'amber' | 'queue' | 'ped' | 'yield';
  leader: Agent | null;
  gap: number;
  // walking
  state: PedState;
  jaywalker: boolean;
  phone: boolean;
  waited: number;
  phase: number;
  age: number;
  dead: boolean;
}

const tmp = { x: 0, z: 0, hx: 0, hz: 1 };

export class Traffic {
  readonly group = new THREE.Group();
  readonly signals = new Signals();
  agents: Agent[] = [];
  density = 1;
  jaywalkRate = 0.12;
  private rand = mulberry32(11);
  private vpaths = allVehiclePaths();
  private bpaths = bikePaths();
  private nextId = 1;
  private spawnT: Record<Dir, number> = { N: 0, E: 0.4, S: 0.9, W: 1.3 };
  private bikeT = 2;
  private heads: SignalHead[];
  private blink = 0;

  constructor(heads: SignalHead[]) {
    this.heads = heads;
    // pre-warm: run the world for a while so the first frame is already busy
    for (let i = 0; i < 26; i++) this.spawnPed(true);
    for (let i = 0; i < 30 * 30; i++) this.step(1 / 30, true);
  }

  private code(kind: Kind) {
    const pre = kind === 'car' ? 'CAR' : kind === 'bus' ? 'BUS' : kind === 'bike' ? 'CYC' : 'PED';
    return `${pre} ${String(this.nextId % 100).padStart(2, '0')}`;
  }

  private create(kind: Kind, path: Path, s: number, v: number): Agent {
    const vis = makeAgent(kind, this.rand);
    this.group.add(vis.root);
    const v0 = kind === 'car' ? 11 + this.rand() * 4 : kind === 'bus' ? 9.5 : kind === 'bike' ? 5 + this.rand() * 1.5 : 1.15 + this.rand() * 0.45;
    const a: Agent = {
      id: this.nextId,
      code: this.code(kind),
      kind,
      path,
      s,
      v,
      v0,
      acc: 0,
      len: vis.len,
      wid: vis.wid,
      hgt: vis.hgt,
      x: 0,
      z: 0,
      hx: 0,
      hz: 1,
      vis,
      amberRun: false,
      aggressive: this.rand() < 0.26,
      hold: '',
      leader: null,
      gap: Infinity,
      state: 'walk',
      jaywalker: kind === 'ped' && this.rand() < this.jaywalkRate,
      phone: kind === 'ped' && this.rand() < 0.3,
      waited: 0,
      phase: this.rand() * 6,
      age: 0,
      dead: false,
    };
    this.nextId++;
    this.place(a);
    this.agents.push(a);
    return a;
  }

  private spawnPed(scatter = false) {
    const arm = DIRS[Math.floor(this.rand() * 4)];
    const p = pedPath(arm, this.rand() < 0.5, this.rand);
    const s = scatter ? this.rand() * p.stopS * 0.95 : 0;
    this.create('ped', p, s, 0);
  }

  private clearAt(p: Path, s: number, room: number) {
    sample(p, s, tmp);
    for (const a of this.agents) {
      if (a.kind === 'ped') continue;
      if (Math.hypot(a.x - tmp.x, a.z - tmp.z) < room) return false;
    }
    return true;
  }

  private spawnVehicles(dt: number) {
    const SPAWN_S = 55;
    for (const d of DIRS) {
      this.spawnT[d] -= dt;
      if (this.spawnT[d] > 0) continue;
      this.spawnT[d] = (1.4 + this.rand() * 3.2) / this.density;
      const lane = this.rand() < 0.5 ? 0 : 1;
      const turn = this.rand() < 0.26;
      const m = lane === 0 ? (turn ? 'left' : 'straight') : turn ? 'right' : 'straight';
      const path = this.vpaths.find((p) => p.approach === d && p.lane === lane && p.maneuver === m)!;
      const kind: Kind = lane === 1 && m === 'straight' && this.rand() < 0.08 ? 'bus' : 'car';
      if (!this.clearAt(path, SPAWN_S, kind === 'bus' ? 16 : 11)) continue;
      this.create(kind, path, SPAWN_S, 9);
    }
    this.bikeT -= dt;
    if (this.bikeT <= 0) {
      this.bikeT = (6 + this.rand() * 8) / this.density;
      const p = this.bpaths[Math.floor(this.rand() * this.bpaths.length)];
      if (this.clearAt(p, SPAWN_S, 6)) this.create('bike', p, SPAWN_S, 4.5);
    }
    const pedTarget = Math.round(26 * this.density);
    let peds = 0;
    for (const a of this.agents) if (a.kind === 'ped') peds++;
    if (peds < pedTarget && this.rand() < dt * 2) this.spawnPed();
  }

  private place(a: Agent) {
    sample(a.path, a.s, tmp);
    a.x = tmp.x;
    a.z = tmp.z;
    a.hx = tmp.hx;
    a.hz = tmp.hz;
  }

  /** Oncoming through traffic that a left-turner must wait for. */
  private oncomingBlocks(a: Agent) {
    const opp: Dir = a.path.approach === 'N' ? 'S' : a.path.approach === 'S' ? 'N' : a.path.approach === 'E' ? 'W' : 'E';
    const accept = a.aggressive ? 1.7 : 3.4;
    for (const b of this.agents) {
      if (b === a || b.kind === 'ped' || b.path.approach !== opp || b.path.maneuver === 'left') continue;
      if (b.s > b.path.clearS - 6) continue; // already through
      const dist = b.path.stopS + 6 - b.s; // to the conflict point, roughly
      if (dist < -6) continue;
      const tta = dist / Math.max(1, b.v);
      if (tta < accept && dist < 60) return true;
    }
    return false;
  }

  private onSidewalk(x: number, z: number) {
    return Math.abs(x) > ROAD + 0.2 && Math.abs(z) > ROAD + 0.2;
  }

  /** Nearest obstacle ahead inside this vehicle's swept corridor. */
  private leaderOf(a: Agent, skip: Agent | null) {
    let gap = Infinity;
    let lead: Agent | null = null;
    let dv = 0;
    for (const b of this.agents) {
      if (b === a || b === skip || b.dead) continue;
      if (b.kind === 'ped' && this.onSidewalk(b.x, b.z)) continue;
      const rx = b.x - a.x;
      const rz = b.z - a.z;
      const fwd = rx * a.hx + rz * a.hz;
      if (fwd <= 0 || fwd > 55) continue;
      const lat = Math.abs(rx * a.hz - rz * a.hx);
      const along = Math.abs(b.hx * a.hx + b.hz * a.hz);
      const bHalfLen = (along * b.len + (1 - along) * b.wid) / 2;
      const bHalfWid = (along * b.wid + (1 - along) * b.len) / 2;
      const margin = b.kind === 'ped' ? 0.9 : 0.25;
      if (lat > a.wid / 2 + bHalfWid + margin) continue;
      const g = fwd - a.len / 2 - bHalfLen;
      if (g < gap) {
        gap = g;
        lead = b;
        dv = a.v - b.v * (b.hx * a.hx + b.hz * a.hz);
      }
    }
    return { gap, lead, dv };
  }

  step(dt: number, warm = false) {
    this.signals.update(dt);
    this.spawnVehicles(dt);
    this.blink += dt;

    // vehicles: obstacles first (so mutual blocks can be resolved), then integrate
    const vehicles = this.agents.filter((a) => a.kind !== 'ped');
    const plan = new Map<Agent, { gap: number; dv: number; lead: Agent | null; hold: Agent['hold'] }>();
    for (const a of vehicles) {
      let gap = Infinity;
      let dv = 0;
      let hold: Agent['hold'] = '';
      const front = a.s + a.len / 2;
      const p = a.path;
      if (front < p.stopS + 0.4) {
        const light = this.signals.light(p.group);
        const dStop = p.stopS - front;
        if (light === 'amber' && !a.amberRun) {
          const need = (a.v * a.v) / (2 * 3.4);
          if (dStop < need - 0.6 && a.v > 4) a.amberRun = true;
        }
        if (light === 'red' || (light === 'amber' && !a.amberRun)) {
          gap = dStop;
          dv = a.v;
          hold = light;
        }
      }
      if (p.maneuver === 'left') {
        const holdS = p.stopS + 6;
        if (front < holdS && front > p.stopS - 14 && this.signals.light(p.group) !== 'red' && this.oncomingBlocks(a)) {
          const d = holdS - front;
          if (d < gap) {
            gap = d;
            dv = a.v;
            hold = 'yield';
          }
        }
      }
      const L = this.leaderOf(a, null);
      let lead = L.lead;
      if (L.gap < gap) {
        gap = L.gap;
        dv = L.dv;
        hold = L.lead?.kind === 'ped' ? 'ped' : 'queue';
      }
      plan.set(a, { gap, dv, lead, hold });
    }
    // break deadlocks: two vehicles each waiting on the other → the one further along goes
    for (const a of vehicles) {
      const pa = plan.get(a)!;
      const b = pa.lead;
      if (!b || b.kind === 'ped') continue;
      const pb = plan.get(b);
      if (pb?.lead !== a) continue;
      const progA = a.s - a.path.stopS;
      const progB = b.s - b.path.stopS;
      const winner = progA >= progB ? a : b;
      const L = this.leaderOf(winner, winner === a ? b : a);
      const pw = plan.get(winner)!;
      pw.gap = L.gap;
      pw.dv = L.dv;
      pw.lead = L.lead;
      pw.hold = L.lead ? (L.lead.kind === 'ped' ? 'ped' : 'queue') : '';
    }
    for (const a of vehicles) {
      const pl = plan.get(a)!;
      let v0 = a.v0;
      const inTurn = a.path.maneuver !== 'straight' && a.s > a.path.stopS - 14 && a.s < a.path.clearS;
      if (inTurn) v0 = Math.min(v0, a.path.maneuver === 'left' ? 7.5 : 5.5);
      const aMax = a.kind === 'bus' ? 1.1 : a.kind === 'bike' ? 1.2 : 1.7;
      const b = 3.2;
      let acc = aMax * (1 - Math.pow(a.v / v0, 4));
      if (isFinite(pl.gap)) {
        const sStar = 2 + Math.max(0, a.v * 1.15 + (a.v * pl.dv) / (2 * Math.sqrt(aMax * b)));
        acc -= aMax * Math.pow(sStar / Math.max(pl.gap, 0.15), 2);
      }
      acc = Math.max(-8, Math.min(aMax, acc));
      a.acc = acc;
      a.v = Math.max(0, a.v + acc * dt);
      a.s += a.v * dt;
      a.leader = pl.lead;
      a.gap = pl.gap;
      a.hold = a.v < 0.6 ? pl.hold : pl.hold === 'ped' || pl.hold === 'yield' ? pl.hold : a.acc < -1.2 ? pl.hold : '';
      if (a.s > a.path.stopS + 2) a.amberRun = false;
      if (a.s > a.path.length - 55) a.dead = true;
    }

    // pedestrians
    for (const a of this.agents) {
      if (a.kind !== 'ped') continue;
      const p = a.path;
      if (a.state === 'walk') {
        a.v = a.v0;
        a.s += a.v * dt;
        if (a.s >= p.stopS) {
          a.s = p.stopS;
          a.state = 'wait';
          a.waited = 0;
        }
      } else if (a.state === 'wait') {
        a.v = 0;
        a.waited += dt;
        const go = this.signals.walk(p.crossArm!) || (a.jaywalker && a.waited > 1.2 + (a.id % 5) * 0.4);
        if (go && a.waited > 0.4) a.state = 'cross';
      } else if (a.state === 'cross') {
        a.v = a.v0 * (a.jaywalker && !this.signals.walk(p.crossArm!) ? 1.25 : 1.05);
        a.s += a.v * dt;
        if (a.s >= p.clearS) a.state = 'away';
      } else {
        a.v = a.v0;
        a.s += a.v * dt;
        if (a.s >= p.length - 0.5) a.dead = true;
      }
      a.phase += a.v * dt * 4.4; // about one stride cycle per 1.4 m
    }

    for (const a of this.agents) {
      a.age += dt;
      this.place(a);
    }
    if (this.agents.some((a) => a.dead)) {
      for (const a of this.agents) if (a.dead) this.group.remove(a.vis.root);
      this.agents = this.agents.filter((a) => !a.dead);
    }
    if (!warm) this.sync();
  }

  /** Push simulation state into the scene graph. */
  sync() {
    for (const a of this.agents) {
      const r = a.vis.root;
      const pad = a.kind === 'ped' && this.onSidewalk(a.x, a.z) ? 0.16 : 0.02;
      r.position.set(a.x, pad, a.z);
      r.rotation.y = Math.atan2(a.hx, a.hz);
      if (a.kind === 'ped') {
        const amp = (a.vis.walkAmp += ((a.v > 0.1 ? 1 : 0) - a.vis.walkAmp) * 0.15);
        a.vis.walk?.set(a.phase, 0.44 * amp, 0.36 * amp);
        a.vis.bob.position.y = Math.abs(Math.sin(a.phase)) * 0.035 * amp;
        a.vis.bob.rotation.z = Math.sin(a.phase) * 0.025 * amp + Math.sin(a.age * 1.3) * 0.012 * (1 - amp);
      } else if (a.kind === 'bike') {
        const amp = (a.vis.walkAmp += ((a.v > 0.3 ? 1 : 0) - a.vis.walkAmp) * 0.1);
        // cadence: one crank turn per ~4.8 m
        a.vis.walk?.set(a.s * 1.3, 0.4 * amp, 0);
        a.vis.bob.rotation.z = Math.sin(a.age * 4) * 0.015;
      }
      if (a.vis.tail) {
        const braking = a.acc < -0.9 || a.v < 0.3;
        a.vis.tail.color.setRGB(braking ? 7 : 1.4, braking ? 0.25 : 0.05, braking ? 0.15 : 0.04);
      }
      if (a.vis.indL && a.vis.indR) {
        const m = a.path.maneuver;
        const signalling = m !== 'straight' && a.s > a.path.stopS - 45 && a.s < a.path.clearS;
        const on = signalling && Math.floor(this.blink * 3) % 2 === 0;
        a.vis.indL.visible = on && m === 'left';
        a.vis.indR.visible = on && m === 'right';
      }
    }
    for (const h of this.heads) {
      const l = this.signals.light(groupOf(h.dir));
      h.red.color.setRGB(l === 'red' ? 6 : 0.12, l === 'red' ? 0.35 : 0.02, l === 'red' ? 0.2 : 0.02);
      h.amber.color.setRGB(l === 'amber' ? 6 : 0.12, l === 'amber' ? 2.8 : 0.07, 0.02);
      h.green.color.setRGB(0.02, l === 'green' ? 6 : 0.1, l === 'green' ? 2.6 : 0.05);
    }
  }
}
