// The solar farms' nests (shared/nest.ts): out when someone comes near a farm (NEAR_R), every spiderling on its perch;
// gone when everyone has left it (LEAVE_R), and a farm left comes back with the ones it had then until PACK_BACK_S is
// up, like a crash site's crawlers. Perched ones wake when someone out in the open comes within WAKE_R, and wake their
// neighbours (CHAIN_R) a moment later, so they come down off the mirrors in a wave; someone in among the nest's mirrors
// sets off the lot (WAVE_MS); awake, they hunt as the queen's
// brood does (server/brood.ts), and with nobody to go for mill about under the mirrors by the tower. Ticked by
// server/guardians.ts (their bites are its `bitten`), sent in its 'bots' (`n`).
import { BITE_DAMAGE } from '../shared/guardians.ts';
import { bites, type Gun, kills } from '../shared/rifle.ts';
import { ENEMIES, PACK_BACK_S } from '../shared/enemies.ts';
import {
  CHAIN_MS, CHAIN_R, NEST_DAMAGE, NEST_HP, NEST_N, NEST_R, NEST_SPEED, nestPerches, WAKE_MS, WAKE_R, WAVE_MS, type Perch,
} from '../shared/nest.ts';
import { DIE_MS, SP_BODY_Y, SP_DIE, SP_DROP, SP_PERCH } from '../shared/queen.ts';
import { solarFarmsNear, type SolarFarm } from '../shared/solarfarms.ts';
import { heightAt } from '../shared/terrain.ts';
import { huntLings, setLing, type Hunt, type Ling } from './brood.ts';
import type { BotPlayer } from './bots.ts';
import { keepOut } from './pack.ts';
import type { Tracks } from './tracks.ts';

/** A nest comes out with someone this near its farm's tower (m), and goes with nobody within LEAVE_R. */
export const NEAR_R = 480, LEAVE_R = 650;
/** Sent to whoever is within SEND_R (m). */
const SEND_R = 400;
/** A shot ending this close (m, flat) to one hits it (it's drawn a little behind, running: some slack). */
const HIT_R = 4;
/** The client draws bots this far (ms) behind (src/world/botFrames.ts BOT_DELAY_MS). */
const DRAW_DELAY = 250;
/** How they hunt (server/brood.ts Hunt): a little less keen than the queen's, more of them. */
const SIGHT = 130, SHARE = 10, TURN = 8, GAP = 1.5, TURNS = 650, WIDE = 10, BODY_R = 0.5;

/** What a hit did: landed, and killed one (where, for its drops). */
export type Strike = { hit: boolean; kill: { x: number; z: number } | null };
const MISS: Strike = { hit: false, kill: null };

/** Its perch (shared/nest.ts nestPerches), when it should wake (0 not yet), and whether it died on the perch (it falls). */
type NestLing = Ling & { hp: number; perch: number; wakeAt: number; fell: boolean };
type Nest = { farm: SolarFarm; perches: Perch[]; lings: NestLing[] };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (v: number) => Math.round(v * 100) / 100;

export class NestServer {
  private nests = new Map<number, Nest>();
  /** Farm id → when everyone left it and how many were alive then. */
  private left = new Map<number, { at: number; alive: number }>();
  private nextId = 1;

  /** The nests out right now (tests). */
  get all(): readonly { farm: SolarFarm; lings: readonly { id: number; x: number; z: number; st: number; hp: number; perch: number }[] }[] {
    return [...this.nests.values()];
  }

  /** Advance by dt (s): nests out and gone, perched ones waking, the awake hunting `exposed` (out in the open);
   *  who's bitten goes into `bitten` (player id → damage). */
  tick(dt: number, now: number, players: BotPlayer[], exposed: BotPlayer[], bitten: Map<number, number>, vel: Tracks) {
    this.comeAndGo(players, now);
    for (const n of this.nests.values()) {
      this.wake(n, now, exposed);
      const f = n.farm;
      const hunt: Hunt = {
        sight: SIGHT, share: SHARE, turn: TURN, gap: GAP, speed: NEST_SPEED, turns: TURNS, wide: WIDE, r: BODY_R, delay: DRAW_DELAY, vel,
        // Nobody: back in under the mirrors by the tower, milling about there.
        idle: (l) => {
          const d = Math.hypot(f.x - l.x, f.z - l.z);
          if (d > NEST_R + 15) return [Math.atan2(f.x - l.x, f.z - l.z), 3];
          return [l.yaw + Math.sin(now * 0.002 + l.id) * 1.5, d < 14 ? 2.5 : 1.2];
        },
        bite: (_l, p) => bitten.set(p.id, BITE_DAMAGE),
      };
      n.lings = huntLings(n.lings, hunt, dt, now, exposed, new Set(bitten.keys()), DIE_MS) as NestLing[];
    }
  }

  private comeAndGo(players: BotPlayer[], now: number) {
    for (const [id, n] of this.nests) {
      if (players.some((p) => Math.hypot(p.x - n.farm.x, p.z - n.farm.z) < LEAVE_R)) continue;
      this.nests.delete(id);
      this.left.set(id, { at: now, alive: n.lings.filter((l) => l.st !== SP_DIE).length });
    }
    for (const [id, l] of this.left) if (now - l.at >= PACK_BACK_S * 1000) this.left.delete(id);
    for (const p of players) for (const farm of solarFarmsNear(p.x, p.z, NEAR_R)) {
      if (this.nests.has(farm.id)) continue;
      const alive = this.left.get(farm.id)?.alive ?? NEST_N;
      this.left.delete(farm.id);
      const perches = nestPerches(farm), lings: NestLing[] = [];
      for (let i = 0; i < Math.min(alive, perches.length); i++) {
        const q = perches[i];
        lings.push({
          id: this.nextId++, x: q.lx, z: q.lz, yaw: q.yaw, st: SP_PERCH, stAt: now, prey: -1, born: now,
          ax: q.lx, az: q.lz, fx: q.lx, fz: q.lz, biteAt: 0, skirt: { side: 0, until: 0 }, hp: NEST_HP, perch: i, wakeAt: 0, fell: false,
        });
      }
      this.nests.set(farm.id, { farm, perches, lings });
    }
  }

  /** Perched ones with someone near wake (a moment later), dropping off their mirror; each one dropping wakes those
   *  perched near it a little later still. */
  private wake(n: Nest, now: number, exposed: BotPlayer[]) {
    const f = n.farm, inside = exposed.find((p) => Math.hypot(p.x - f.x, p.z - f.z) < NEST_R);
    for (const l of n.lings) {
      if (l.st === SP_PERCH && inside && !l.wakeAt) {
        const q = n.perches[l.perch];
        l.wakeAt = now + Math.hypot(q.x - inside.x, q.z - inside.z) * WAVE_MS + rand(0, WAKE_MS);
      }
    }
    for (const l of n.lings) {
      if (l.st !== SP_PERCH) continue;
      const q = n.perches[l.perch];
      if (!l.wakeAt && exposed.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < WAKE_R)) l.wakeAt = now + rand(0, WAKE_MS);
      if (l.wakeAt && now >= l.wakeAt) this.drop(n, l, now);
    }
  }

  private drop(n: Nest, l: NestLing, now: number) {
    const q = n.perches[l.perch];
    [l.x, l.z] = keepOut(q.lx, q.lz, BODY_R);
    setLing(l, SP_DROP, now);
    for (const o of n.lings) {
      if (o.st !== SP_PERCH || o.wakeAt) continue;
      const p = n.perches[o.perch];
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < CHAIN_R) o.wakeAt = now + rand(250, CHAIN_MS);
    }
  }

  /** A shot of `gun` (shared/rifle.ts GUNS) ending at (ex, ey, ez), aimed at spiderling `id`: plausible (ending near
   *  it), it takes the gun's damage (nestDamage). Killed: where, for its drops. */
  shoot(ex: number, ey: number, ez: number, id: unknown, now: number, gun: Gun): Strike {
    const f = this.find(id);
    if (!f) return MISS;
    const [x, y, z] = f.at;
    if (Math.hypot(ex - x, ez - z) > HIT_R || Math.abs(ey - y) > 7) return MISS;
    return this.strike(f.n, f.l, nestDamage(gun), now);
  }

  /** A blaster's burst at (x, y, z): every live spiderling within `r` m (of its body) takes `dmg(d)` (NEST_DAMAGE's
   *  units). `skip`: the one the beam struck itself. Returns the kills, and how many it hurt. */
  burst(x: number, y: number, z: number, r: number, dmg: (d: number) => number, now: number, skip = -1): { n: number; kills: { x: number; z: number }[] } {
    const out = { n: 0, kills: [] as { x: number; z: number }[] };
    for (const n of this.nests.values()) {
      if (Math.hypot(n.farm.x - x, n.farm.z - z) > NEST_R + LEAVE_R) continue;
      for (const l of n.lings) {
        if (l.st === SP_DIE || l.id === skip) continue;
        const q = l.st === SP_PERCH ? n.perches[l.perch] : null;
        const [lx, ly, lz] = q ? [q.x, q.y - SP_BODY_Y, q.z] : [l.x, heightAt(l.x, l.z), l.z];
        const d = Math.hypot(lx - x, ly + SP_BODY_Y - y, lz - z);
        if (d > r) continue;
        const s = this.strike(n, l, dmg(d), now);
        out.n++;
        if (s.kill) out.kills.push(s.kill);
      }
    }
    return out;
  }

  /** A blow of the scrap mace by someone at `by` (feet) on spiderling `id`: in reach (`reach` m of their eye, its
   *  body as it is: one up on its mirror is out of reach), it takes the mace's damage (NEST_DAMAGE). */
  smash(by: { x: number; y: number; z: number }, id: unknown, reach: number, now: number): Strike {
    const f = this.find(id);
    if (!f) return MISS;
    const [x, y, z] = f.at;
    if (Math.hypot(x - by.x, y + SP_BODY_Y - (by.y + 1.6), z - by.z) > reach) return MISS;
    return this.strike(f.n, f.l, NEST_DAMAGE.mace, now);
  }

  /** Live spiderling `id`, its nest and where it is (its perch, or its feet on the sand). */
  private find(id: unknown): { n: Nest; l: NestLing; at: [number, number, number] } | null {
    if (typeof id !== 'number') return null;
    for (const n of this.nests.values()) {
      const l = n.lings.find((o) => o.id === id && o.st !== SP_DIE);
      if (!l) continue;
      const q = l.st === SP_PERCH ? n.perches[l.perch] : null;
      return { n, l, at: q ? [q.x, q.y - SP_BODY_Y, q.z] : [l.x, heightAt(l.x, l.z), l.z] };
    }
    return null;
  }

  /** `dmg` off l: none left, it dies (on its perch, it falls off as it curls up); hit on its perch and still alive, it
   *  drops at once. */
  private strike(n: Nest, l: NestLing, dmg: number, now: number): Strike {
    l.hp -= dmg;
    const q = l.st === SP_PERCH ? n.perches[l.perch] : null;
    if (l.hp > 0) {
      if (q) this.drop(n, l, now);
      return { hit: true, kill: null };
    }
    l.biteAt = 0;
    // Off its perch, it falls where it would have dropped and curls up there.
    if (q) [l.x, l.z, l.fell] = [q.lx, q.lz, true];
    setLing(l, SP_DIE, now);
    return { hit: true, kill: { x: l.x, z: l.z } };
  }

  /** The 'bots' `n` for someone at (x, z) (shared/nest.ts NEST_STRIDE). */
  msg(x: number, z: number): number[] {
    const out: number[] = [];
    for (const n of this.nests.values()) {
      if (Math.hypot(n.farm.x - x, n.farm.z - z) > SEND_R + NEST_R) continue;
      for (const l of n.lings) {
        if (Math.hypot(l.x - x, l.z - z) > SEND_R) continue;
        const onIt = l.st === SP_PERCH || l.st === SP_DROP || (l.st === SP_DIE && l.fell);
        out.push(l.id, r2(l.x), r2(l.z), Math.round(l.yaw * 1000) / 1000, l.st, Math.round(l.stAt), onIt ? l.perch : -1);
      }
    }
    return out;
  }
}

/** A hit of `gun` on a spiderling, in NEST_HP: its own weapon's (NEST_DAMAGE), else the gun's; all of it from a gun that
 *  kills outright. */
export function nestDamage(gun: Gun): number {
  if (!bites(gun, ENEMIES.spiderling.armor, false)) return 0;
  return kills(gun) ? NEST_HP : ((NEST_DAMAGE as Record<string, number>)[gun.push] ?? gun.damage);
}
