// The way into the datacenter (docs/levels.md "Getting in and out"): a squat concrete block half sunk in the sand with a
// steel door, one per world, a walk from the pods. Placed from the world seed like the shelters (shared/shelters.ts):
// a few directions round where players arrive, the first whose ground is even and clear of shelters, rock and the pods.
// Pure, deterministic (from the base heightfield, not the edits); computed on first use, not at import (the terrain's
// modules must be loaded first). Node type stripping rules; no three.js.
import { mulberry32 } from '../noise.ts';
import { WORLD_SEED } from '../dunes.ts';
import { ARRIVAL, nearPod } from '../podSpot.ts';
import { LAB_SPAWN } from '../lab.ts';
import { overShelter } from '../shelters.ts';
import { baseHeight, onRock } from '../terrain.ts';
import type { Box, Mover } from '../levels.ts';
import { boxGrid, collideBoxes, type BoxGrid } from './boxes.ts';

export type Entrance = {
  /** The block's middle on the sand, and the sand's height there (its floor line). */
  x: number;
  y: number;
  z: number;
  /** The way the door faces (an axis: the block is axis-aligned like a level's boxes). */
  dx: number;
  dz: number;
  /** The block, solid (the door is drawn on its face). */
  box: Box;
  /** In front of the door: F here goes in. */
  trigger: Box;
  /** Where you come out: on the sand in front of the door, facing away from it (y: the sand's there, at the time). */
  out: { x: number; z: number; facing: number };
};

/** Half the block's footprint, its height over the sand and how deep it sits (m). */
export const BLOCK = { half: 2.2, height: 2.8, sunk: 1.2 };
/** The door in the face: half its width, its height (m). */
export const DOOR = { half: 0.6, height: 2.1 };
/** How far out from where players arrive (m). */
const DIST = [110, 140, 90];
const AXES: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

let made: Entrance | null = null;
let grid: BoxGrid | null = null;

/** This world's entrance. */
export function entrance(): Entrance {
  return (made ??= place());
}

function place(): Entrance {
  const home = ARRIVAL ?? LAB_SPAWN;
  const rand = mulberry32(Math.imul(WORLD_SEED, 0x2c1b3c6d) ^ 0xdc);
  const turn = rand() * Math.PI * 2;
  let best: { x: number; z: number; score: number } | null = null;
  for (const d of DIST) {
    for (let k = 0; k < 8; k++) {
      const a = turn + (k * Math.PI) / 4;
      const x = Math.round(home.x + Math.cos(a) * d), z = Math.round(home.z + Math.sin(a) * d);
      if (overShelter(x, z, 25) || nearPod(x, z, 30)) continue;
      let lo = Infinity, hi = -Infinity, rock = false;
      for (let u = -5; u <= 5; u += 2.5) for (let v = -5; v <= 5; v += 2.5) {
        const h = baseHeight(x + u, z + v);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        rock ||= onRock(x + u, z + v);
      }
      if (rock) continue;
      const score = hi - lo + k * 0.01;
      if (!best || score < best.score) best = { x, z, score };
    }
    if (best && best.score < 1.5) break;
  }
  const { x, z } = best ?? { x: home.x + DIST[0], z: home.z };
  // The door faces the axis nearest the way back to the pods.
  const tx = home.x - x, tz = home.z - z;
  const [dx, dz] = AXES.reduce((a, b) => (b[0] * tx + b[1] * tz > a[0] * tx + a[1] * tz ? b : a));
  let y = Infinity;
  for (let u = -BLOCK.half; u <= BLOCK.half; u += BLOCK.half) for (let v = -BLOCK.half; v <= BLOCK.half; v += BLOCK.half) y = Math.min(y, baseHeight(x + u, z + v));
  const H = BLOCK.half;
  const box: Box = [x - H, x + H, y - BLOCK.sunk, y + BLOCK.height, z - H, z + H];
  // The trigger: 1.6 m out from the face, as wide as the door and a little more; tall, so sand heaped or blown out in
  // front of the door (craters, edits: not in the base height this is placed by) still finds it.
  const fx = x + dx * H, fz = z + dz * H, w = DOOR.half + 0.4, out = 1.6;
  const trigger: Box = [
    Math.min(fx, fx + dx * out) - (dx ? 0 : w), Math.max(fx, fx + dx * out) + (dx ? 0 : w), y - 5, y + 5,
    Math.min(fz, fz + dz * out) - (dz ? 0 : w), Math.max(fz, fz + dz * out) + (dz ? 0 : w),
  ];
  // Facing away from the door: yaw 0 looks down -z, so facing (dx, dz) is atan2(-dx, -dz).
  return { x, y, z, dx, dz, box, trigger, out: { x: fx + dx * 2.4, z: fz + dz * 2.4, facing: Math.atan2(-dx, -dz) } };
}

/** Is (x, z) within `margin` m of the block, the ground in front of its door (its trigger) or where you come out? Nothing
 *  is placed there (shared/placed.ts placeError): it would wall the door in. */
export function nearEntrance(x: number, z: number, margin: number): boolean {
  const e = entrance();
  const near = (b: Box) => x > b[0] - margin && x < b[1] + margin && z > b[4] - margin && z < b[5] + margin;
  return near(e.box) || near(e.trigger) || Math.hypot(x - e.out.x, z - e.out.z) < margin + 1;
}

/** The block as a solid in the desert (shared/levels.ts desertLevel): out of the way unless you are next to it. */
export function collideEntrance(c: Mover, y: number, prevY: number, radius: number, height: number, stepUp: number): number {
  const e = entrance(), b = e.box;
  if (c.x < b[0] - radius - 1 || c.x > b[1] + radius + 1 || c.z < b[4] - radius - 1 || c.z > b[5] + radius + 1) return -Infinity;
  grid ??= boxGrid([b], 8);
  return collideBoxes(grid, c, y, prevY, radius, height, stepUp);
}
