// The cart (docs/cart.md): a two-wheeled scrap trailer every player has, towed behind their bike, a vehicle kind
// (shared/vehicles.ts, GEAR.cart) with no part slots. Its level (docs/cart.md "Levels") is its item's own state
// (ItemData.level, in its box veh<id>); its box is its cargo grid cargo<id> (chest size), shared by everyone, opened with
// F on the parked cart anywhere but its tongue. Only its owner tows it.
//
// Towing is in shared/sim.ts (deterministic): PlayerState.tow is the cart being towed (0 none) and PlayerState.hitch
// its heading. Everything else about where it is comes from those and the bike's pose, here: the hitch point H is
// HITCH_BACK behind the bike's centre; the axle sits TOW_LENGTH behind H along the cart's heading. Each tick the axle
// follows H (towHitch), the angle to the bike clamped at HITCH_MAX. The model (public/models/cart.glb, or the stand-in
// built in src/world/carts.ts): origin on the ground under the axle's middle, forward -z, the coupler TOW_LENGTH ahead.
import { EYE_HEIGHT } from './dig.ts';
import type { ItemData } from './items.ts';
import { inReach, parked, type Vehicle } from './vehicles.ts';

/** The cart's GEAR / item / vehicle kind. */
export const CART = 'cart';
/** From the axle to the coupler at the tongue's tip (m): the 2.2 m bed's front half and the 1.3 m tongue. */
export const TOW_LENGTH = 2.4;
/** The hitch point (the bike's tow ball) behind the bike's centre (m): past the rear tyre (the wheelbase is 1.36 m). */
export const HITCH_BACK = 0.95;
/** The most the cart may swing off the bike's line (rad, ~100°): no jackknife past it. */
export const HITCH_MAX = (100 * Math.PI) / 180;
/** Backing up: the bike's hitch point this close to your own parked cart's coupler (m) hitches it… */
export const HITCH_REACH = 0.8;
/** …going backwards at least this fast (m/s; standing still beside it, as after getting on, doesn't)… */
export const HITCH_MIN_BACK = 0.3;
/** …and no faster than this (m/s). */
export const HITCH_MAX_SPEED = 3;
/** F on the tongue: the eye's ray within this far of the coupler's middle, the feet within UNHITCH_REACH of it (m). */
export const UNHITCH_REACH = 2.5;
/** Its wheels' radius (m), and the half track (the wheels' middles off the centre line). */
export const CART_WHEEL_R = 0.36;
export const CART_HALF_TRACK = 0.6;
/** Half the bed's length (m) and its half width, and the height of the box on it, for aiming. */
const BED_HALF = 1.1;
const BED_HX = 0.78;
const BED_Y1 = 1.35;
/** The tongue's aim box: half width and height. */
const TONGUE_HX = 0.3;
const TONGUE_Y1 = 0.95;
/** The eye reaches this far along the crosshair (m), as for the bike. */
const AIM_REACH = 3.5;

/** The level's pieces (docs/cart.md "The model's contract"): drawn only once the cart's level is this or more. */
export const CART_LEVEL_NODES: Record<string, number> = {
  pole_a: 1, pole_b: 1, pole_a_tip: 1, pole_b_tip: 1, legs: 1,
  side_l: 2, side_r: 2, leg_l: 2, leg_r: 2,
};

export const isCart = (v: { kind: string } | null | undefined) => v?.kind === CART;

/** A cart item's level (ItemData.level), 0 when it isn't set. */
export const cartLevel = (it: { data?: ItemData } | null | undefined) => it?.data?.level ?? 0;

type XZ = { x: number; z: number };
type Pose = { x: number; z: number; heading: number };

/** The angle in (-π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The hitch point of a bike at (x, z) heading `heading`: HITCH_BACK behind its centre. */
export function hitchPoint(x: number, z: number, heading: number): XZ {
  return { x: x + Math.sin(heading) * HITCH_BACK, z: z + Math.cos(heading) * HITCH_BACK };
}

/** The axle (the cart's origin) of a cart heading `hitch` on a bike at (x, z) heading `heading`. */
export function cartAxle(x: number, z: number, heading: number, hitch: number): XZ {
  const h = hitchPoint(x, z, heading);
  return { x: h.x + Math.sin(hitch) * TOW_LENGTH, z: h.z + Math.cos(hitch) * TOW_LENGTH };
}

/** Where a towing player's cart is (`s`: their state, tow and hitch set): its axle and heading. */
export function towedPose(s: { x: number; z: number; heading: number; hitch: number }): Pose {
  const a = cartAxle(s.x, s.z, s.heading, s.hitch);
  return { x: a.x, z: a.z, heading: s.hitch };
}

/** A cart standing at `v` (its axle, heading): its coupler. */
export function couplerOf(v: Pose): XZ {
  return { x: v.x - Math.sin(v.heading) * TOW_LENGTH, z: v.z - Math.cos(v.heading) * TOW_LENGTH };
}

/** The heading a cart with its axle at `axle` has hitched to the hitch point `h`, clamped to HITCH_MAX off `heading`
 *  (the bike's). The axle follows H: the new axle is H − TOW_LENGTH · unit(H − old axle). */
function follow(axle: XZ, h: XZ, heading: number, old: number): number {
  const dx = h.x - axle.x, dz = h.z - axle.z;
  if (dx * dx + dz * dz < 1e-12) return old;
  const c = Math.atan2(-dx, -dz); // forward is (-sin, -cos)
  const rel = wrap(c - heading);
  return wrap(heading + Math.max(-HITCH_MAX, Math.min(HITCH_MAX, rel)));
}

/** One tick of towing (shared/sim.ts stepBike): the cart's new heading after the bike moved from (x0, z0, h0) to
 *  (x, z, h), the cart heading `hitch` before. Reversing pushes it the same way (it swings off, up to HITCH_MAX). */
export function towHitch(x0: number, z0: number, h0: number, hitch: number, x: number, z: number, h: number): number {
  return follow(cartAxle(x0, z0, h0, hitch), hitchPoint(x, z, h), h, hitch);
}

/** Hitching (server/vehicles.ts): the heading a cart standing at `v` takes on the bike at `s`, its axle staying where it
 *  is; null if it would be past HITCH_MAX off the bike's line. */
export function hitchHeading(s: { x: number; z: number; heading: number }, v: Pose): number | null {
  const h = hitchPoint(s.x, s.z, s.heading);
  const dx = h.x - v.x, dz = h.z - v.z;
  const c = Math.atan2(-dx, -dz);
  return Math.abs(wrap(c - s.heading)) <= HITCH_MAX ? c : null;
}

/** Is the bike at `s` (riding, its velocity) backing its hitch point up to the coupler of cart `v`, slowly enough? */
export function backingUpTo(s: { x: number; y: number; z: number; vx: number; vz: number; heading: number }, v: Vehicle): boolean {
  const vf = -s.vx * Math.sin(s.heading) - s.vz * Math.cos(s.heading);
  if (vf > -HITCH_MIN_BACK || Math.hypot(s.vx, s.vz) > HITCH_MAX_SPEED || Math.abs(s.y - v.y) > 1.2) return false;
  const h = hitchPoint(s.x, s.z, s.heading), c = couplerOf(v);
  return Math.hypot(h.x - c.x, h.z - c.z) < HITCH_REACH;
}

/** Feet at `s` within reach of cart `v`'s tongue (its coupler), with `slack` m more. */
export function atTongue(s: { x: number; y: number; z: number }, v: Vehicle, slack = 0): boolean {
  const c = couplerOf(v);
  return Math.hypot(s.x - c.x, s.z - c.z) < UNHITCH_REACH + slack && Math.abs(s.y - v.y) < 2 + slack;
}

/**
 * The parked cart under the crosshair for a player looking along (yaw, pitch) from `feet`, and whether the crosshair is
 * on its tongue, or null. Only one in reach (shared/vehicles.ts inReach), as its box opens.
 */
export function cartTarget(feet: { x: number; y: number; z: number }, yaw: number, pitch: number, list: Vehicle[]):
  { v: Vehicle; tongue: boolean } | null {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
  const ex = feet.x, ey = feet.y + EYE_HEIGHT, ez = feet.z;
  let best: { v: Vehicle; tongue: boolean } | null = null, bestT = AIM_REACH;
  for (const v of list) {
    if (!isCart(v) || !parked(v) || !inReach(feet, v)) continue;
    // Into its frame: x to its right, z backwards (its forward is -z), y up from the ground under it.
    const rx = Math.cos(v.heading), rz = -Math.sin(v.heading), bx = Math.sin(v.heading), bz = Math.cos(v.heading);
    const ox = ex - v.x, oz = ez - v.z;
    const o = [ox * rx + oz * rz, ey - v.y, ox * bx + oz * bz];
    const d = [dx * rx + dz * rz, dy, dx * bx + dz * bz];
    for (const [tongue, lo, hi] of [
      [false, [-BED_HX, 0, -BED_HALF], [BED_HX, BED_Y1, BED_HALF]],
      [true, [-TONGUE_HX, 0, -TOW_LENGTH - 0.2], [TONGUE_HX, TONGUE_Y1, -BED_HALF]],
    ] as [boolean, number[], number[]][]) {
      const t = hit(o, d, lo, hi);
      if (t === null || t >= bestT) continue;
      bestT = t;
      best = { v, tongue };
    }
  }
  return best;
}

/** Where the ray o + t·d first enters the box lo..hi (t ≥ 0), or null. */
function hit(o: number[], d: number[], lo: number[], hi: number[]): number | null {
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    const a = (lo[k] - o[k]) / d[k], c = (hi[k] - o[k]) / d[k];
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t0 > t1 ? null : t0;
}
