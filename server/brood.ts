// Spiderlings on the hunt (shared/queen.ts SP_*): the brood queen's (server/queen.ts) and the solar farms' nests
// (server/nests.ts) run the same. They run at whoever is out in the open (spread over everyone), faster than a run,
// the ones on the same person fanning out to come at them from all sides (server/pack.ts); close by they crouch, then
// spring at where their prey will be, taking turns (`turns`) so one leap follows another: a sidestep while one
// crouches, or a slide out of the ring, gets you out of it. A bite is worked out as the drawn spiderling lands
// (`delay`, the client draws bots that far behind). What one does with nobody to go for is its owner's (`idle`).
import { CROUCH_MS, DROP_MS, LEAP_HIT, LEAP_MAX, LEAP_MS, LEAP_R, REST_MS, SP_CROUCH, SP_DIE, SP_DROP, SP_LEAP, SP_PERCH, SP_REST, SP_RUN } from '../shared/queen.ts';
import { heightAt } from '../shared/terrain.ts';
import type { BossPlayer } from './bosses.ts';
import { flank, keepOut, skirt, type Skirt } from './pack.ts';
import type { Tracks } from './tracks.ts';

/** A spiderling: where, which way, state (shared/queen.ts SP_*) since when, its prey (-1 none), born when; crouched
 *  or leaping, where it's springing to (from where); landed, when its bite is worked out (0 done). */
export type Ling = {
  id: number; x: number; z: number; yaw: number; st: number; stAt: number; prey: number; born: number;
  ax: number; az: number; fx: number; fz: number; biteAt: number;
  /** Which way round what's in its way (server/pack.ts). */
  skirt: Skirt;
};

export type Hunt = {
  /** Goes for people within `sight` (m); each one already after someone counts as `share` m more to them, so a crowd
   *  gets spread out; turns at `turn` (rad/s), keeps `gap` (m) from the others running. */
  sight: number; share: number; turn: number; gap: number;
  /** Running speed (m/s). */
  speed: number;
  /** In leaping range, waits its turn: not within `turns` ms of another on the same prey crouching. `wide`: how far
   *  out (m) the pack fans to come at them. */
  turns: number; wide: number;
  /** Its body, for keeping it out of wrecks, scrap and posts (m). */
  r: number;
  /** How far behind (ms) the client draws it. */
  delay: number;
  /** Players' velocities (smoothed), for leading the leaps. */
  vel: Tracks;
  /** Nobody to go for: the heading (rad) and speed (m/s) it takes. */
  idle(l: Ling, now: number): [number, number];
  /** Its landing caught `p` (each player once a tick, `killed` keeps count). */
  bite(l: Ling, p: BossPlayer, y: number): void;
};

export function setLing(l: Ling, s: number, now: number) {
  l.st = s;
  l.stAt = now;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Every spiderling's drop, run, crouch, leap and bite for dt (s); the dead are kept while they curl up (dieMs), the
 *  perched (SP_PERCH) are left as they are. Returns the ones still about. */
export function huntLings(lings: Ling[], h: Hunt, dt: number, now: number, players: BossPlayer[], killed: Set<number>, dieMs: number): Ling[] {
  const chasing = new Map<number, number>();
  for (const l of lings) if (l.prey >= 0 && l.st !== SP_DIE) chasing.set(l.prey, (chasing.get(l.prey) ?? 0) + 1);
  // Who's after whom (by id, for each one's side of them), and when someone's prey last had one crouch at them.
  const packs = new Map<number, number[]>(), pounced = new Map<number, number>();
  for (const l of lings) {
    if (l.prey < 0 || l.st === SP_DIE || l.st === SP_DROP) continue;
    if (l.st === SP_RUN) packs.set(l.prey, [...(packs.get(l.prey) ?? []), l.id]);
    if (l.st === SP_CROUCH || l.st === SP_LEAP) pounced.set(l.prey, Math.max(pounced.get(l.prey) ?? 0, l.stAt));
  }
  const out = lings.filter((l) => {
    const since = now - l.stAt;
    if (l.st === SP_PERCH) return true;
    if (l.st === SP_DIE) return since < dieMs;
    if (l.st === SP_DROP) {
      if (since >= DROP_MS) setLing(l, SP_RUN, now);
      return true;
    }
    if (l.st === SP_RUN) {
      let p = l.prey >= 0 ? players.find((o) => o.id === l.prey) : undefined;
      if (!p || p.safe || Math.hypot(p.x - l.x, p.z - l.z) > h.sight) {
        // Someone else: the nearest, counting those already chased as further.
        if (l.prey >= 0) chasing.set(l.prey, (chasing.get(l.prey) ?? 1) - 1);
        l.prey = -1;
        p = undefined;
        let best = Infinity;
        for (const o of players) {
          const d = Math.hypot(o.x - l.x, o.z - l.z);
          if (o.safe || d > h.sight) continue;
          const cost = d + h.share * (chasing.get(o.id) ?? 0);
          if (cost < best) (best = cost), (p = o);
        }
        if (p) {
          l.prey = p.id;
          chasing.set(p.id, (chasing.get(p.id) ?? 0) + 1);
        }
      }
      let want: number, heading: number;
      if (p) {
        const d = Math.hypot(p.x - l.x, p.z - l.z);
        // Where they'll be when it lands (as they see it: drawn `delay` late). In reach of that (or right on them):
        // crouch, aimed there. So walking away only puts it off; a sprint, or a sidestep as it crouches, doesn't.
        const v = h.vel.get(p.id), lead = (CROUCH_MS + LEAP_MS + h.delay) / 1000;
        const ax = p.x + (v ? v.vx * lead : 0) - l.x, az = p.z + (v ? v.vz * lead : 0) - l.z, len = Math.hypot(ax, az);
        const waiting = d >= LEAP_R && now - (pounced.get(p.id) ?? -Infinity) < h.turns;
        if ((len <= LEAP_MAX || d < LEAP_R) && !waiting) {
          const k = Math.min(1, LEAP_MAX / Math.max(len, 1e-3));
          l.fx = l.x;
          l.fz = l.z;
          l.ax = l.x + ax * k;
          l.az = l.z + az * k;
          if (len > 0.1) l.yaw = Math.atan2(ax, az);
          setLing(l, SP_CROUCH, now);
          pounced.set(p.id, now);
          return true;
        }
        if (len <= LEAP_MAX + 2) {
          // Another's turn to spring: round them at leaping range, ready.
          const ccw = l.id % 2 ? 1 : -1;
          heading = Math.atan2(l.x - p.x, l.z - p.z) + ccw * (Math.PI / 2 + (d - LEAP_MAX * 0.8) * 0.15);
          want = h.speed * 0.8;
        } else {
          // Heading them off, each from its own side (server/pack.ts), zigzagging in further off.
          const pack = packs.get(p.id) ?? [l.id];
          const [tx, tz] = flank(l.x, l.z, p.x, p.z, v?.vx ?? 0, v?.vz ?? 0, h.speed, Math.max(0, pack.indexOf(l.id)), pack.length, h.wide);
          heading = Math.atan2(tx - l.x, tz - l.z);
          if (d > 14) heading += Math.sin(now * 0.006 + l.id * 1.7) * 0.25;
          want = h.speed;
        }
      } else [heading, want] = h.idle(l, now);
      // Round wrecks, scrap and posts, not through them.
      heading = skirt(l.x, l.z, heading, h.r, l.skirt, now);
      l.yaw = wrap(l.yaw + Math.max(-h.turn * dt, Math.min(h.turn * dt, wrap(heading - l.yaw))));
      [l.x, l.z] = keepOut(l.x + Math.sin(l.yaw) * want * dt, l.z + Math.cos(l.yaw) * want * dt, h.r);
      return true;
    }
    if (l.st === SP_CROUCH) {
      if (since >= CROUCH_MS) setLing(l, SP_LEAP, now);
      return true;
    }
    if (l.st === SP_LEAP) {
      const t = Math.min(1, since / LEAP_MS);
      l.x = l.fx + (l.ax - l.fx) * t;
      l.z = l.fz + (l.az - l.fz) * t;
      if (t >= 1) {
        setLing(l, SP_REST, now);
        l.biteAt = now + h.delay;
      }
      return true;
    }
    // Landed: the bite as the drawn one comes down, then up and after them again.
    if (l.biteAt && now >= l.biteAt) {
      l.biteAt = 0;
      const y = heightAt(l.x, l.z);
      for (const p of players) {
        if (p.safe || killed.has(p.id) || Math.hypot(p.x - l.x, p.z - l.z) > LEAP_HIT || Math.abs(p.y - y) > 2.5) continue;
        killed.add(p.id);
        h.bite(l, p, y);
      }
    }
    if (since >= REST_MS) setLing(l, SP_RUN, now);
    return true;
  });

  // Running ones keep a little apart.
  const run = out.filter((l) => l.st === SP_RUN);
  for (let i = 0; i < run.length; i++) {
    for (let j = i + 1; j < run.length; j++) {
      const a = run[i], c = run[j], dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
      if (d >= h.gap || d < 1e-4) continue;
      const k = (h.gap - d) / d / 2;
      a.x -= dx * k;
      a.z -= dz * k;
      c.x += dx * k;
      c.z += dz * k;
    }
  }
  return out;
}
