// The crashed escape pods: where the players arrive. One drop pod (PODS; the code takes any number) near the world's origin (their spots
// and the furrows they ploughed: shared/podSpot.ts), each half ploughed into the sand at its own angle, its side hatch
// blown open; a drogue chute trails behind one. Each player came down in one: new players appear beside the hatch of
// "their" pod (podSpawn, by a hash of who they are: server/world.ts), and so do the dead with no bedroll to go back to.
// Model and capsules from tools/blender/pod.py (public/models/pod.glb, shared/podModel.ts); drawn by src/world/pods.ts.
//
// Each has two emergency water tanks strapped to its hull by the hatch, their taps dripping: the canteen fills there, as
// at a pump (atPodTap, shared/wells.ts waterAt), so the first water is where you arrive.
//
// Each has its equipment bay torn half out of its right flank, still cabled to it (podSites: machine sites "pod:<n>"
// like a crash site's large machine, shared/crash.ts, worked where it lies; built in shared/machineBuilders.ts podBay):
// stripped, it gives what the quad by the pods is missing, its battery and bearing, and the first wiring. Lying about
// them, a starter kit of scrap and cloth only (podLootSpot, POD_LOOT in shared/tables.ts, rolled in
// shared/lootRoll.ts, laid out by server/loot.ts). The quad lies by the first pod (shared/lootRoll.ts homeBikeSpot).
//
// Solid (collidePods in sim.ts step(); a top within a step of the feet is ground, anything taller a wall) and they cast
// shade (podCasters, shared/shade.ts). Same determinism rules as shared/scrap.ts in the collision: + - * /, Math.sqrt,
// Math.abs, Math.min/max only.
import type { CrashSite } from './crash.ts';
import { POD_POSES } from './podModel.ts';
import { ARRIVAL, ARRIVAL_R, PODS, podToWorld, type PodSpot } from './podSpot.ts';
import { baseHeight } from './terrain.ts';

export { ARRIVAL, nearPod, onPodGround, PODS } from './podSpot.ts';

/** A solid capsule in world xz: segment centre ± half·(ax, az), radius r, from the pod's sand (y) up to top. */
type Cap = { x: number; z: number; ax: number; az: number; half: number; r: number; y: number; top: number };

/** A pod as it lies in the world: its spot, the sand under it (its frame's origin), its capsules. */
export type PodPlace = PodSpot & { y: number; caps: Cap[] };

let places: PodPlace[] | null = null;

/** The lowest sand round pod-local (0, 0) of `p`, its middle and flanks (so it never floats; the heap at its nose is
 *  higher and buries it). */
function lowest(p: PodSpot): number {
  let y = baseHeight(p.x, p.z);
  for (const [lx, lz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.4]]) {
    const q = podToWorld(p, lx, lz);
    y = Math.min(y, baseHeight(q.x, q.z));
  }
  return y;
}

/** The pods in the world (none in the dev test lab). */
export function podPlaces(): PodPlace[] {
  if (places) return places;
  return (places = PODS.map((p) => {
    const y = lowest(p), rx = p.dz, rz = -p.dx; // its +X in the world
    return {
      ...p, y,
      caps: POD_POSES[p.pose].caps.map((c) => ({
        x: p.x + c.x * rx + c.z * p.dx, z: p.z + c.x * rz + c.z * p.dz, ax: c.ax * rx + c.az * p.dx, az: c.ax * rz + c.az * p.dz,
        half: c.half, r: c.r, y, top: y + c.h,
      })),
    };
  }));
}

/** Where a player stands beside pod `n`'s hatch (mod the number of pods): new players, and the dead with no bedroll.
 *  Null in the lab. */
export function podSpawn(n = 0): { x: number; z: number } | null {
  if (!PODS.length) return null;
  const p = PODS[((n % PODS.length) + PODS.length) % PODS.length];
  const [lx, lz] = POD_POSES[p.pose].stand;
  return podToWorld(p, lx, lz);
}

/** A player's pod (podSpawn), from who they are (their browser ID, never sent anywhere): the same one every time. */
export function podOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return (h >>> 0) % Math.max(1, PODS.length);
}

const STAND_MARGIN = 0.15;

/** Push `p` out of the pods; returns the height of a top under its feet to stand on, or -Infinity. */
export function collidePods(p: { x: number; z: number; vx: number; vz: number }, y: number, prevY: number, radius: number, stepUp: number): number {
  const a = ARRIVAL;
  if (!a || Math.abs(p.x - a.x) > ARRIVAL_R || Math.abs(p.z - a.z) > ARRIVAL_R) return -Infinity;
  let support = -Infinity;
  const feet = Math.max(y, prevY);
  for (const pc of podPlaces()) for (const b of pc.caps) {
    const reach = b.half + b.r + radius;
    if (Math.abs(p.x - b.x) > reach || Math.abs(p.z - b.z) > reach || feet < b.y - 2) continue;
    let t = (p.x - b.x) * b.ax + (p.z - b.z) * b.az;
    t = t < -b.half ? -b.half : t > b.half ? b.half : t;
    const qx = b.x + b.ax * t, qz = b.z + b.az * t;
    let ex = p.x - qx, ez = p.z - qz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (feet >= b.top - stepUp) {
      if (d < b.r + STAND_MARGIN && b.top > support) support = b.top;
      continue;
    }
    const R = b.r + radius;
    if (d >= R) continue;
    if (d > 1e-9) { ex /= d; ez /= d; } else { ex = b.az; ez = -b.ax; }
    p.x = qx + ex * R;
    p.z = qz + ez * R;
    const vn = p.vx * ex + p.vz * ez;
    if (vn < 0) { p.vx -= vn * ex; p.vz -= vn * ez; }
  }
  return support;
}

/** The pods' capsules within `r` of (x, z), as shade casters (shared/shade.ts). */
export function podCasters(x: number, z: number, r: number): Cap[] {
  const a = ARRIVAL;
  if (!a || Math.abs(x - a.x) > r + ARRIVAL_R || Math.abs(z - a.z) > r + ARRIVAL_R) return [];
  return podPlaces().flatMap((pc) => pc.caps);
}

// ---- their water ------------------------------------------------------------------------------------------------

/** The canteen fills with your feet within this (m, horizontally) of a pod's tap. */
export const POD_TAP_REACH = 1.5;

/** At a pod's water tap at world (x, y, z) (+ margin): its emergency tanks, strapped to the hull by the hatch, never run
 *  dry (shared/wells.ts waterAt: the first water, where you arrive). */
export function atPodTap(x: number, y: number, z: number, margin = 0): boolean {
  const a = ARRIVAL;
  if (!a || Math.abs(x - a.x) > ARRIVAL_R || Math.abs(z - a.z) > ARRIVAL_R) return false;
  const r = POD_TAP_REACH + margin;
  for (const p of podPlaces()) for (const [tx, ty, tz] of POD_POSES[p.pose].taps) {
    if (ty < 0.15) continue; // (in the sand)
    const q = podToWorld(p, tx, tz), top = p.y + ty;
    const dx = x - q.x, dz = z - q.z;
    if (dx * dx + dz * dz < r * r && y < top + 0.5 && y > top - 3.2) return true;
  }
  return false;
}

// ---- their equipment bays -----------------------------------------------------------------------------------------

/** The numeric site the pods' bays belong to (shared/crash.ts CrashSite.wreck): no crash site has it, so it never
 *  smokes; spent (server/crash.ts) once a bay has been stripped and its frame mashed to scrap. */
export const POD_WRECK = -2;
/** Where each pod's equipment bay lies, pod-local (x, z): against its right flank (the hatch is on its left), its back
 *  to the hull, on the flat between the furrow's banks behind and the heap at the nose (shared/podSpot.ts). */
export const POD_MACHINE_SPOT: [number, number] = [2.05, -0.4];

let sites: CrashSite[] | null = null;

/** The pods' equipment bays, one by each pod, its back to the hull (its +z the pod's +X, its cables running back in). */
export function podSites(): CrashSite[] {
  if (sites) return sites;
  return (sites = PODS.map((pod, index) => {
    const p = podToWorld(pod, POD_MACHINE_SPOT[0], POD_MACHINE_SPOT[1]);
    const seed = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(pod.x | 0, 0x85ebca6b) ^ Math.imul(pod.z | 0, 0xc2b2ae35)) >>> 0;
    return { id: `pod:${index}`, wreck: POD_WRECK, index, level: 0, ...p, yaw: Math.atan2(pod.dz, -pod.dx), kind: 'pod_bay', seed };
  }));
}

/** The pods' machine with this id ("pod:<n>"), or null. Ids may come from the network. */
export function podSiteById(id: unknown): CrashSite | null {
  if (typeof id !== 'string') return null;
  const m = /^pod:(\d)$/.exec(id);
  return (m && podSites()[Number(m[1])]) || null;
}

// ---- what lies about them ------------------------------------------------------------------------------------------

/** Where loot lies by a pod, pod-local (x, z): ahead of its nose, by its flanks, along its furrow. */
export const POD_LOOT_SPOTS: [number, number][] = [[-2.6, 4.2], [2.8, 3.5], [3.6, 1.9], [-3.4, -2.6], [2.4, -4.5], [-2.2, -7], [1.6, -10]];

/** A spot to lay something out by one of the pods, from `rand` (shared/lootRoll.ts podFindSpot). */
export function podLootSpot(rand: () => number): { x: number; z: number } {
  const pod = PODS[Math.floor(rand() * PODS.length)];
  const [lx, lz] = POD_LOOT_SPOTS[Math.floor(rand() * POD_LOOT_SPOTS.length)];
  return podToWorld(pod, lx + (rand() - 0.5) * 2.4, lz + (rand() - 0.5) * 2.4); // a scatter, not heaps
}
