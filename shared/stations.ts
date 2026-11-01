// Work stations: the crafting workbench and the dismantling table (disassembly), and which one the player is looking at.
// They are the fold-out sides of every unfolded, parked level-2 cart (shared/cart.ts cartWorkshops: the workbench on its
// left, x < 0, the table on its right) and the ones put up with the wrench before the cart replaced them (shared/placed.ts
// WORKBENCH, TABLE: still standing in older worlds, no longer built). At a workbench, the 'bench' box (the repair slot)
// and the recipes are open (shared/storage.ts openBoxes, server/items.ts craft); a carried machine is taken apart on a
// table (shared/crash.ts tables, server/crash.ts). The server checks reach with stationReach().
import { CART_BENCH_HX, CART_BENCH_HZ, CART_BENCH_X, CART_DECK_Y, cartToWorld, cartWorkshops } from './cart.ts';
import { EYE_HEIGHT, pitchFromQ } from './dig.ts';
import { placed, PLACEABLES, TABLE, WORKBENCH, type Placed } from './placed.ts';
import { yawFromQ } from './sim.ts';
import type { Vehicle } from './vehicles.ts';

/** How far from the eye a station can be used, metres. */
export const STATION_REACH = 3;

export const STATION_KINDS = ['workbench', 'disassembly'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

/** A station: its kind, its id (a table's is its dismantling session, shared/crash.ts: `bench<placed id>` for a placed
 *  one, `cart<vehicle id>` for a cart's side), what it is (`placed` or `cart`), and its look-target box: centred on
 *  (x, z), half sizes hx, hz along its own x and z, turned by `yaw` like a heading (three.js rotation.y: its own −z is
 *  world (−sin yaw, −cos yaw)), from y0 up to y1 (the working top). */
export type Station = {
  kind: StationKind; id: string; placed?: number; cart?: number;
  x: number; z: number; yaw: number; hx: number; hz: number; y0: number; y1: number;
};

/** Session id of a placed dismantling table, and of a cart's (its fold-out right side). */
export const placedTableId = (placedId: number) => `bench${placedId}`;
export const cartTableId = (vehicleId: number) => `cart${vehicleId}`;

/** A placed station's kind and the height of its working top. (Looked up when called: shared/placed.ts may not be
 *  loaded yet while this module is, the two import each other's neighbours.) */
const topOf = (kind: string): { kind: StationKind; h: number } | null =>
  kind === WORKBENCH ? { kind: 'workbench', h: 0.95 } : kind === TABLE ? { kind: 'disassembly', h: 0.82 } : null;

function placedStation(p: Placed): Station[] {
  const t = topOf(p.kind);
  if (!t) return [];
  const k = PLACEABLES[p.kind];
  // The table's tools stick out past its top: the box is the top itself (2 × 2 m). Placed things face ±X or ±Z.
  const hx0 = p.kind === TABLE ? 1 : k.hx, hz0 = p.kind === TABLE ? 1 : k.hz;
  const hx = p.rot & 1 ? hz0 : hx0, hz = p.rot & 1 ? hx0 : hz0;
  const id = t.kind === 'disassembly' ? placedTableId(p.id) : `work${p.id}`;
  return [{ kind: t.kind, id, placed: p.id, x: p.x, z: p.z, yaw: 0, hx, hz, y0: p.y, y1: p.y + t.h }];
}

/** An unfolded level-2 cart's two sides: the workbench (x < 0) and the dismantling table (x > 0), flush with its deck. */
function cartStations(v: Vehicle): Station[] {
  const side = (kind: StationKind, sx: number, id: string): Station => {
    const c = cartToWorld(v, sx * CART_BENCH_X, 0);
    return { kind, id, cart: v.id, x: c.x, z: c.z, yaw: v.heading, hx: CART_BENCH_HX, hz: CART_BENCH_HZ, y0: v.y, y1: v.y + CART_DECK_Y };
  };
  return [side('workbench', -1, `cartwork${v.id}`), side('disassembly', 1, cartTableId(v.id))];
}

let cache: { list: Placed[] | null; carts: readonly Vehicle[] | null; out: Station[] } = { list: null, carts: null, out: [] };
/** Every station in the world now: the placed ones (shared/placed.ts `placed`) and the unfolded workshop carts'. */
export function stations(): Station[] {
  const carts = cartWorkshops();
  if (cache.list !== placed || cache.carts !== carts) {
    cache = { list: placed, carts, out: [...placed.flatMap(placedStation), ...carts.flatMap(cartStations)] };
  }
  return cache.out;
}

/** (x, z) in station `s`'s own frame (its centre the origin, unturned). */
export function stationLocal(s: { x: number; z: number; yaw: number }, x: number, z: number): { x: number; z: number } {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  return { x: dx * c - dz * n, z: dx * n + dz * c };
}

/** Distance from the eye to a station's box (0 inside it). For server-side reach checks. */
export function stationReach(feet: { x: number; y: number; z: number }, s: Station): number {
  const ey = feet.y + EYE_HEIGHT;
  const l = stationLocal(s, feet.x, feet.z);
  const dx = Math.max(Math.abs(l.x) - s.hx, 0);
  const dy = Math.max(s.y0 - ey, 0, ey - s.y1);
  const dz = Math.max(Math.abs(l.z) - s.hz, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Is a station of `kind` within reach (+ slack) of a player at `feet`? */
export const nearStation = (feet: { x: number; y: number; z: number }, kind: StationKind, slack = 0) =>
  stations().some((s) => s.kind === kind && stationReach(feet, s) < STATION_REACH + slack);

/** The station the player is looking at (nearest box hit by the look ray within STATION_REACH), or null. */
export function stationTarget(feet: { x: number; y: number; z: number }, yawQ: number, pitchQ: number): Station | null {
  const yaw = yawFromQ(yawQ), pitch = pitchFromQ(pitchQ);
  const cp = Math.cos(pitch);
  const dw = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  let best: Station | null = null, bestT = STATION_REACH;
  for (const s of stations()) {
    if (stationReach(feet, s) > STATION_REACH) continue;
    // In the station's own frame, where its box is axis-aligned (turning about y keeps the ray's length, so t is metres).
    const o = stationLocal(s, feet.x, feet.z), c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    const e = [o.x, feet.y + EYE_HEIGHT, o.z];
    const d = [dw[0] * c - dw[2] * n, dw[1], dw[0] * n + dw[2] * c];
    // Slab test: the ray's entry is the latest of the three near-plane crossings.
    const lo = [-s.hx, s.y0, -s.hz], hi = [s.hx, s.y1, s.hz];
    let t0 = 0, t1 = Infinity, miss = false;
    for (let k = 0; k < 3 && !miss; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        miss = e[k] < lo[k] || e[k] > hi[k];
        continue;
      }
      const a = (lo[k] - e[k]) / d[k], b = (hi[k] - e[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (!miss && t0 <= t1 && t0 < bestT) {
      bestT = t0;
      best = s;
    }
  }
  return best;
}
