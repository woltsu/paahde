// Vehicles: things standing in the world that are repaired and ridden where they are, never carried (shared/gear.ts
// `vehicle`): the quad and the motorcycle, and the cart towed behind either (shared/cart.ts, docs/cart.md). One quad
// lies broken by the crashed pods (shared/tables.ts HOME_BIKE; older worlds also have a motorcycle by each player's pod)
// and a few motorcycles out at the crash sites (FINDS.motorcycle); F on a quad someone rides gets on its back as a
// passenger (`passenger`, shared/sim.ts PlayerState.pillion); F on a broken one opens its part slots next to the bag (its
// item is in the shared box `veh<id>`, shared/gear.ts vehicleBox, parts fitted like a building's) and, with every slot
// filled, Repair stands it up. F on a working one gets on (the server starts the mount, shared/sim.ts; the bike key or
// F gets off, and it stays where you got off); F on its back opens its cargo (`cargo<id>`), shared by everyone, with
// its part slots to swap in better parts. A vehicle not being ridden doesn't move. The server owns the list
// (server/vehicles.ts, `vehicles` table) and sends it whole on join and when it changes; client and server both keep
// it here with setVehicles().
import { setCarts } from './cart.ts';
import { EYE_HEIGHT } from './dig.ts';
import type { PlayerState } from './sim.ts';

/** A vehicle: kind (a GEAR kind with `vehicle`), where it stands (y: the ground under it) and its heading (same
 *  convention as PlayerState.heading: forward is (-sin, -cos)), `up` once repaired (standing on its wheels; broken
 *  ones lie on their side), the parts fitted in it (its tier and look) and `rider`: the public id of whoever is
 *  getting on or riding it (it isn't drawn here then: the rider's state is the bike), or towing it (a cart: the rider's
 *  PlayerState.tow is it, its pose shared/cart.ts towedPose). A cart's own: `hitched`, the bike (vehicle id) it's linked
 *  to (towed, or parked behind it), `open` (unfolded: docs/cart.md, its owner's Unfold / Pack) and `level` (its item's
 *  ItemData.level). */
export type Vehicle = { id: number; kind: string; x: number; y: number; z: number; heading: number; up: boolean;
  parts: (string | null)[]; rider?: number; hitched?: number; open?: boolean; level?: number;
  /** A cart just unfolded (or raised to level 1 unfolded): its canopy is still being put up (shared/cart.ts canopyUp),
   *  for UNFOLD_S. Never stored. */
  pitching?: boolean;
  /** A cart's owner's colour (their avatar's; never who they are). */
  color?: number;
  /** A quad's passenger: the public id of whoever rides on its back (only while someone rides it). */
  passenger?: number };

/** F reaches a vehicle within this far (m, horizontally from the feet to the edge of its footprint). */
export const VEHICLE_REACH = 3.2;
/** And looking at it, this far from the eye (m) along the crosshair. */
const AIM_REACH = 3.5;
/** Its footprint's radius round its centre (m), for the reach. */
const FOOTPRINT = 0.9;
/** Its box in its own frame (forward is -z): half width, height and half length; lying on its side, wider and lower. */
const UPRIGHT = { hx: 0.4, y1: 1.25, hz: 0.95 };
const QUAD = { hx: 0.62, y1: 1.15, hz: 1.1 };
const LYING = { hx: 0.75, y1: 0.7, hz: 0.95 };
/** The back of the bike (the cargo rack over the rear wheel) is past this far behind the centre (m). */
const REAR = 0.3;
/** A quad's rack starts further back, behind its passenger seat. */
const QUAD_REAR = 0.6;

/** Everything in the world right now (from the server). Replace it with setVehicles(). */
export let vehicles: Vehicle[] = [];

export function setVehicles(list: Vehicle[]) {
  vehicles = list;
  setCarts(list); // (parked carts are solid, unfolded ones' canopies shade: shared/cart.ts)
}

/** Standing still where it is: not being ridden or got on. */
export const parked = (v: Vehicle) => v.rider === undefined;

/** Feet at `s` within reach of vehicle `v` (with `slack` m more). */
export function inReach(s: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, slack = 0): boolean {
  return Math.hypot(s.x - v.x, s.z - v.z) - FOOTPRINT < VEHICLE_REACH + slack && Math.abs(s.y - v.y) < 2 + slack;
}

/** The parked vehicles in reach of a player at `s`, nearest first. */
export function vehiclesNear(s: PlayerState, slack = 0): Vehicle[] {
  return vehicles.filter((v) => parked(v) && inReach(s, v, slack))
    .sort((a, b) => Math.hypot(s.x - a.x, s.z - a.z) - Math.hypot(s.x - b.x, s.z - b.z));
}

/** The vehicle a box (`veh<id>` or `cargo<id>`) belongs to, by id. */
export const vehicleById = (id: number) => (id < 0 ? undefined : vehicles.find((v) => v.id === id));

/**
 * The parked vehicle under the crosshair for a player looking along (yaw, pitch) from `feet`, and whether the
 * crosshair is on its back (the cargo rack; only a working one has it), or null.
 */
export function vehicleTarget(feet: { x: number; y: number; z: number }, yaw: number, pitch: number, list = vehicles):
  { v: Vehicle; rear: boolean } | null {
  let best: { v: Vehicle; rear: boolean } | null = null, bestT = AIM_REACH;
  for (const v of list) {
    // Only one F can use: in reach as its boxes are (openBoxes, vehiclesNear). The crosshair alone reaches a little
    // further, and F there opened the bag without the bike.
    if (!parked(v) || !inReach(feet, v) || v.kind === 'cart') continue; // (carts: shared/cart.ts cartTarget)
    const hit = aimAt(feet, yaw, pitch, v, v.kind === 'quad' ? QUAD : v.up ? UPRIGHT : LYING);
    if (!hit || hit.t >= bestT) continue;
    bestT = hit.t;
    best = { v, rear: v.up && hit.back > (v.kind === 'quad' ? QUAD_REAR : REAR) };
  }
  return best;
}

/**
 * A quad being ridden with its back seat free, under the crosshair (as vehicleTarget), for a player on foot to get on
 * behind the rider: `at(rider)` says where each rider is now (their drawn pose: the list's x, z are where it was parked),
 * or null if they're not in sight.
 */
export function pillionTarget(feet: { x: number; y: number; z: number }, yaw: number, pitch: number,
  at: (rider: number) => { x: number; y: number; z: number; heading: number } | null, list = vehicles): Vehicle | null {
  let best: Vehicle | null = null, bestT = AIM_REACH;
  for (const v of list) {
    if (v.kind !== 'quad' || v.rider === undefined || v.passenger !== undefined) continue;
    const p = at(v.rider);
    if (!p || !inReach(feet, p)) continue;
    const hit = aimAt(feet, yaw, pitch, p, QUAD);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = v;
    }
  }
  return best;
}

/** Where the crosshair from `feet` along (yaw, pitch) first meets box `b` of a vehicle standing at `v` (its frame:
 *  x to its right, y up from the ground under it, forward -z): how far along it (m), and how far back of the centre. */
function aimAt(feet: { x: number; y: number; z: number }, yaw: number, pitch: number,
  v: { x: number; y: number; z: number; heading: number }, b: { hx: number; y1: number; hz: number }): { t: number; back: number } | null {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
  const rx = Math.cos(v.heading), rz = -Math.sin(v.heading), bx = Math.sin(v.heading), bz = Math.cos(v.heading);
  const ox = feet.x - v.x, oz = feet.z - v.z;
  const o = [ox * rx + oz * rz, feet.y + EYE_HEIGHT - v.y, ox * bx + oz * bz];
  const d = [dx * rx + dz * rz, dy, dx * bx + dz * bz];
  const lo = [-b.hx, 0, -b.hz], hi = [b.hx, b.y1, b.hz];
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
  return t0 > t1 ? null : { t: t0, back: o[2] + d[2] * t0 };
}
