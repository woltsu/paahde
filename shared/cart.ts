// The cart (docs/cart.md): a two-wheeled scrap trailer, one per world and everyone's, towed behind anyone's bike or quad,
// a vehicle kind (shared/vehicles.ts, GEAR.cart) with no part slots. Its level (docs/cart.md "Levels") is its item's own
// state (ItemData.level, in its box veh<id>); its box is its cargo grid cargo<id> (chest size), opened with F on the
// parked cart anywhere but its tongue.
//
// Towing is in shared/sim.ts (deterministic): PlayerState.tow is the cart being towed (0 none) and PlayerState.hitch
// its heading. Everything else about where it is comes from those and the bike's pose, here: the hitch point H is
// HITCH_BACK behind the bike's centre; the axle sits TOW_LENGTH behind H along the cart's heading. Each tick the axle
// follows H (towHitch), the angle to the bike clamped at HITCH_MAX. The model (public/models/cart.glb, or the stand-in
// built in src/world/carts.ts): origin on the ground under the axle's middle, forward -z, the coupler TOW_LENGTH ahead.
//
// Parked, a cart is solid (setCarts: capsules for the bed and its box, the fold-out sides; shared/capsules.ts), and
// anyone unfolds it where the sand is level enough (unfoldError): its level's pieces out, the cart levelled on its
// stabilisers at its own height (v.y). From level 1 it puts up a canopy between its poles' tips (canopyRig), a tarp
// rig (shared/tarp.ts), so its shade, the solid canvas and the billow are the tarp's. Both come from the vehicles list
// only (setVehicles calls setCarts), so the server and every client have the same.
import { setCartCapsules, type Capsule } from './capsules.ts';
import { EYE_HEIGHT } from './dig.ts';
import type { ItemData } from './items.ts';
import { rigFrame, setCanopyRigs, type TarpRig, type Vec } from './tarp.ts';
import { heightAt } from './terrain.ts';
import { inReach, parked, type Vehicle } from './vehicles.ts';

/** The cart's GEAR / item / vehicle kind. */
export const CART = 'cart';
/** From the axle to the coupler at the tongue's tip (m): the 2.2 m bed's front half and the 1.3 m tongue. */
export const TOW_LENGTH = 2.4;
/** The hitch point (the bike's tow ball) behind the bike's centre (m): clear of the rear tyre (the wheelbase is 1.36 m,
 *  the tyre's radius 0.37, so its back is 1.05 behind the centre). */
export const HITCH_BACK = 1.15;
/** The tow ball's height in the bike's frame (m), the cart's coupler's (docs/cart.md: `coupler` at y 0.54), so the cart
 *  stands level behind a level bike. src/bike.ts draws the ball there and poses the cart from it. */
export const HITCH_Y = 0.54;
/** The coupler in the cart's frame (the model's `coupler` node, docs/cart.md). */
export const COUPLER_Y = 0.54;
/** The most the cart may swing off the bike's line (rad, ~100°): no jackknife past it. */
export const HITCH_MAX = (100 * Math.PI) / 180;
/** Backing up: the bike's hitch point this close to a parked cart's coupler (m) hitches it… */
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
  pole_a: 1, pole_b: 1, pole_a_top: 1, pole_b_top: 1, pole_a_tip: 1, pole_b_tip: 1, legs: 1,
  side_l: 2, side_r: 2, leaf_l: 2, leaf_r: 2, leg_l: 2, leg_r: 2, lamp_a: 2, lamp_b: 2, lamp_a_bulb: 2, lamp_b_bulb: 2,
};

export const isCart = (v: { kind: string } | null | undefined) => v?.kind === CART;

/** The highest level (docs/cart.md "Levels"): 1 shade, 2 workshop. */
export const CART_MAX_LEVEL = 2;
/** Unfolding or packing takes this long (s), drawn (src/world/carts.ts) and heard (src/cartSound.ts). */
export const UNFOLD_S = 1.5;
/** Unfolding needs sand this level: the most it may rise across the unfolded footprint (m). */
export const CART_TILT = 0.4;
/** The unfolded footprint's half width (the benches' outer edges, their leaves out) and half length (the bed's ends), m. */
const OPEN_HX = 1.88, OPEN_HZ = 1.15;

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

/** Cart space (x to its right, z backwards, its forward is −z: the model's) to world, for a cart standing at `v`. Matches
 *  three.js's rotation.y = heading. */
export function cartToWorld(v: Pose, lx: number, lz: number): XZ {
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  return { x: v.x + lx * c + lz * s, z: v.z - lx * s + lz * c };
}

/** Why cart `v` (parked, someone by it: server/vehicles.ts unfold) can't unfold, or null: not while it's linked to a
 *  bike, nor on sand rising more than CART_TILT across its unfolded footprint. */
export function unfoldError(v: Vehicle, ground: (x: number, z: number) => number = heightAt): 'hitched' | 'steep' | null {
  if (v.hitched !== undefined) return 'hitched';
  let lo = Infinity, hi = -Infinity;
  for (const [lx, lz] of [[0, 0], [-OPEN_HX, -OPEN_HZ], [OPEN_HX, -OPEN_HZ], [-OPEN_HX, OPEN_HZ], [OPEN_HX, OPEN_HZ], [0, -TOW_LENGTH]]) {
    const p = cartToWorld(v, lx, lz), h = ground(p.x, p.z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo > CART_TILT ? 'steep' : null;
}

// ---- The canopy (level 1) ---------------------------------------------------------------------------------------------

/** The rear right pole's tip unfolded (pole_b_tip, cart space, docs/cart.md: the poles raked out past the deck's ends,
 *  their top sections run out); the front left one's is it turned half round the axle. The canvas's corner is tied this
 *  far under it (m). */
export const POLE_TIP = { x: 1.3, y: 3.66, z: 2.4 };
const TIE = 0.06;
/** The low corners: the rear left one (the front right one is it turned half round) out past the workbench's side, at
 *  this height (m, over a head: you walk in under it from anywhere), each held by a line to a stake STAKE_OUT further out
 *  along the same line from the middle; each pole's tip by a line to a stake TIP_OUT beyond it. */
const LOW = { x: -3.8, y: 2.4, z: 0.7 }, STAKE_OUT = 1.2, TIP_OUT = 1.6;
/** It's pulled tight: it sags less than a tarp (m). */
const CANOPY_SAG = 0.07;
/** The canvas rolled up and strapped on the deck behind the box while it's packed (cart space: its middle, its half
 *  length across the deck, its radius), where code draws it (src/world/carts.ts). */
export const CANOPY_ROLL = { y: 0.97, z: 0.8, half: 0.44, r: 0.075 };

/** A canopy rig of cart `v` from its two high ties `ta` (front left) and `tb` (rear right) (world), its low corners at
 *  `spread` (0: folded in along the line between the ties, 1: out where they're staked) and its sag. */
function canopyFrom(v: Vehicle, ta: Vec, tb: Vec, spread: number, sag: number): TarpRig {
  const low = cartToWorld(v, LOW.x, LOW.z);
  const cx = (ta.x + tb.x) / 2, cz = (ta.z + tb.z) / 2, ax = (tb.x - ta.x) / 2, az = (tb.z - ta.z) / 2;
  // Folded in: a hand's width across the line between the ties, on the low corner's side.
  const bfx = low.x - v.x, bfz = low.z - v.z, la = Math.hypot(ax, az) || 1;
  let px = -az / la, pz = ax / la;
  if (px * bfx + pz * bfz < 0) (px = -px), (pz = -pz);
  const bx = px * 0.12 + (bfx - px * 0.12) * spread, bz = pz * 0.12 + (bfz - pz * 0.12) * spread;
  const f = rigFrame(cx, cz, ax, az, bx, bz, sag);
  const at = (a: number, b: number, y: number): Vec => ({ x: f.cx + a * f.ax + b * f.bx, y, z: f.cz + a * f.az + b * f.bz });
  const lowY = (ta.y + tb.y) / 2 + (v.y + LOW.y - (ta.y + tb.y) / 2) * spread;
  const corners = [at(-1, 0, ta.y), at(0, -1, lowY), at(0, 1, lowY), at(1, 0, tb.y)];
  // The lines (always the finished rig's stakes): the low corners', then the poles' tips'.
  const blen = Math.hypot(bfx, bfz), alen = Math.hypot(POLE_TIP.x, POLE_TIP.z);
  const stake = (lx: number, lz: number) => {
    const p = cartToWorld(v, lx, lz);
    return { x: p.x, y: heightAt(p.x, p.z), z: p.z };
  };
  const kb = 1 + STAKE_OUT / blen, ka = 1 + TIP_OUT / alen;
  const guys = [
    { from: corners[1], stake: stake(-LOW.x * kb, -LOW.z * kb) },
    { from: corners[2], stake: stake(LOW.x * kb, LOW.z * kb) },
    { from: corners[0], stake: stake(-POLE_TIP.x * ka, -POLE_TIP.z * ka) },
    { from: corners[3], stake: stake(POLE_TIP.x * ka, POLE_TIP.z * ka) },
  ];
  return { ...f, corners, poles: [], guys };
}

/** The canopy of unfolded cart `v` (level ≥ 1), as it stands once it's up: a canvas parallelogram from pole tip to pole
 *  tip (a), its low corners out past the benches (b), on the cart levelled at v.y. No poles of its own (the model's are
 *  drawn); a line from each corner to a stake in the sand. */
export function canopyRig(v: Vehicle): TarpRig {
  const tb = cartToWorld(v, POLE_TIP.x, POLE_TIP.z), ta = cartToWorld(v, -POLE_TIP.x, -POLE_TIP.z), y = v.y + POLE_TIP.y - TIE;
  return canopyFrom(v, { x: ta.x, y, z: ta.z }, { x: tb.x, y, z: tb.z }, 1, CANOPY_SAG);
}

/** The canopy of cart `v` being put up (drawn only: src/world/carts.ts), `hoist` 0..1 its high corners hauled from the
 *  roll's ends on the deck to the drawn pole tips `tipA`, `tipB` (world, the ties TIE under them), then `spread` 0..1 its
 *  low corners out to their stakes as it's pulled tight. At hoist = spread = 1 it's canopyRig(v) (the tips where it
 *  stands them). */
export function canopyRising(v: Vehicle, tipA: Vec, tipB: Vec, hoist: number, spread: number): TarpRig {
  const s3 = (u: number, a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const up = s3(hoist, 0, 0.6), along = s3(hoist, 0.25, 1);
  const end = (sx: number, tip: Vec): Vec => {
    const r = cartToWorld(v, sx * CANOPY_ROLL.half, CANOPY_ROLL.z), ry = v.y + CANOPY_ROLL.y;
    return { x: r.x + (tip.x - r.x) * along, y: ry + (tip.y - TIE - ry) * up, z: r.z + (tip.z - r.z) * along };
  };
  const sag = (0.02 + 0.3 * hoist) * (1 - spread) + CANOPY_SAG * spread;
  return canopyFrom(v, end(-1, tipA), end(1, tipB), spread, sag);
}

// ---- The workshop (level 2) --------------------------------------------------------------------------------------------

/** The deck's top over the ground (m): the fold-out benches are flush with it. */
export const CART_DECK_Y = 0.88;
/** Each fold-out side's middle with its leaf slid out, this far out to either side of the axle's middle (cart space x:
 *  −, the workbench `side_l`; +, the dismantling table `side_r`), and its half sizes across (x, 1.2 m deep: the side's
 *  0.65 and the leaf's 0.55) and along (z, 2.16 m). */
export const CART_BENCH_X = 1.28, CART_BENCH_HX = 0.6, CART_BENCH_HZ = 1.08;
/** Is cart `v` a workshop now: parked, unfolded, level 2 (shared/stations.ts lists its sides)? */
export const isWorkshop = (v: Vehicle) => isCart(v) && parked(v) && !!v.open && (v.level ?? 0) >= 2;
let workshops: readonly Vehicle[] = [];
/** The carts that are workshops now (setCarts), a new array whenever that changes. */
export const cartWorkshops = (): readonly Vehicle[] => workshops;

// ---- Solid while parked -------------------------------------------------------------------------------------------------

/** Its pieces as capsules along its length (cart space: centre x, z, half length, radius, top over the ground, m). The
 *  bed and the wheels, the box on it; packed at level 2 the upright sides make the bed's walls (docs/cart.md: 1.53);
 *  unfolded at level 2 the benches either side, flush with the deck. The tongue is low enough to step over. */
const BED = { x: 0, z: 0, half: 0.4, r: 0.7, top: CART_DECK_Y }, WALLS = 1.53;
const BOX = { x: 0, z: -0.125, half: 0.2, r: 0.42, top: 1.3 };
/** Each bench as two capsules side by side along it (its inner and outer halves), so its corners are nearly square. */
const BENCHES = [-1, 1].flatMap((sx) => [-1, 1].map((k) => {
  const r = CART_BENCH_HX / 2;
  return { x: sx * (CART_BENCH_X + (k * CART_BENCH_HX) / 2), z: 0, half: CART_BENCH_HZ - r, r, top: CART_DECK_Y };
}));

/** A parked cart's capsules (world). */
export function cartCapsules(v: Vehicle): Capsule[] {
  const level = v.level ?? 0;
  const pieces = [{ ...BED, top: level >= 2 && !v.open ? WALLS : BED.top }, BOX, ...(level >= 2 && v.open ? BENCHES : [])];
  const ax = Math.sin(v.heading), az = Math.cos(v.heading);
  return pieces.map((p) => {
    const c = cartToWorld(v, p.x, p.z);
    return { x: c.x, z: c.z, ax, az, half: p.half, r: p.r, y0: v.y, top: v.y + p.top };
  });
}

/** Is parked cart `v`'s canopy up: unfolded at level ≥ 1 and done putting it up (the server clears `pitching` UNFOLD_S
 *  after it's unfolded or raised to level 1 unfolded: server/vehicles.ts), so its canvas shades and is solid only once
 *  it's drawn up? */
export const canopyUp = (v: Vehicle) => !!v.open && (v.level ?? 0) >= 1 && !v.pitching;

/** What the vehicles list makes solid, as last set (a key of the parked carts' poses and states). */
let lastCarts = '';

/** The vehicles list changed (shared/vehicles.ts setVehicles): the parked carts' capsules (shared/capsules.ts), the
 *  unfolded ones' canopies (shared/tarp.ts) and the workshops (cartWorkshops), only when a cart's changed. */
export function setCarts(list: readonly Vehicle[]) {
  const carts = list.filter((v) => isCart(v) && parked(v));
  const key = carts.map((v) => `${v.id},${v.x},${v.y},${v.z},${v.heading},${v.level ?? 0},${v.open ? 1 : 0}${v.pitching ? 'p' : ''}`).join(';');
  if (key === lastCarts) return;
  lastCarts = key;
  setCartCapsules(carts.flatMap(cartCapsules));
  setCanopyRigs(carts.filter(canopyUp).map(canopyRig));
  workshops = carts.filter(isWorkshop);
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

// ---- Waking up by it (docs/cart.md "Spawn") -----------------------------------------------------------------------------

/** Is cart `v` the world's camp: parked, unfolded and built (level ≥ 1, upgraded with the wrench at least once)? Then
 *  everyone wakes up beside it after dying (server/world.ts homeOf), ahead of a bedroll or the pod. */
export const isCamp = (v: Vehicle) => isCart(v) && parked(v) && !!v.open && (v.level ?? 0) >= 1;

/** Clear of the unfolded footprint (its benches' outer edges, the bed's ends) by this much (m): a body's radius and a
 *  step. */
const WAKE_GAP = 0.75;
/** Beside the benches, this far back of the axle (m): out of the line from the canopy's low corner to its stake. */
const WAKE_SIDE_Z = 0.7;

/**
 * Where someone wakes up beside cart `v`: the first of a few spots round it (cart space, from the unfolded footprint,
 * so they follow its size) that `free` takes (the server's: on sand, not a rock, not in anything's capsules, not under
 * the canopy's canvas), facing the cart; or null if none is (then the bedroll or the pod). By the tongue either side
 * first (where you'd walk up to it), then beside the benches, then behind it.
 */
export function campWakeSpot(v: Vehicle, free: (x: number, z: number) => boolean): { x: number; z: number; facing: number } | null {
  const sx = OPEN_HX + WAKE_GAP, sz = OPEN_HZ + WAKE_GAP;
  for (const [lx, lz] of [[-sx, -sz], [sx, -sz], [-sx, WAKE_SIDE_Z], [sx, WAKE_SIDE_Z], [-sx, sz], [sx, sz], [0, sz]]) {
    const p = cartToWorld(v, lx, lz);
    if (!free(p.x, p.z)) continue;
    // Facing (forward (−sin, −cos), shared/sim.ts) the axle's middle.
    return { x: p.x, z: p.z, facing: Math.atan2(p.x - v.x, p.z - v.z) };
  }
  return null;
}
