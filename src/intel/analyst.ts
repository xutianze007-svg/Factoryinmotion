// The intersection's perception + prediction layer. Every road user's path is extrapolated a
// few seconds ahead; pairs whose futures intersect become conflicts with a time-to-collision.
// Readings are written verdict-first: what matters, then why, then the numbers.

import * as THREE from 'three';
import type { SignalHead } from '../world/city';
import { type Dir, groupOf, sample } from '../world/layout';
import { G } from '../world/materials';
import type { Agent, Traffic } from '../world/traffic';

export type Verdict = 'safe' | 'note' | 'caution' | 'risk';

export interface Relation {
  tone: 'risk' | 'caution' | 'info';
  label: string;
  target: string;
  detail?: string;
  /** world point the relation points at */
  to: THREE.Vector3;
  agent?: Agent;
}

export interface Reading {
  id: string;
  code: string;
  kind: string;
  verdict: Verdict;
  headline: string;
  summary: string;
  facts: { k: string; v: string; hot?: boolean }[];
  relations: Relation[];
  /** world anchor (for leader line) */
  at: THREE.Vector3;
}

export interface Conflict {
  a: Agent;
  b: Agent;
  ttc: number;
}

const DIR_WORD: Record<Dir, string> = { N: 'southbound', S: 'northbound', E: 'westbound', W: 'eastbound' };
const ARM_WORD: Record<Dir, string> = { N: 'north', S: 'south', E: 'east', W: 'west' };

function kmh(v: number) {
  return `${Math.round(v * 3.6)} km/h`;
}
function sec(t: number) {
  return `${t.toFixed(1)} s`;
}
function metres(d: number) {
  return `${d.toFixed(d < 10 ? 1 : 0)} m`;
}

/** Where an agent will be in t seconds if it keeps doing what it is doing. */
export function predict(a: Agent, t: number, out = { x: 0, z: 0, hx: 0, hz: 1 }) {
  let s = a.s;
  if (a.kind === 'ped') {
    const moving = a.state !== 'wait' || (a.jaywalker && a.waited > 0.8);
    s = moving ? a.s + Math.max(a.v, a.state === 'wait' ? a.v0 : a.v) * t : a.s;
  } else if (a.acc < -0.2) {
    // braking: it stops where it stops
    s = a.s + Math.min(a.v * t + 0.5 * a.acc * t * t, (a.v * a.v) / (2 * -a.acc));
  } else {
    s = a.s + a.v * t + 0.25 * a.acc * t * t;
  }
  return sample(a.path, s, out);
}

function segDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  // distance between segments AB and CD (2D)
  const d = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => {
    const vx = rx - qx;
    const vz = rz - qz;
    const l2 = vx * vx + vz * vz || 1e-9;
    let t = ((px - qx) * vx + (pz - qz) * vz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (qx + vx * t), pz - (qz + vz * t));
  };
  return Math.min(d(ax, az, cx, cz, dx, dz), d(bx, bz, cx, cz, dx, dz), d(cx, cz, ax, az, bx, bz), d(dx, dz, ax, az, bx, bz));
}

const pa = { x: 0, z: 0, hx: 0, hz: 1 };
const pb = { x: 0, z: 0, hx: 0, hz: 1 };

function bodyGap(a: Agent, A: typeof pa, b: Agent, B: typeof pb) {
  const ha = Math.max(0, (a.len - a.wid) / 2);
  const hb = Math.max(0, (b.len - b.wid) / 2);
  const d = segDist(A.x - A.hx * ha, A.z - A.hz * ha, A.x + A.hx * ha, A.z + A.hz * ha, B.x - B.hx * hb, B.z - B.hz * hb, B.x + B.hx * hb, B.z + B.hz * hb);
  return d - a.wid / 2 - b.wid / 2;
}

export class Analyst {
  conflicts: Conflict[] = [];
  private t = 0;
  private traffic: Traffic;
  private heads: SignalHead[];

  constructor(traffic: Traffic, heads: SignalHead[]) {
    this.traffic = traffic;
    this.heads = heads;
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.1;
    const out: Conflict[] = [];
    const A = this.traffic.agents;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (a.kind === 'ped' && b.kind === 'ped') continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > 48) continue;
        const veh = a.kind !== 'ped' ? a : b;
        const other = veh === a ? b : a;
        // same-lane following is headway, not a conflict
        if (other.kind !== 'ped' && veh.path.approach === other.path.approach && veh.path.lane === other.path.lane) continue;
        if (a.v < 0.25 && b.v < 0.25 && !(other.kind === 'ped' && other.jaywalker && other.state === 'wait')) continue;
        if (other.kind === 'ped' && other.state !== 'cross' && !(other.jaywalker && other.state === 'wait')) continue;
        // people walking past a vehicle that is already stopped are not at risk
        if ((other.kind === 'ped' || other.kind === 'bike') && veh.v < 0.6 && veh.acc <= 0.3) continue;
        for (let t = 0; t <= 3.6; t += 0.2) {
          predict(a, t, pa);
          predict(b, t, pb);
          if (bodyGap(a, pa, b, pb) < 0.45) {
            if (t >= 0.2) out.push({ a, b, ttc: t }); // already side by side ≠ a predicted conflict
            break;
          }
        }
      }
    }
    out.sort((x, y) => x.ttc - y.ttc);
    this.conflicts = out;
  }

  conflictsOf(a: Agent) {
    return this.conflicts.filter((c) => c.a === a || c.b === a).map((c) => ({ other: c.a === a ? c.b : c.a, ttc: c.ttc }));
  }

  isRisky(a: Agent) {
    return this.conflictsOf(a).some((c) => c.ttc < 2.4);
  }

  private intent(a: Agent) {
    const m = a.path.maneuver;
    const committed = a.s > a.path.stopS + 1;
    const indicating = m !== 'straight' && a.s > a.path.stopS - 45;
    if (committed || indicating) {
      return m === 'straight' ? 'straight 97%' : `${m} ${committed ? 99 : 91}% · straight ${committed ? 1 : 9}%`;
    }
    const alt = a.path.lane === 0 ? 'left' : 'right';
    return `straight 78% · ${alt} 22%`;
  }

  private signalFor(a: Agent) {
    return this.heads.find((h) => h.dir === a.path.approach);
  }

  read(a: Agent): Reading {
    const S = this.traffic.signals;
    const conflicts = this.conflictsOf(a).sort((x, y) => x.ttc - y.ttc);
    const worst = conflicts[0];
    const rel: Relation[] = [];
    const at = new THREE.Vector3(a.x, a.hgt + 0.4, a.z);
    const range = Math.hypot(a.x - G.uSensor.value.x, a.z - G.uSensor.value.z);
    const pos = (b: Agent) => new THREE.Vector3(b.x, b.hgt * 0.6, b.z);
    for (const c of conflicts.slice(0, 2))
      rel.push({
        tone: c.ttc < 2.4 ? 'risk' : 'caution',
        label: c.ttc < 2.4 ? 'Conflict' : 'Closing',
        target: c.other.code,
        detail: `TTC ${sec(c.ttc)}`,
        to: pos(c.other),
        agent: c.other,
      });

    if (a.kind === 'ped') {
      const arm = a.path.crossArm!;
      const walk = S.walk(arm);
      const toGo = Math.max(0, a.path.clearS - a.s);
      const facts = [
        { k: 'speed', v: kmh(a.v) },
        { k: 'signal', v: walk ? `walk · ${sec(S.walkRemaining(arm))}` : "don't walk", hot: !walk && a.state === 'cross' },
        ...(a.phone ? [{ k: 'attention', v: 'looking at phone', hot: true }] : []),
        { k: 'range', v: `${metres(range)} from node` },
      ];
      let verdict: Verdict = 'safe';
      let headline = 'On the sidewalk';
      let summary = `Walking at ${kmh(a.v)}; not heading into traffic.`;
      if (a.state === 'cross' && !walk) {
        verdict = worst && worst.ttc < 2.4 ? 'risk' : 'caution';
        headline = 'Crossing against the signal';
        summary = worst
          ? `Stepped out on don't-walk. ${worst.other.code} reaches the same spot in ${sec(worst.ttc)}${worst.other.acc < -2 ? ' and is braking hard' : ''}.`
          : `Stepped out on don't-walk with ${metres(toGo)} of road left to cross.`;
      } else if (a.state === 'cross') {
        verdict = worst && worst.ttc < 2.4 ? 'risk' : 'safe';
        headline = worst && worst.ttc < 2.4 ? 'Vehicle closing on the crossing' : 'Crossing on walk';
        summary = worst && worst.ttc < 2.4
          ? `${worst.other.code} is turning into the crosswalk; they meet in ${sec(worst.ttc)}.`
          : `${metres(toGo)} to the far curb, about ${sec(toGo / Math.max(0.5, a.v))}; the walk signal has ${sec(S.walkRemaining(arm))} left.`;
      } else if (a.state === 'wait') {
        if (a.jaywalker && !walk) {
          verdict = 'caution';
          headline = 'About to cross against the signal';
          summary = `Edging off the curb on the ${ARM_WORD[arm]} side; the walk signal is still red.`;
        } else {
          verdict = 'note';
          headline = 'Waiting to cross';
          const g = groupOf(arm) === 'NS' ? 'EW' : 'NS';
          summary = walk ? 'Walk signal is on; stepping off now.' : `Walk signal in about ${sec(S.untilGreen(g))}.`;
        }
      }
      if (a.phone && verdict !== 'safe') summary += ' Eyes on a phone.';
      return { id: `a${a.id}`, code: a.code, kind: 'Pedestrian', verdict, headline, summary, facts, relations: rel, at };
    }

    // vehicles and bikes
    const p = a.path;
    const group = p.group;
    const light = S.light(group);
    const front = a.s + a.len / 2;
    const toLine = p.stopS - front;
    const beforeLine = toLine > -0.5;
    const sig = this.signalFor(a);
    const sigText = light === 'green' ? `green · ${sec(S.remaining(group))}` : light === 'amber' ? `amber · ${sec(S.remaining(group))}` : `red · green in ${sec(S.untilGreen(group))}`;
    const facts: Reading['facts'] = [
      { k: 'speed', v: kmh(a.v), hot: a.v * 3.6 > 48 },
      { k: 'intent', v: this.intent(a) },
      { k: 'signal', v: sigText, hot: light !== 'green' && beforeLine && a.v > 6 },
      { k: 'range', v: `${metres(range)} from node` },
    ];
    if (a.leader && a.leader.kind !== 'ped' && a.v > 0.5 && a.gap < 40) {
      const hw = a.gap / Math.max(0.5, a.v);
      facts.splice(3, 0, { k: 'headway', v: `${sec(hw)} to ${a.leader.code}`, hot: hw < 1 });
    }
    if (sig && beforeLine) rel.push({ tone: 'info', label: 'Signal', target: `${ARM_WORD[p.approach]} approach`, detail: light, to: sig.pos.clone() });
    if (a.leader && a.leader.kind !== 'ped' && a.gap < 22 && rel.length < 3)
      rel.push({ tone: 'info', label: 'Following', target: a.leader.code, detail: metres(Math.max(0, a.gap)), to: pos(a.leader), agent: a.leader });

    const kind = a.kind === 'bus' ? 'Bus' : a.kind === 'bike' ? 'Cyclist' : 'Vehicle';
    const mv = p.maneuver === 'straight' ? 'go straight' : `turn ${p.maneuver}`;
    let verdict: Verdict = 'safe';
    let headline = 'Clear to proceed';
    let summary = `${DIR_WORD[p.approach][0].toUpperCase() + DIR_WORD[p.approach].slice(1)} at ${kmh(a.v)}; likely to ${mv}.`;

    if (worst && worst.ttc < 2.4) {
      verdict = 'risk';
      const o = worst.other;
      headline =
        o.kind === 'ped' ? 'Pedestrian in its path' : o.kind === 'bike' ? 'Cyclist in its path' : a.kind === 'bike' ? `${o.code} cutting across` : `Paths cross with ${o.code}`;
      summary = `${a.code} and ${o.code} reach the same point in ${sec(worst.ttc)}. ${
        a.acc < -2.5 ? `${a.code} is already braking hard.` : a.v > 3 ? `${a.code} hasn't started slowing.` : `${a.code} is barely moving.`
      }`;
    } else if (a.amberRun && beforeLine) {
      verdict = 'caution';
      headline = 'Running the amber';
      summary = `At ${kmh(a.v)} it can't stop in the ${metres(Math.max(0, toLine))} left; it will clear the junction just as the light turns red.`;
    } else if (a.hold === 'yield') {
      verdict = 'note';
      headline = 'Yielding to oncoming traffic';
      summary = `Holding in the junction to turn left; waiting for a gap of at least ${a.aggressive ? '1.7' : '3.4'} s.`;
    } else if (worst) {
      verdict = 'caution';
      headline = `Closing on ${worst.other.code}`;
      summary = `Their paths meet in ${sec(worst.ttc)} if neither changes speed.`;
    } else if (a.hold === 'ped' && a.v < 0.5) {
      verdict = 'note';
      headline = 'Waiting for a pedestrian';
      summary = `Someone is crossing just ahead; it moves off once they clear the lane.`;
    } else if (a.hold === 'ped') {
      verdict = 'caution';
      headline = 'Braking for a pedestrian';
      summary = `Someone is in the crossing ${metres(Math.max(0, a.gap))} ahead; slowing from ${kmh(a.v)}.`;
    } else if ((a.hold === 'red' || a.hold === 'amber') && a.v < 0.5) {
      verdict = 'safe';
      headline = light === 'amber' ? 'Stopped for the amber' : 'Holding at red';
      summary = `Stopped ${metres(Math.max(0, toLine))} before the line. Green in ${sec(S.untilGreen(group))}; then it will ${mv}.`;
    } else if (a.hold === 'red' || a.hold === 'amber') {
      verdict = 'safe';
      headline = 'Stopping for the light';
      summary = `Slowing from ${kmh(a.v)} with ${metres(Math.max(0, toLine))} to the line.`;
    } else if (a.hold === 'queue' && a.v < 0.6 && a.leader) {
      verdict = 'safe';
      headline = `Queued behind ${a.leader.code}`;
      summary = `Waiting ${metres(Math.max(0, a.gap))} behind the vehicle ahead; the light is ${light}.`;
    } else if (!beforeLine && a.s < p.clearS) {
      verdict = 'safe';
      headline = p.maneuver === 'straight' ? 'Crossing the junction' : `Turning ${p.maneuver}`;
      summary = `Inside the junction at ${kmh(a.v)}; clears it in about ${sec(Math.max(0, p.clearS - a.s) / Math.max(1, a.v))}.`;
    } else if (beforeLine && light === 'green') {
      summary = `Green for ${sec(S.remaining(group))} more; reaches the line in ${sec(Math.max(0, toLine) / Math.max(1, a.v))} and will ${mv}.`;
    } else if (!beforeLine) {
      headline = 'Leaving the junction';
      summary = `Clear of the intersection, ${DIR_WORD[p.approach]} at ${kmh(a.v)}.`;
    }
    return { id: `a${a.id}`, code: a.code, kind, verdict, headline, summary, facts, relations: rel.slice(0, 3), at };
  }

  readSignal(h: SignalHead): Reading {
    const S = this.traffic.signals;
    const g = groupOf(h.dir);
    const light = S.light(g);
    const queued = this.traffic.agents.filter(
      (a) => a.kind !== 'ped' && a.path.approach === h.dir && a.s + a.len / 2 < a.path.stopS + 0.5 && a.path.stopS - a.s < 70,
    );
    queued.sort((x, y) => y.s - x.s);
    const waiting = queued.filter((a) => a.v < 0.5).length;
    const verdict: Verdict = light === 'green' ? 'safe' : light === 'amber' ? 'caution' : 'note';
    const word = light[0].toUpperCase() + light.slice(1);
    const headline = light === 'red' ? `Red — green in ${sec(S.untilGreen(g))}` : `${word} — ${sec(S.remaining(g))} left`;
    const summary = `Controls the ${ARM_WORD[h.dir]} approach: ${queued.length} vehicle${queued.length === 1 ? '' : 's'} on it, ${waiting} waiting.`;
    const rel: Relation[] = queued.slice(0, 3).map((a) => ({
      tone: 'info',
      label: a.v < 0.5 ? 'Holding' : 'Approaching',
      target: a.code,
      detail: kmh(a.v),
      to: new THREE.Vector3(a.x, a.hgt * 0.6, a.z),
      agent: a,
    }));
    return {
      id: `s${h.dir}`,
      code: `SIG ${h.dir}`,
      kind: 'Traffic signal',
      verdict,
      headline,
      summary,
      facts: [
        { k: 'phase', v: `${light} · ${light === 'red' ? `green in ${sec(S.untilGreen(g))}` : `${sec(S.remaining(g))} left`}` },
        { k: 'queue', v: `${waiting} stopped · ${queued.length} on approach` },
        { k: 'cycle', v: '44 s · 2 phases' },
      ],
      relations: rel,
      at: h.pos.clone(),
    };
  }
}
