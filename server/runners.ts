// Server side of the runners (shared/runner.ts, docs/runner.md): where each one is, what it does, its bites and shots,
// the hits it takes. Owned and ticked by server/guardians.ts (its bites are that tick's `mauled`, its bolts are the
// guardians' bolts), sent in its 'bots' (`r`). In memory only.
//
// Once the world lets them out (`out`: shared/worldState.ts, a boss beaten), now and then (GAP_MIN_MS..GAP_MAX_MS) one is sent for someone out in the open desert (past KEEP_OUT from the start),
// day or night: it comes from COME_MIN..COME_MAX m off at a trot, and once it sees them it hunts them:
// - stalking: legs like the show's driver's (src/world/runner.ts Prowl): sprinting a third to two thirds of a lap round
//   them, prowling to a spot a little in or out, or stopping to stare (jaws snapping), out on a ring (RING, the armed
//   one's further out: KEEP_MIN..KEEP_MAX);
// - the plain one, after STALK_MS, charges: flat out at where they'll be, turning no faster than TURN_SPRINT (step
//   aside late and it overshoots); its jaws bite whoever they pass within BITE_R of, where clients draw it (BOT_DELAY_MS
//   behind). A bite or a miss and it pulls up (R_RECOVER), turns and comes again, CHARGES times, then stalks a while;
// - the armed one stops to stare and aims: raises its gun (RAISE_MS), charges it (CHARGE_MS) and fires a guardian's
//   bolt at them every FIRE_MS while it sees them, SHOTS times, then sprints off round them to shoot from somewhere
//   else. Anyone coming within CLOSE_R of either is charged at once.
// It gives up (R_LEAVE, trotting away) when it has lost them for LOSE_MS, after GIVE_UP_MS, or when they're dead;
// gone when nobody is within GONE_R. A storm front's static seizes it where it stands.
// Dead, its wreck lies there WRECK_MS and still bites (`wreck`): anyone in the open coming within WAKE_R of its maw
// wakes it, it draws its jaws back (RUNNER_WAKE_MS, as drawn) and snaps them on whoever is still within WRECK_BITE_R.
import { BOT_DELAY_MS, lineOfSight } from '../shared/guardians.ts';
import { heightAt } from '../shared/terrain.ts';
import { ORIGIN } from '../shared/origin.ts';
import { seized, type Storm } from '../shared/storm.ts';
import { bites, kills, type Gun } from '../shared/rifle.ts';
import { ENEMIES } from '../shared/enemies.ts';
import {
  GUN_CHARGE_MS, GUN_FIRE_MS, RUNNER_WAKE_MS, WRECK_MAW, GUN_RAISE_MS, JAW_REACH, R_AIM, R_CHARGE, R_DEAD, R_LEAVE, R_RECOVER, R_ROAM, R_STALK, RP_CORE, RP_EYES, RUNNER_ACCEL, RUNNER_BODY_Y,
  RUNNER_BRAKE, RUNNER_EYE_Y, RUNNER_GALLOP, RUNNER_POINTS, RUNNER_SPRINT, RUNNER_TROT, RUNNER_WALK, runnerDead, TURN_SPRINT,
  TURN_STAND, TURN_WALK, type RunnerKind,
} from '../shared/runner.ts';
import { open, r2, r3, rand, wrap, type BotPlayer } from './bots.ts';
import { keepOut } from './pack.ts';
import type { Tracks } from './tracks.ts';

/** One is sent every GAP_MIN_MS..GAP_MAX_MS (the first FIRST_MIN_MS..GAP_MIN_MS in) for someone out past KEEP_OUT m from
 *  the start; with nobody out there, it looks again after RETRY_MS. At most MAX_OUT at once; ARMED_ODDS of them armed. */
export const GAP_MIN_MS = 5 * 60_000, GAP_MAX_MS = 11 * 60_000;
const FIRST_MIN_MS = 2 * 60_000;
const RETRY_MS = 30_000;
const MAX_OUT = 2;
export const ARMED_ODDS = 0.35;
export const KEEP_OUT = 250;
/** It comes from this far off (m), and is gone with nobody within GONE_R; sent to whoever is within SEND_R. */
const COME_MIN = 220, COME_MAX = 300;
const GONE_R = 700;
const SEND_R = 500;
/** It sees anyone out in the open within SIGHT m it has a line of sight to (from its eyes to their chest). */
export const SIGHT = 110;
/** Hunting: lost from sight this long (ms), further than LOST_R m, or after GIVE_UP_MS, it gives up. */
const LOSE_MS = 8000, LOST_R = 260, GIVE_UP_MS = 150_000;
/** Stalking: this long (ms) before the plain one charges; out on a ring this far (m) round its prey (the armed one's
 *  KEEP_MIN..KEEP_MAX); stares last STARE_MS. */
export const STALK_MS: [number, number] = [6000, 11_000];
const RING: [number, number] = [24, 38];
export const KEEP_MIN = 45, KEEP_MAX = 75;
const STARE_MS: [number, number] = [1500, 3000];
/** Charging: led by `LEAD` s of its prey's way at most; it gives up a charge after CHARGE_MAX_MS. Pulls up for
 *  RECOVER_MS, CHARGES times before it stalks again. Anyone within CLOSE_R is charged at once. */
const LEAD = 0.5;
const CHARGE_MAX_MS = 5000;
const RECOVER_MS: [number, number] = [900, 1500];
const CHARGES = 3;
export const CLOSE_R = 9;
/** Within this (m) of its prey a charge commits: it runs straight on at where it was aiming, no more turning (step
 *  aside then and it misses; any sooner and it turns after you). */
export const COMMIT_R = 14;
/** Its jaws bite whoever they pass within this (m, flat) of, where they're drawn. */
export const BITE_R = 1.4;
/** The armed one's gun (shared/runner.ts GUN_*): raised in RAISE_MS, charged CHARGE_MS before each shot, a shot every
 *  FIRE_MS at most, at someone within FIRE_R (m) it sees; SHOTS from one spot. The bolt leaves MUZZLE_Y over the ground, MUZZLE_AHEAD
 *  along the line from its body. */
const RAISE_MS = GUN_RAISE_MS, CHARGE_MS = GUN_CHARGE_MS, FIRE_MS = GUN_FIRE_MS;
export const FIRE_R = 110;
const SHOTS: [number, number] = [2, 3];
const MUZZLE_Y = 5, MUZZLE_AHEAD = 2.5;
/** Its hull's plate: hits of a gun that bites it (shared/enemies.ts armor) it takes. */
export const HULL_HP = 6;
/** A shot ending this near (m) a weak point (where it was drawn, any time in the last HIST_MS) counts for it; the gun's
 *  core, swinging about on its arm, CORE_SLACK. A hull hit within its box (HULL_X, HULL_Z either side, HULL_Y over its
 *  ground) and HULL_SLACK. */
const HIT_SLACK = 1.6, CORE_SLACK = 2.6;
const HULL_X = 1.4, HULL_Z = 3.5, HULL_Y = 4.2, HULL_SLACK = 1;
const HIST_MS = 1000;
/** A dead one lies there this long (ms). */
const WRECK_MS = 90_000;
/** Anyone within WAKE_R (m, flat) of its wreck's maw (shared/runner.ts WRECK_MAW), once it has lain STIR_MS, wakes it:
 *  its jaws draw back (RUNNER_WAKE_MS, as drawn) and snap shut on whoever is within WRECK_BITE_R; it bites again no
 *  sooner than REST_MS after. */
export const WAKE_R = 3.2, WRECK_BITE_R = 2.4;
const STIR_MS = 2500, REST_MS = 2500;

/** A stalking leg: to (tx, tz) (by `via` first, if any: x, z), at `want` m/s, or stood staring; over at `until`. */
type Leg = { tx: number; tz: number; via: [number, number] | null; want: number; stare: boolean; until: number };

export type Runner = {
  id: number; kind: RunnerKind;
  x: number; z: number; yaw: number; v: number;
  st: number; stAt: number;
  /** Pulling up after a charge till then (server ms). */
  until: number;
  /** Who it was sent for, who it hunts (-1 nobody), when it took them on, last saw them and where. */
  mark: number; prey: number; huntAt: number; seenAt: number; px: number; pz: number;
  /** Where it's headed and how fast it wants to go; a point it turns to face standing (null: none). */
  tx: number; tz: number; want: number; face: { x: number; z: number } | null;
  leg: Leg | null; stalkUntil: number; charges: number;
  /** Charging and committed (COMMIT_R): straight on. */
  committed: boolean;
  /** Looking at (lx, ly, lz). */
  look: boolean; lx: number; ly: number; lz: number;
  /** The gun: when it was raised (-1 carried), started charging (-1 not), last fired; shots from here, and wanted. */
  raisedAt: number; chargeAt: number; firedAt: number; shots: number; shotsWanted: number;
  hits: number[]; broken: number; hull: number; deadAt: number;
  /** Its last bite (server ms, 0 none). */
  snapAt: number;
  /** Its wreck: when it last began to draw its jaws back (server ms, 0 never), and whether that bite has snapped. */
  lungeAt: number; lunged: boolean;
  /** Where it was (t, x, z, yaw, ...) over the last HIST_MS: as clients draw it. */
  hist: number[];
};

/** Killed: where, which kind, by whom (for its spoils and the kill). */
export type RunnerKill = { x: number; z: number; kind: RunnerKind; by: number };
/** A bolt it fires: from (x, y, z) along unit (dx, dy, dz) (server/guardians.ts flies it). */
export type Fire = (r: Runner, x: number, y: number, z: number, dx: number, dy: number, dz: number) => void;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = ([a, b]: [number, number]) => rand(a, b);
const _a = { x: 0, z: 0, yaw: 0 }, _b = { x: 0, z: 0, yaw: 0 };

export class RunnerServer {
  runners: Runner[] = [];
  /** Whether they're sent out at all (shared/worldState.ts runners; server/world.ts sets it). Summons ignore it. */
  out = true;
  private nextId = 1;
  private nextAt: number;

  constructor(now = performance.now()) {
    this.nextAt = now + rand(FIRST_MIN_MS, GAP_MIN_MS);
  }

  /** One of `kind` coming for p from `d` m off (debug: 45 m and hunting them at once). */
  spawn(kind: RunnerKind, p: BotPlayer, now: number, d = rand(COME_MIN, COME_MAX), hunting = false): Runner {
    const a = rand(-Math.PI, Math.PI);
    const [x, z] = keepOut(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, 3);
    const r: Runner = {
      id: this.nextId++, kind, x, z, yaw: Math.atan2(p.x - x, p.z - z), v: 0, st: R_ROAM, stAt: now, until: 0,
      mark: p.id, prey: -1, huntAt: 0, seenAt: 0, px: p.x, pz: p.z, tx: p.x, tz: p.z, want: RUNNER_TROT, face: null,
      leg: null, stalkUntil: 0, charges: 0, committed: false, look: false, lx: 0, ly: 0, lz: 0,
      raisedAt: -1, chargeAt: -1, firedAt: 0, shots: 0, shotsWanted: 0,
      hits: RUNNER_POINTS.map(() => 0), broken: 0, hull: 0, deadAt: -1, snapAt: 0, lungeAt: 0, lunged: true, hist: [],
    };
    this.runners.push(r);
    if (hunting) this.hunt(r, p, now, 3000);
    return r;
  }

  /** Debug menu: one of `kind` 45 m from p, hunting them. */
  summon(kind: RunnerKind, p: BotPlayer, now: number) {
    this.spawn(kind, p, now, 45, true);
  }

  /** Debug menu: a plain one's wreck 12 m from p, facing them (no spoils: it was never killed). */
  summonWreck(p: BotPlayer, now: number) {
    const r = this.spawn('plain', p, now, 12);
    r.hist.push(now, r.x, r.z, r.yaw);
    this.die(r, now, -1);
  }

  /** Advance by dt (s) at server time `now`: sending them out, their hunting, moving. Who was bitten goes into `mauled`;
   *  bolts go out through `fire`. */
  tick(dt: number, now: number, players: BotPlayer[], storms: readonly Storm[], vel: Tracks, mauled: number[], fire: Fire) {
    const exposed = players.filter(open);
    this.send(now, exposed);
    const byId = new Map(exposed.map((p) => [p.id, p]));
    this.runners = this.runners.filter((r) => {
      if (r.deadAt >= 0) {
        this.wreck(r, now, exposed, mauled);
        return now - r.deadAt < WRECK_MS && players.some((p) => Math.hypot(p.x - r.x, p.z - r.z) < GONE_R);
      }
      if (!players.some((p) => Math.hypot(p.x - r.x, p.z - r.z) < GONE_R)) return false;
      if (seized(storms, r.x, r.z, now)) {
        // Seized up: it stands there, staring at nothing, till the front has passed.
        r.want = 0;
        r.face = null;
        r.look = false;
        r.raisedAt = r.chargeAt = -1;
      } else this.think(r, now, players, exposed, byId, vel, fire);
      this.drive(r, dt);
      this.remember(r, now);
      if (r.st === R_CHARGE && !seized(storms, r.x, r.z, now)) this.bite(r, now, dt, exposed, mauled);
      return r.st !== R_LEAVE || now - r.stAt < 90_000;
    });
  }

  /** Now and then one is sent for someone out in the open. */
  private send(now: number, exposed: BotPlayer[]) {
    if (now < this.nextAt) return;
    if (!this.out) {
      // Not yet: the first comes a while after they're let out, not the moment the boss falls.
      this.nextAt = now + rand(FIRST_MIN_MS, GAP_MIN_MS);
      return;
    }
    const out = exposed.filter((p) => Math.hypot(p.x - ORIGIN.x, p.z - ORIGIN.z) > KEEP_OUT);
    if (!out.length || this.runners.filter((r) => r.deadAt < 0).length >= MAX_OUT) {
      this.nextAt = now + RETRY_MS;
      return;
    }
    this.spawn(Math.random() < ARMED_ODDS ? 'armed' : 'plain', out[Math.floor(Math.random() * out.length)], now);
    this.nextAt = now + rand(GAP_MIN_MS, GAP_MAX_MS);
  }

  /** Takes on p as its prey: stalking them for `stalk` ms (else STALK_MS) before it charges. */
  private hunt(r: Runner, p: BotPlayer, now: number, stalk = pick(STALK_MS)) {
    r.prey = p.id;
    r.huntAt = r.seenAt = now;
    r.px = p.x;
    r.pz = p.z;
    r.charges = 0;
    r.stalkUntil = now + stalk;
    this.set(r, R_STALK, now);
  }

  private set(r: Runner, st: number, now: number) {
    r.st = st;
    r.stAt = now;
    r.leg = null;
    r.face = null;
    r.committed = false;
    if (st !== R_AIM) r.raisedAt = r.chargeAt = -1;
    if (st === R_RECOVER) r.until = now + pick(RECOVER_MS);
    if (st === R_AIM) {
      r.shots = 0;
      r.shotsWanted = Math.round(pick(SHOTS));
    }
  }

  private sees(r: Runner, p: BotPlayer): boolean {
    if (Math.hypot(p.x - r.x, p.z - r.z) > SIGHT) return false;
    return lineOfSight(r.x, heightAt(r.x, r.z) + RUNNER_EYE_Y, r.z, p.x, p.y + 1.1, p.z);
  }

  private think(r: Runner, now: number, players: BotPlayer[], exposed: BotPlayer[], byId: Map<number, BotPlayer>, vel: Tracks, fire: Fire) {
    r.look = false;
    r.face = null;
    if (r.st === R_ROAM || r.st === R_LEAVE) {
      for (const p of exposed) if (this.sees(r, p)) return this.hunt(r, p, now);
      if (r.st === R_LEAVE) {
        // Away from whoever is nearest.
        const near = players.reduce<BotPlayer | null>((a, p) => (!a || Math.hypot(p.x - r.x, p.z - r.z) < Math.hypot(a.x - r.x, a.z - r.z) ? p : a), null);
        const away = near ? Math.atan2(r.x - near.x, r.z - near.z) : r.yaw;
        r.tx = r.x + Math.sin(away) * 100;
        r.tz = r.z + Math.cos(away) * 100;
        r.want = RUNNER_TROT;
        return;
      }
      const m = byId.get(r.mark);
      if (!m) return this.set(r, R_LEAVE, now);
      r.tx = m.x;
      r.tz = m.z;
      r.want = Math.hypot(m.x - r.x, m.z - r.z) > 150 ? RUNNER_GALLOP : RUNNER_TROT;
      return;
    }
    const p = byId.get(r.prey);
    if (p && this.sees(r, p)) {
      r.seenAt = now;
      r.px = p.x;
      r.pz = p.z;
    }
    if (!p || now - r.seenAt > LOSE_MS || Math.hypot(r.px - r.x, r.pz - r.z) > LOST_R || now - r.huntAt > GIVE_UP_MS) {
      r.prey = -1;
      return this.set(r, R_LEAVE, now);
    }
    const d = Math.hypot(p.x - r.x, p.z - r.z), sees = r.seenAt === now;
    r.lx = p.x;
    r.ly = p.y + 1.5;
    r.lz = p.z;
    const gun = r.kind === 'armed' && !(r.broken & (1 << RP_CORE));
    if (r.st !== R_CHARGE && r.st !== R_RECOVER && d < CLOSE_R && sees) return this.set(r, R_CHARGE, now);
    if (r.st === R_STALK) {
      if (!gun && now >= r.stalkUntil && sees) return this.set(r, R_CHARGE, now);
      this.stalk(r, p, now, gun);
      if (gun && r.leg?.stare && sees && d < FIRE_R && now - r.stAt > 800) this.set(r, R_AIM, now);
      return;
    }
    if (r.st === R_CHARGE) {
      // Flat out at where they'll be; close in, straight on.
      const v = vel.get(p.id), lead = Math.min(LEAD, d / RUNNER_SPRINT);
      if (d < COMMIT_R) r.committed = true;
      r.tx = r.committed ? r.x + Math.sin(r.yaw) * 50 : p.x + (v?.vx ?? 0) * lead;
      r.tz = r.committed ? r.z + Math.cos(r.yaw) * 50 : p.z + (v?.vz ?? 0) * lead;
      r.want = RUNNER_SPRINT;
      r.look = r.kind === 'plain';
      // Past them (they're behind it), or it's been at it too long: it pulls up.
      const c = Math.cos(r.yaw), s = Math.sin(r.yaw), ahead = (p.x - r.x) * s + (p.z - r.z) * c;
      if ((ahead < -1 && d > 5) || now - r.stAt > CHARGE_MAX_MS) this.set(r, R_RECOVER, now);
      return;
    }
    if (r.st === R_RECOVER) {
      r.want = 0;
      r.face = { x: p.x, z: p.z };
      r.look = true;
      if (now < r.until) return;
      r.charges++;
      if (!gun && r.charges < CHARGES && sees) return this.set(r, R_CHARGE, now);
      r.charges = 0;
      r.stalkUntil = now + pick(STALK_MS) * 0.6;
      return this.set(r, R_STALK, now);
    }
    if (r.st === R_AIM) {
      r.want = 0;
      r.face = { x: p.x, z: p.z };
      r.look = true;
      if (!gun || (!sees && now - r.seenAt > 1500) || d > FIRE_R) return this.set(r, R_STALK, now);
      if (r.raisedAt < 0) r.raisedAt = now;
      if (now - r.raisedAt < RAISE_MS || !sees) {
        r.chargeAt = -1;
        return;
      }
      if (r.chargeAt < 0 && now - r.firedAt >= FIRE_MS - CHARGE_MS) r.chargeAt = now;
      if (r.chargeAt < 0 || now - r.chargeAt < CHARGE_MS) return;
      r.chargeAt = -1;
      r.firedAt = now;
      r.shots++;
      this.fireAt(r, p, fire);
      if (r.shots >= r.shotsWanted) {
        // Off to somewhere else round them, flat out.
        this.set(r, R_STALK, now);
        r.leg = this.arc(r, p, now, [KEEP_MIN, KEEP_MAX]);
      }
    }
  }

  /** A bolt from its muzzle at p's chest. */
  private fireAt(r: Runner, p: BotPlayer, fire: Fire) {
    const a = Math.atan2(p.x - r.x, p.z - r.z);
    const x = r.x + Math.sin(a) * MUZZLE_AHEAD, z = r.z + Math.cos(a) * MUZZLE_AHEAD, y = heightAt(r.x, r.z) + MUZZLE_Y;
    const dx = p.x - x, dy = p.y + 1.1 - y, dz = p.z - z, l = Math.hypot(dx, dy, dz) || 1;
    fire(r, x, y, z, dx / l, dy / l, dz / l);
  }

  /** Stalking: legs round its prey (an arc, a prowl, a stare). */
  private stalk(r: Runner, p: BotPlayer, now: number, gun: boolean) {
    const ring: [number, number] = gun ? [KEEP_MIN, KEEP_MAX] : RING;
    const d = Math.hypot(p.x - r.x, p.z - r.z);
    const leg = r.leg;
    if (leg?.via && Math.hypot(leg.via[0] - r.x, leg.via[1] - r.z) < 6) leg.via = null;
    const done = !leg || now > leg.until || (!leg.stare && Math.hypot(leg.tx - r.x, leg.tz - r.z) < 2.5);
    if (done) {
      const from = Math.atan2(r.x - p.x, r.z - p.z), k = Math.random();
      if (d > ring[1] + 25) {
        // Closing in, to the ring.
        const a = from + rand(-0.5, 0.5), rr = pick(ring);
        r.leg = { tx: p.x + Math.sin(a) * rr, tz: p.z + Math.cos(a) * rr, via: null, want: d > 80 ? RUNNER_SPRINT : RUNNER_GALLOP, stare: false, until: now + 15_000 };
      } else if (gun) {
        // The armed one: a stop to shoot (R_AIM), then off round them to another spot.
        r.leg = leg?.stare ? this.arc(r, p, now, ring) : { tx: r.x, tz: r.z, via: null, want: 0, stare: true, until: now + pick(STARE_MS) };
      } else if (k < 0.4 || (leg?.stare && k < 0.7)) r.leg = this.arc(r, p, now, ring);
      else if (k < 0.7 && !leg?.stare) r.leg = { tx: r.x, tz: r.z, via: null, want: 0, stare: true, until: now + pick(STARE_MS) };
      else {
        // A prowl to a spot not far off, a little in or out.
        const a = from + rand(-0.8, 0.8), rr = pick(ring) * rand(0.8, 1.1);
        r.leg = { tx: p.x + Math.sin(a) * rr, tz: p.z + Math.cos(a) * rr, via: null, want: rand(RUNNER_WALK, RUNNER_TROT), stare: false, until: now + 8000 };
      }
    }
    const l = r.leg!;
    r.tx = l.via ? l.via[0] : l.tx;
    r.tz = l.via ? l.via[1] : l.tz;
    r.want = l.want;
    if (l.stare) {
      r.face = { x: p.x, z: p.z };
      r.look = true;
    }
  }

  /** A sprint round p: a third to two thirds of a lap, either way, out on the ring (by a point halfway round, so it
   *  doesn't cut across them). */
  private arc(r: Runner, p: BotPlayer, now: number, ring: [number, number]): Leg {
    const from = Math.atan2(r.x - p.x, r.z - p.z), turn = (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 3.6), rr = pick(ring);
    const a = from + turn, m = from + turn / 2;
    return {
      tx: p.x + Math.sin(a) * rr, tz: p.z + Math.cos(a) * rr, via: [p.x + Math.sin(m) * rr, p.z + Math.cos(m) * rr],
      want: RUNNER_SPRINT * rand(0.7, 1), stare: false, until: now + 12_000,
    };
  }

  /** Moves it dt (s) towards (tx, tz) at up to `want`, as the gait can show (shared/runner.ts turn rates, speeding up,
   *  braking; slowing to turn when facing away, and to stop at the spot unless charging). */
  private drive(r: Runner, dt: number) {
    if (r.deadAt >= 0) return void (r.v = 0);
    const dx = r.tx - r.x, dz = r.tz - r.z, dist = Math.hypot(dx, dz);
    let target = 0;
    const rate = r.v < 1 ? TURN_STAND : TURN_WALK + (TURN_SPRINT - TURN_WALK) * clamp((r.v - RUNNER_WALK) / (RUNNER_SPRINT - RUNNER_WALK), 0, 1);
    if (r.want > 0 && dist > 0.5) {
      const err = wrap(Math.atan2(dx, dz) - r.yaw);
      r.yaw = wrap(r.yaw + clamp(err, -rate * dt, rate * dt));
      target = r.want * Math.max(0.15, Math.cos(err));
      if (r.st !== R_CHARGE) target = Math.min(target, Math.sqrt(2 * 5 * dist));
    } else if (r.face) {
      const err = wrap(Math.atan2(r.face.x - r.x, r.face.z - r.z) - r.yaw);
      r.yaw = wrap(r.yaw + clamp(err, -rate * dt, rate * dt));
    }
    r.v += clamp(target - r.v, -RUNNER_BRAKE * dt, RUNNER_ACCEL * dt);
    const [x, z] = keepOut(r.x + Math.sin(r.yaw) * r.v * dt, r.z + Math.cos(r.yaw) * r.v * dt, 2);
    r.x = x;
    r.z = z;
  }

  private remember(r: Runner, now: number) {
    r.hist.push(now, r.x, r.z, r.yaw);
    while (r.hist.length > 4 && r.hist[0] < now - HIST_MS - 200) r.hist.splice(0, 4);
  }

  /** Where it was at time t (its history; the oldest before that), into `out`. */
  private at(r: Runner, t: number, out: { x: number; z: number; yaw: number }) {
    const h = r.hist;
    let i = h.length - 4;
    while (i > 0 && h[i] > t) i -= 4;
    if (i + 4 < h.length && h[i] <= t) {
      const k = (t - h[i]) / Math.max(1, h[i + 4] - h[i]);
      out.x = h[i + 1] + (h[i + 5] - h[i + 1]) * k;
      out.z = h[i + 2] + (h[i + 6] - h[i + 2]) * k;
      out.yaw = h[i + 3] + wrap(h[i + 7] - h[i + 3]) * k;
    } else {
      out.x = h[i + 1];
      out.z = h[i + 2];
      out.yaw = h[i + 3];
    }
    return out;
  }

  /** Charging: whoever its jaws (as drawn, BOT_DELAY_MS behind) passed within BITE_R of this tick is bitten. */
  private bite(r: Runner, now: number, dt: number, exposed: BotPlayer[], mauled: number[]) {
    if (now - r.stAt < BOT_DELAY_MS) return;
    const a = this.at(r, now - BOT_DELAY_MS - dt * 1000, _a), b = this.at(r, now - BOT_DELAY_MS, _b);
    const ax = a.x + Math.sin(a.yaw) * JAW_REACH, az = a.z + Math.cos(a.yaw) * JAW_REACH;
    const bx = b.x + Math.sin(b.yaw) * JAW_REACH, bz = b.z + Math.cos(b.yaw) * JAW_REACH;
    const gy = heightAt(bx, bz);
    for (const p of exposed) {
      if (segDist(p.x, p.z, ax, az, bx, bz) > BITE_R || Math.abs(p.y - gy) > 3) continue;
      if (!mauled.includes(p.id)) mauled.push(p.id);
      r.snapAt = now;
    }
    if (r.snapAt === now) this.set(r, R_RECOVER, now);
  }

  /** Its wreck: anyone near its maw wakes it; RUNNER_WAKE_MS after clients see it draw its jaws back (BOT_DELAY_MS
   *  late), they snap shut on whoever is still within WRECK_BITE_R. */
  private wreck(r: Runner, now: number, exposed: BotPlayer[], mauled: number[]) {
    const mx = r.x + Math.sin(r.yaw) * WRECK_MAW, mz = r.z + Math.cos(r.yaw) * WRECK_MAW, gy = heightAt(mx, mz);
    const near = (p: BotPlayer, d: number) => Math.hypot(p.x - mx, p.z - mz) < d && Math.abs(p.y - gy) < 3;
    const snap = r.lungeAt + BOT_DELAY_MS + RUNNER_WAKE_MS;
    if (!r.lunged) {
      if (now < snap) return;
      r.lunged = true;
      for (const p of exposed) if (near(p, WRECK_BITE_R) && !mauled.includes(p.id)) mauled.push(p.id);
      return;
    }
    if (now - r.deadAt < STIR_MS || now < snap + REST_MS) return;
    if (exposed.some((p) => near(p, WAKE_R))) {
      r.lungeAt = now;
      r.lunged = false;
    }
  }

  /** Weak point i's place (world) on r as it was at t. */
  private point(r: Runner, i: number, t: number, out: { x: number; y: number; z: number }) {
    const w = this.at(r, t, _a), q = RUNNER_POINTS[i];
    // The gun's core turns with the gun: on what it looks at, else along its heading.
    const yaw = i === RP_CORE && r.look ? Math.atan2(r.lx - w.x, r.lz - w.z) : w.yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = w.x + q.x * c + q.z * s;
    out.z = w.z - q.x * s + q.z * c;
    out.y = heightAt(w.x, w.z) + RUNNER_BODY_Y + q.y;
    return out;
  }

  /** A shot of `gun` from someone (`by`) ending at (ex, ey, ez) that the client says hit weak point `ri` of runner `id`
   *  (-1: its hull). A weak point hit counts ending near it as drawn lately and takes the gun's damage (all of it from
   *  a gun that kills outright); the hull's plate turns all but the guns that pierce it. Any hit turns it on the shooter.
   *  `seen`: it ended on it (harm or not). */
  shoot(by: BotPlayer, ex: number, ey: number, ez: number, id: unknown, ri: unknown, now: number, gun: Gun): { hit: boolean; kill: RunnerKill | null; seen?: boolean } {
    const miss = { hit: false, kill: null };
    const r = this.runners.find((o) => o.id === id && o.deadAt < 0);
    if (!r || !r.hist.length) return miss;
    if (ri === -1) {
      if (!this.onHull(r, ex, ey, ez, now)) return miss;
      this.provoke(r, by, now);
      if (!bites(gun, ENEMIES.runner.armor, false)) return { ...miss, seen: true };
      r.hull += kills(gun) ? HULL_HP : gun.damage;
      return { hit: true, kill: r.hull >= HULL_HP ? this.die(r, now, by.id) : null, seen: true };
    }
    if (!Number.isInteger(ri) || (ri as number) < 0 || (ri as number) >= RUNNER_POINTS.length) return miss;
    const i = ri as number;
    if ((r.broken & (1 << i)) || (i === RP_CORE && r.kind !== 'armed') || !this.near(r, i, ex, ey, ez, now, i === RP_CORE ? CORE_SLACK : HIT_SLACK)) return miss;
    this.provoke(r, by, now);
    return { hit: true, kill: this.hurt(r, i, kills(gun) ? RUNNER_POINTS[i].hp : gun.damage, now, by.id) };
  }

  /** A blaster's burst at (x, y, z): each whole weak point within `r` m of it, on every live runner, takes `dmg(d)`.
   *  `skip`, `skipPoint`: the one the beam struck itself. */
  burst(by: BotPlayer, x: number, y: number, z: number, rad: number, dmg: (d: number) => number, now: number, skip = -1, skipPoint = -1): { hit: boolean; kills: RunnerKill[] } {
    const out = { hit: false, kills: [] as RunnerKill[] };
    const pt = { x: 0, y: 0, z: 0 };
    for (const r of this.runners) {
      if (r.deadAt >= 0 || !r.hist.length || Math.hypot(r.x - x, r.z - z) > rad + 6) continue;
      for (let i = 0; i < RUNNER_POINTS.length && r.deadAt < 0; i++) {
        if ((r.broken & (1 << i)) || (i === RP_CORE && r.kind !== 'armed') || (r.id === skip && i === skipPoint)) continue;
        const d = Math.hypot(this.point(r, i, now - BOT_DELAY_MS, pt).x - x, pt.y - y, pt.z - z);
        if (d > rad) continue;
        out.hit = true;
        this.provoke(r, by, now);
        const k = this.hurt(r, i, dmg(d), now, by.id);
        if (k) out.kills.push(k);
      }
    }
    return out;
  }

  /** Did (ex, ey, ez) end within `slack` of weak point i, as r was drawn any time lately? */
  private near(r: Runner, i: number, ex: number, ey: number, ez: number, now: number, slack: number): boolean {
    const pt = { x: 0, y: 0, z: 0 };
    for (let t = now - HIST_MS; t <= now; t += 100) {
      this.point(r, i, t, pt);
      if (Math.hypot(pt.x - ex, pt.y - ey, pt.z - ez) < slack) return true;
    }
    return false;
  }

  private onHull(r: Runner, ex: number, ey: number, ez: number, now: number): boolean {
    for (let t = now - HIST_MS; t <= now; t += 100) {
      const w = this.at(r, t, _a), c = Math.cos(w.yaw), s = Math.sin(w.yaw);
      const dx = ex - w.x, dz = ez - w.z, lx = dx * c - dz * s, lz = dx * s + dz * c, up = ey - heightAt(w.x, w.z);
      if (Math.abs(lx) < HULL_X + HULL_SLACK && Math.abs(lz) < HULL_Z + HULL_SLACK && up > -HULL_SLACK && up < HULL_Y + HULL_SLACK + (r.kind === 'armed' ? 2.5 : 0)) return true;
    }
    return false;
  }

  /** Hit: it goes for whoever hit it (the plain one charges them if they're near enough to see). */
  private provoke(r: Runner, by: BotPlayer, now: number) {
    if (!open(by)) return;
    if (r.prey !== by.id || r.st === R_ROAM || r.st === R_LEAVE) this.hunt(r, by, now, 0);
    r.seenAt = now;
    r.px = by.x;
    r.pz = by.z;
  }

  /** Weak point i takes `dmg` rifle hits: broken at its hp; dead with its eyes or both vents broken. */
  private hurt(r: Runner, i: number, dmg: number, now: number, by: number): RunnerKill | null {
    r.hits[i] += dmg;
    if (r.hits[i] < RUNNER_POINTS[i].hp) return null;
    r.broken |= 1 << i;
    if (i === RP_CORE && r.st === R_AIM) this.set(r, R_STALK, now);
    return runnerDead(r.broken) ? this.die(r, now, by) : null;
  }

  private die(r: Runner, now: number, by: number): RunnerKill {
    r.deadAt = now;
    r.st = R_DEAD;
    r.v = 0;
    r.look = false;
    r.raisedAt = r.chargeAt = -1;
    if (!runnerDead(r.broken)) r.broken |= 1 << RP_EYES;
    return { x: r.x, z: r.z, kind: r.kind, by };
  }

  /** The 'bots' `r` for player `id` at (x, z) (shared/runner.ts RUNNER_STRIDE). */
  msg(time: number, id: number, x: number, z: number): number[] {
    const out: number[] = [];
    for (const r of this.runners) {
      if (Math.hypot(r.x - x, r.z - z) > SEND_R) continue;
      const gun = r.st === R_AIM && r.raisedAt >= 0 ? (r.chargeAt >= 0 ? 1 : 0) : -1;
      out.push(r.id, r.kind === 'armed' ? 1 : 0, r2(r.x), r2(r.z), r3(r.yaw), r.st, r.prey < 0 ? 0 : r.prey === id ? 2 : 1,
        r.look ? 1 : 0, r.look ? r2(r.lx) : 0, r.look ? r2(r.ly) : 0, r.look ? r2(r.lz) : 0, gun, r.broken,
        r.deadAt < 0 ? 0 : Math.round((time - r.deadAt) / 100) / 10 + 0.01, Math.round(r.snapAt), Math.round(r.lungeAt));
    }
    return out;
  }
}

/** How far (m) (px, pz) is from the segment (ax, az)–(bx, bz). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

