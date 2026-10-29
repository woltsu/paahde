// The tarp (shared/placed.ts TARP): shade you put up yourself, a square of patched canvas stretched tight as a diamond
// between two tall scavenged poles at opposite corners, the other two corners pulled down to stakes at shoulder height.
// Taut like that it's a saddle (a hyperbolic paraboloid): high between the poles, coming down on the two staked sides,
// which keep a low morning or evening sun off the middle. You walk in under it from any side but the low corners' tips.
// Each pole is held up by two guy lines. Made by hand (shared/tables.ts HAND_TABLE) and put down from the hotbar like a
// bedroll, anywhere on the sand; R turns it a quarter at a time (which way the low sides face: best towards the sun's
// rise and set, ±Z, shared/sun.ts).
//
// The rig here is what everything needs: the poles and where the canvas is too low to stand (their collision is
// shared/placed.ts PLACEABLES.tarp's boxes, `tarpBoxes`); the canvas, which shared/shade.ts tests the sun's rays against
// (`tarpTris`), so standing under it cools you like any shade (server/water.ts), and which is solid to the sim
// (`tarpGround`, `tarpCeiling`, `tarpSlope`: a jump from under it stops at it, you can stand on it). Every corner
// stands a fixed height over its own sand (heightAt), so the canvas follows the ground. The client draws it from the
// same canvasAt (src/world/tarps.ts), finer, billowing in the wind on the GPU.
//
// The canvas in its own square (s, t) ∈ [−1, 1]²: the poles at (−1, −1) and (1, 1), the low corners at (1, −1) and
// (−1, 1). Its height is the four corners' bilinear blend (the saddle) less a little sag; its edges are drawn in towards
// the middle (taut edges curve in), by SCALLOP. On the ground the square stands as a diamond: the poles along the
// tarp's own a (X in its frame), the low corners along b (Z), TARP_HALF out from the centre.
//
// Deterministic: + - * / and heightAt only.
import { heightAt } from './terrain.ts';

/** Centre to each corner (m): the poles and the low corners stand this far out, the canvas ~7.4 m a side. */
export const TARP_HALF = 5.2;
/** The poles' tops over their sand (m): two scavenged lengths, not quite the same; the canvas's corners just under. */
export const TARP_POLES: [number, number] = [5.0, 5.5];
/** The low corners over their sand (m): about a shoulder's height, so most of it is walked under. */
const LOW_H = 1.5;
/** The pole's tip over the canvas's corner (m). */
const TIP = 0.14;
/** The poles lean out at the foot this far (m) along a. */
const LEAN = 0.3;
/** The guy lines: each pole's two run out this far (m, on the ground) at ±GUY_ANGLE off its line; a low corner's this far out. */
const GUY_OUT = 2.6, GUY_ANGLE = Math.PI / 6, LOW_OUT = 1.1;
/** Below this (m over the sand) the canvas is too low to stand under: solid (a head). */
export const TARP_HEAD = 1.9;
/** How far the canvas sags (m) mid-way between its corners. */
export const TARP_SAG = 0.15;
/** How far its edges curve in, as a share of the square's half side, at their middle. */
const SCALLOP = 0.1;
/** How far the footprint reaches along a and b (m): the poles' feet, the low corners (the stakes go a little further,
 *  like any tent's lines). */
export const TARP_REACH_A = TARP_HALF + LEAN + 0.15;
export const TARP_REACH_B = TARP_HALF;

export type Vec = { x: number; y: number; z: number };
/** A tarp as it stands: its two poles (foot and top), the canvas's corners in its square's order ((−1, −1) pole,
 *  (1, −1) low, (−1, 1) low, (1, 1) pole: index (s > 0) + 2·(t > 0)), and the lines from a pole or corner to a stake. */
export type TarpRig = { poles: { foot: Vec; top: Vec }[]; corners: Vec[]; guys: { from: Vec; stake: Vec }[];
  /** Turned frame: world (x, z) = centre + a·(ax, az) + b·(bx, bz), a and b ∈ [−1, 1] (×TARP_HALF m). */
  cx: number; cz: number; ax: number; az: number; bx: number; bz: number };

/** Turn `rot` (quarter turns) of a point in the tarp's frame, about its centre: world offset. Matches three.js's
 *  rotation.y = rot·π/2 and shared/placed.ts worldBoxes. */
function turn(rot: number, a: number, b: number): [number, number] {
  switch (rot & 3) {
    case 1: return [b, -a];
    case 2: return [-a, -b];
    case 3: return [-b, a];
    default: return [a, b];
  }
}

/** The rig of a tarp at (x, z) turned `rot`, in world coordinates. `ground`: the sand's height (flat for an icon). */
export function tarpRig(x: number, z: number, rot: number, ground: (x: number, z: number) => number = heightAt): TarpRig {
  const [ax, az] = turn(rot, TARP_HALF, 0), [bx, bz] = turn(rot, 0, TARP_HALF);
  const at = (a: number, b: number, h: number): Vec => {
    const px = x + a * ax + b * bx, pz = z + a * az + b * bz;
    return { x: px, y: ground(px, pz) + h, z: pz };
  };
  // Square corner (s, t) → frame (a, b) = ((s + t)/2, (t − s)/2).
  const corners = [at(-1, 0, TARP_POLES[0]), at(0, -1, LOW_H), at(0, 1, LOW_H), at(1, 0, TARP_POLES[1])];
  const poles = [-1, 1].map((side, i) => {
    const c = corners[i === 0 ? 0 : 3];
    const foot = at(side * (1 + LEAN / TARP_HALF), 0, 0);
    return { foot: { ...foot, y: foot.y - 0.2 }, top: { x: c.x, y: c.y + TIP, z: c.z } };
  });
  const guys: { from: Vec; stake: Vec }[] = [];
  for (const [i, side] of [[0, -1], [3, 1]]) {
    const c = corners[i], from = { x: c.x, y: c.y + TIP * 0.6, z: c.z };
    for (const k of [-1, 1]) {
      guys.push({ from, stake: at(side * (1 + (GUY_OUT * Math.cos(GUY_ANGLE)) / TARP_HALF), (k * GUY_OUT * Math.sin(GUY_ANGLE)) / TARP_HALF, 0) });
    }
  }
  for (const [i, side] of [[1, -1], [2, 1]]) guys.push({ from: corners[i], stake: at(0, side * (1 + LOW_OUT / TARP_HALF), 0) });
  return { poles, corners, guys, cx: x, cz: z, ax, az, bx, bz };
}

/** Where a tarp at (x, z) turned `rot` stands on the sand (world x, z): its centre, its poles' feet and its low corners. */
export function tarpTies(x: number, z: number, rot: number): [number, number][] {
  return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([a, b]) => {
    const [dx, dz] = turn(rot, a * TARP_HALF, b * TARP_HALF);
    return [x + dx, z + dz];
  });
}

/** The canvas's height over its square's point (s, t) (already drawn in: inside the scalloped edge), without the wind. */
function surface(r: TarpRig, s: number, t: number): number {
  const [c00, c10, c01, c11] = r.corners;
  const u = (s + 1) / 2, v = (t + 1) / 2;
  const y = (c00.y * (1 - u) + c10.y * u) * (1 - v) + (c01.y * (1 - u) + c11.y * u) * v;
  return y - TARP_SAG * (1 - s * s * t * t);
}

/** A point of the canvas at (u, v) ∈ [0, 1]² of its square (u along s, v along t), without the wind. */
export function canvasAt(r: TarpRig, u: number, v: number, out: Vec = { x: 0, y: 0, z: 0 }): Vec {
  const s0 = 2 * u - 1, t0 = 2 * v - 1;
  // The edges drawn in: none at the corners, most mid-edge.
  const s = s0 * (1 - SCALLOP * (1 - t0 * t0)), t = t0 * (1 - SCALLOP * (1 - s0 * s0));
  const a = (s + t) / 2, b = (t - s) / 2;
  out.x = r.cx + a * r.ax + b * r.bx;
  out.z = r.cz + a * r.az + b * r.bz;
  out.y = surface(r, s, t);
  return out;
}

/** The canvas's height (without the wind) over world (x, z), or NaN outside it. */
export function canvasYAt(r: TarpRig, x: number, z: number): number {
  const h2 = TARP_HALF * TARP_HALF, dx = x - r.cx, dz = z - r.cz;
  const a = (dx * r.ax + dz * r.az) / h2, b = (dx * r.bx + dz * r.bz) / h2;
  const s = a - b, t = a + b;
  const as = s < 0 ? -s : s, at = t < 0 ? -t : t;
  if (as > 1 - SCALLOP * (1 - t * t) || at > 1 - SCALLOP * (1 - s * s)) return NaN;
  return surface(r, s, t);
}

/** Grid cells along each side of the canvas for the shade's triangles. */
const SHADE_N = 4;
/** The canvas as triangles (three corners each, flattened) for the shade (shared/shade.ts): a SHADE_N² grid of canvasAt,
 *  within a few cm of what's drawn. */
export function tarpTris(r: TarpRig): Vec[] {
  const n = SHADE_N + 1, pts: Vec[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(canvasAt(r, i / SHADE_N, j / SHADE_N));
  const out: Vec[] = [];
  for (let j = 0; j < SHADE_N; j++) {
    for (let i = 0; i < SHADE_N; i++) {
      const k = j * n + i;
      out.push(pts[k], pts[k + n], pts[k + n + 1], pts[k], pts[k + n + 1], pts[k + 1]);
    }
  }
  return out;
}

/** Where the canvas is too low to stand (under TARP_HEAD), on level sand, as boxes in the tarp's frame (x along a, z
 *  along b, metres): steps along a, each from where it's head-high at the step's inner side out to the edge, on both
 *  low sides. For shared/placed.ts PLACEABLES.tarp. */
export function tarpBoxes(): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] {
  const r = tarpRig(0, 0, 0, () => 0);
  const out: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] = [];
  const STEP = 0.7, H = TARP_HALF;
  for (let x0 = 0; x0 < H - 0.3; x0 += STEP) {
    const x1 = Math.min(x0 + STEP, H);
    // Out from the middle along b at the step's inner side (lowest there): the first point under head height.
    let z = 0;
    while (z < H && !(canvasYAt(r, x0, z) < TARP_HEAD)) z += 0.05;
    const edge = H - (x0 + x1) / 2;
    if (z >= edge - 0.15) continue;
    for (const sb of [-1, 1]) {
      const [z0, z1] = sb > 0 ? [z, edge] : [-edge, -z];
      if (x0 === 0) out.push({ x0: -x1, x1, y0: 0, y1: TARP_HEAD, z0, z1 });
      else for (const sa of [-1, 1]) out.push({ x0: sa > 0 ? x0 : -x1, x1: sa > 0 ? x1 : -x0, y0: 0, y1: TARP_HEAD, z0, z1 });
    }
  }
  return out;
}

// The canvas is solid to the sim (shared/levels.ts desertLevel's ground and ceiling, so client prediction and the server
// agree): feet that were on or over it stand on it; a head that was under it stops at it (a jump from underneath).
// The rigs of every tarp standing, set by shared/placed.ts setPlaced; tested only within the tarp's square.
let rigs: TarpRig[] = [];
/** Feet this far under the canvas a tick ago still land on it; a head this far over it still bumps it (m). */
const SKIN = 0.3;

/** The tarps standing now (shared/placed.ts setPlaced). */
export function setTarpRigs(list: TarpRig[]) {
  rigs = list;
}

/** The canvas under (x, z) for feet that were at `prevY`: the highest it's at under them (they were on or over it), or
 *  -Infinity. */
export function tarpGround(x: number, z: number, prevY: number): number {
  let best = -Infinity;
  for (const r of rigs) {
    if (Math.abs(x - r.cx) > TARP_HALF || Math.abs(z - r.cz) > TARP_HALF) continue;
    const y = canvasYAt(r, x, z);
    if (y > best && prevY >= y - SKIN) best = y;
  }
  return best;
}

/** Feet at (x, y, z) standing on a canvas: its slope there (rise per metre along x and z) into `out`, and true; else
 *  false. Steeper than the sand holds (shared/sim.ts SLIP_TAN), you slide off it like down a slip face. */
export function tarpSlope(x: number, y: number, z: number, out: { gx: number; gz: number }): boolean {
  const d = 0.1;
  for (const r of rigs) {
    if (Math.abs(x - r.cx) > TARP_HALF || Math.abs(z - r.cz) > TARP_HALF) continue;
    const c = canvasYAt(r, x, z);
    if (!(Math.abs(y - c) < 0.05)) continue;
    // Central differences, one-sided at the edge (NaN past it).
    const xp = canvasYAt(r, x + d, z), xm = canvasYAt(r, x - d, z), zp = canvasYAt(r, x, z + d), zm = canvasYAt(r, x, z - d);
    out.gx = xp === xp ? (xm === xm ? (xp - xm) / (2 * d) : (xp - c) / d) : xm === xm ? (c - xm) / d : 0;
    out.gz = zp === zp ? (zm === zm ? (zp - zm) / (2 * d) : (zp - c) / d) : zm === zm ? (c - zm) / d : 0;
    return true;
  }
  return false;
}

/** The highest the feet of a mover `height` tall that were at `prevY` may go under a canvas over (x, z) (its head was
 *  under it), or Infinity. */
export function tarpCeiling(x: number, z: number, prevY: number, height: number): number {
  let low = Infinity;
  for (const r of rigs) {
    if (Math.abs(x - r.cx) > TARP_HALF || Math.abs(z - r.cz) > TARP_HALF) continue;
    const y = canvasYAt(r, x, z);
    if (prevY + height <= y + SKIN && y - height < low) low = y - height;
  }
  return low;
}
