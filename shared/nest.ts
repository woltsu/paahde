// A solar farm's nest (shared/solarfarms.ts): the brood queen's spiderlings (shared/queen.ts SP_*), dozens of them,
// clinging to the heliostats' mirrors near the tower, on the face or hanging under it. Come near and they drop off the
// mirrors in a wave, the ones by those waking the next, and hunt you as the queen's brood does (server/brood.ts). Small:
// a rifle shot or a blow of the scrap mace kills one, the pistol takes two (NEST_HP, NEST_DAMAGE); no weak points. Get in among the nest's mirrors
// and the whole nest comes down, in a wave out from you. Simulated by server/nests.ts,
// drawn by src/world/brood.ts like the queen's.
//
// The perches are worked out from the farm's layout the same everywhere (seeded by the farm's id), so the server
// only sends which perch a spiderling is on (NEST_N numbers per spiderling in 'bots' `n`).
import { mulberry32 } from './noise.ts';
import { AIMED, BROKEN, farmLayout, FIELD, HELIO, STOWED, type SolarFarm } from './solarfarms.ts';

/** Spiderlings per nest (one per perch), and how far out the mirrors they cling to stand (m from the tower). */
export const NEST_N = 30;
export const NEST_R = FIELD.r0 + FIELD.dr * 3 + 1;
/** Hit points, and a hit's damage by weapon: one rifle shot, blow of the scrap mace or blaster burst (shared/rifle.ts
 *  BLASTER: its rim takes one), two of the pistol. A gun that kills outright (shared/rifle.ts kills) takes them all.
 *  Its thin skin lets every gun bite (shared/enemies.ts armor). */
export const NEST_HP = 2;
export const NEST_DAMAGE = { rifle: 2, pistol: 1, mace: 2, blaster: 2 } as const;
/** Someone out in the open within WAKE_R (m) of a perch wakes it (after WAKE_MS, random up to); one awake wakes those
 *  within CHAIN_R of it CHAIN_MS (random up to) later. */
export const WAKE_R = 48, WAKE_MS = 900, CHAIN_R = 24, CHAIN_MS = 1400;
/** Someone in among the nest's mirrors (within NEST_R of the tower) sets off all of it: a wave out from them, each one
 *  WAVE_MS per metre off them later. */
export const WAVE_MS = 35;
/** Running speed (m/s): still faster than a run (7.5), a little slower than the queen's own. */
export const NEST_SPEED = 8.6;
/** Perched: its body this far off the mirror's face (m). */
const OFF = 0.3;
/** 'bots' `n`: per spiderling id, x, z, yaw, state (SP_*), since (server ms), perch (-1: off it). */
export const NEST_STRIDE = 7;

export type Perch = {
  /** World position of the body, its up (unit: off the face, or down under it), its heading (rad, about up). */
  x: number; y: number; z: number;
  ux: number; uy: number; uz: number;
  yaw: number;
  /** Where it lands dropping off (world, on the pad). */
  lx: number; lz: number;
};

const perches = new Map<number, Perch[]>();

/** Farm f's perches (NEST_N), the same on server and client. */
export function nestPerches(f: SolarFarm): Perch[] {
  let out = perches.get(f.id);
  if (out) return out;
  const r = mulberry32((f.id * 2654435761) ^ 0x6e357);
  const helio = farmLayout(f).helio.filter((h) => h.panels === 15 && (h.state === AIMED || h.state === STOWED || h.state === BROKEN)
    && h.x * h.x + h.z * h.z < NEST_R * NEST_R);
  out = [];
  // In clutches of two to four on a mirror: a mirror is picked, then spots on it.
  let h = helio[0], left = 0;
  const spots: [number, number][] = [];
  for (let i = 0; i < NEST_N; i++) {
    if (left-- <= 0) {
      if (!helio.length) break;
      h = helio.splice(Math.floor(r() * helio.length) % helio.length, 1)[0];
      left = 1 + Math.floor(r() * 3);
      spots.length = 0;
    }
    // Off the middle (the post's head is under it) and clear of the others on this mirror.
    let a = 0, b = 0;
    for (let k = 0; k < 12; k++) {
      a = (r() < 0.5 ? -1 : 1) * (1.1 + r() * (HELIO.hw * 0.78 - 1.1));
      b = (r() * 2 - 1) * HELIO.hh * 0.7;
      if (!spots.some(([sa, sb]) => (sa - a) * (sa - a) + (sb - b) * (sb - b) < 1.7 * 1.7)) break;
    }
    spots.push([a, b]);
    const under = r() < 0.45;
    const s = under ? -1 : 1;
    const ux = h.nx * s, uy = h.ny * s, uz = h.nz * s;
    const x = f.x + h.x + h.ux * a + h.vx * b + ux * (OFF + HELIO.t / 2);
    const y = f.y + HELIO.pivot + h.vy * b + uy * (OFF + HELIO.t / 2);
    const z = f.z + h.z + h.uz * a + h.vz * b + uz * (OFF + HELIO.t / 2);
    // Facing up or down the mirror, or along it, as it likes.
    const yaw = r() * 6.283185307179586;
    // It lands below where it clung, a little out from the post.
    let lx = x - f.x - h.x, lz = z - f.z - h.z;
    const d = Math.sqrt(lx * lx + lz * lz);
    if (d < 1.2) {
      const k = 1.2 / Math.max(d, 1e-3);
      lx = d < 1e-3 ? 1.2 : lx * k;
      lz = d < 1e-3 ? 0 : lz * k;
    }
    out.push({ x, y, z, ux, uy, uz, yaw, lx: f.x + h.x + lx, lz: f.z + h.z + lz });
  }
  if (perches.size > 8) perches.delete(perches.keys().next().value!);
  perches.set(f.id, out);
  return out;
}
