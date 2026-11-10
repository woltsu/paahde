// Loose stones: pebbles, cobbles, boulders and fallen blocks lying about the desert, drawn by src/world/stones.ts and
// collided with in the sim (desertLevel.collide in shared/levels.ts) and by shots (shotSolid in shared/terrain.ts).
// Unlike the rock formations (shared/rocks.ts, part of the heightfield) each is a prop of its own, so it can be rounder,
// blockier and sharper than a heightfield can be.
//
// How stony the ground is (`stoniness`): only by rock. The feet of the rock formations, where their talus lies
// (`rockFoot`), the foot of a canyon's walls, and bare rock itself (a tableland, a rock's top, a butte on a canyon's
// floor); a biome may add its own (`stones` in shared/biomes.ts: a canyon's floor a few). Open sand has none. Deep sand
// buries them: drifted over a rock's foot they are gone.
//
// Same determinism rules as shared/dunes.ts (the server collides with them, clients predict): integer hashing and exact
// IEEE operations only, no trig (a stone's long axis is a rejection-sampled unit vector). The layout depends only on
// WORLD_SEED and baseHeight, so stones never move; their height follows the edited ground at their centre.
//
// The world is cut into STONE_CELL squares; each owns the stones whose centres lie in it. A stone is an ellipse in xz
// (radii rx along its axis, rz across) with a height profile by shape (ROUND, BLOCK, SLAB). Its hitbox is that ellipse a
// little smaller (HIT, so the lumps of its mesh rather than air are what stop you), a wall up to its shoulder (`wallH`,
// where its flank gets too steep to walk) and ground above it (you can stand on a boulder you jumped onto). Stones with a
// shoulder below the sim's STEP_UP are only ground: you walk over them.
import { blend } from './biomes.ts';
import { canyonAt, canyonOut } from './canyons.ts';
import { cellCache } from './cellCache.ts';
import { crashSitesNear } from './crashsites.ts';
import { duneFloor } from './dunes.ts';
import { mulberry32, ss } from './noise.ts';
import { originClear } from './origin.ts';
import { onPodGround } from './podSpot.ts';
import { rockFoot } from './rocks.ts';
import { SCRAP_CELL, scrapPieces } from './scrap.ts';
import { shelterWithin } from './shelters.ts';
import { solarWithin } from './solarfarms.ts';
import { addShotSolid, baseHeight, edits, groundAt, WORLD_SEED } from './terrain.ts';
import { towerWithin } from './towers.ts';
import { wrecksNear } from './wrecks.ts';
import { LAB } from './world.ts';

/** Grid cell size (m). */
export const STONE_CELL = 32;
/** Largest radius a stone can have (m): how far beyond its own cell a cell's stones reach. */
export const STONE_R_MAX = 3.2;
/** Stones a cell holds at most (where it is stoniest). */
const N_MAX = 34;
/** Stones lower than this (m) have no hitbox: gravel you walk through. */
const MIN_HIT = 0.12;
/** Shots are stopped by stones at least this tall (m): big enough to hide behind a little. */
const MIN_COVER = 0.5;
/** The hitbox's radii, × the stone's. */
const HIT = 0.9;
/** Keep this far (m) from a crash site's centre (its debris and machines are spread round it). */
const CRASH_CLEAR = 45;

/** Height profiles: ROUND a dome, BLOCK a flat top on steep sides, SLAB the same, lower and steeper-edged. */
export const ROUND = 0, BLOCK = 1, SLAB = 2;
/** Per profile: where (normalised distance from the centre) its flank gets too steep to walk, its shoulder. */
const T_WALL = [0.8, 2 / 3, 0.75];

/** Height (fraction of the stone's) of profile `p` at normalised distance t from its centre (0..1). */
export function stoneProfile(p: number, t: number): number {
  if (t >= 1) return 0;
  if (p === ROUND) return Math.sqrt(1 - t * t);
  const k = p === BLOCK ? 3 : 4;
  return Math.min(1, k * (1 - t));
}

/** Shapes: profile, height range (× radius), most elongated aspect, how common, and how many mesh variants
 *  src/world/stones.ts makes of it. `minR`: no smaller than this (m). */
export const STONE_SHAPES: { profile: number; h: [number, number]; aspect: number; weight: number; variants: number; minR: number }[] = [
  { profile: ROUND, h: [0.5, 0.85], aspect: 1.5, weight: 4, variants: 3, minR: 0 }, // rounded boulders and cobbles
  { profile: BLOCK, h: [0.6, 1.15], aspect: 1.7, weight: 3, variants: 3, minR: 0 }, // angular blocks broken off the cliffs
  { profile: SLAB, h: [0.22, 0.38], aspect: 1.8, weight: 1.5, variants: 2, minR: 0.6 }, // flat slabs of a bed
];
const SHAPE_WEIGHT = STONE_SHAPES.reduce((s, k) => s + k.weight, 0);

export type Stone = {
  x: number; z: number;
  /** Unit long axis. */
  ax: number; az: number;
  /** Radii (m) along and across its axis, and height above its foot. */
  rx: number; rz: number; h: number;
  /** Height of its foot before the ground's edits (m): sunk to the lowest ground round it, and a little into it. */
  y0: number;
  /** STONE_SHAPES index, mesh variant, and its colour (0..1: darker to paler) for the renderer. */
  shape: number; variant: number; tint: number;
  /** Height of its shoulder above its foot: a wall below it, ground above. */
  wallH: number;
  /** It collides (h ≥ MIN_HIT), and stops shots (h ≥ MIN_COVER). */
  hit: boolean; cover: boolean;
};

/** Deterministic PRNG seeded from a cell (integer hashing only). */
function rng(ix: number, iz: number) {
  return mulberry32(Math.imul(ix | 0, 0x1b873593) ^ Math.imul(iz | 0, 0x2f2a7d15) ^ Math.imul(WORLD_SEED, 0x9e3779b1) ^ 0x57a3e);
}

/** How stony the ground is at (x, z), 0..1: how many stones lie about and how big they get. Pure function. */
export function stoniness(x: number, z: number): number {
  if (LAB) return 0; // the dev test lab (shared/lab.ts) is a plain floor
  const g = groundAt(x, z);
  const sand = g.sand, rock = g.rock;
  // Talus at the feet of the rocks, and the biome's own.
  let s = 0.9 * rockFoot(x, z) + blend(x, z, (b) => b.stones, 0);
  // Rockfall heaped at the foot of a canyon's walls.
  if (canyonAt(x, z)) s += 0.7 * canyonOut.foot;
  // Bare rock, or rock under a skin of sand: weathered pieces lying on it.
  if (rock > -Infinity) s += 0.3 * (1 - ss((sand - rock) * (1 / 0.6)));
  // Deep sand buries them: how much lies over the dune floor, or over the rock where there is some.
  const depth = sand - Math.max(duneFloor(x, z, WORLD_SEED), rock);
  s *= 1 - ss((depth - 1) * (1 / 4));
  return s > 1 ? 1 : s;
}

/** Ground gradient² at (x, z) over ±e (m). */
function grad2(x: number, z: number, e: number): number {
  const gx = (baseHeight(x + e, z) - baseHeight(x - e, z)) / (2 * e);
  const gz = (baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
  return gx * gx + gz * gz;
}

/** Something else the layout put down (or keeps clear) reaches within r of (x, z): the origin's ground, a shelter, a
 *  solar farm, a radio tower, the pods, a crash site, a wreck, a scrap pile's pieces. */
function taken(x: number, z: number, r: number): boolean {
  if (originClear(x, z) < 1 || shelterWithin(x, z, r) || solarWithin(x, z, r) || towerWithin(x, z, r) || onPodGround(x, z, r)) return true;
  if (crashSitesNear(x, z, r + CRASH_CLEAR).length > 0 || wrecksNear(x, z, r + 8).length > 0) return true;
  const m = r + 9; // a pile's pieces lie within ~7.5 m of its centre
  for (let j = Math.floor((z - m) / SCRAP_CELL); j <= Math.floor((z + m) / SCRAP_CELL); j++) {
    for (let i = Math.floor((x - m) / SCRAP_CELL); i <= Math.floor((x + m) / SCRAP_CELL); i++) {
      for (const pc of scrapPieces(i, j)) {
        const dx = pc.x - x, dz = pc.z - z, q = r + 1.5;
        if (dx * dx + dz * dz < q * q) return true;
      }
    }
  }
  return false;
}

/** A stone at (x, z) of radius R and shape, or null where it can't lie (too steep, on something else, on another
 *  stone). `near`: something is placed somewhere in the cell (check each stone against it). */
function makeStone(out: Stone[], x: number, z: number, R: number, shape: number, r: () => number, near: boolean): Stone | null {
  const K = STONE_SHAPES[shape];
  // Random values drawn up front, so a rejected stone uses as many as a kept one.
  const hr = r(), ar = r(), vr = r(), tr = r(), br = r();
  let ax = 1, az = 0;
  for (let i = 0; i < 16; i++) {
    const u = 2 * r() - 1, v = 2 * r() - 1, q = u * u + v * v;
    if (q > 0.01 && q <= 1) { const l = Math.sqrt(q); ax = u / l; az = v / l; break; }
  }
  if (R < K.minR) R = K.minR;
  const rx = R, rz = R / (1 + (K.aspect - 1) * ar);
  const h = R * (K.h[0] + (K.h[1] - K.h[0]) * hr);
  // Not on slip faces, cliffs or steep flanks: the bigger, the flatter the ground it needs.
  const e = Math.max(0.4, rx * 0.6);
  if (grad2(x, z, e) > (R > 1 ? 0.3 : 0.55)) return null;
  // Not overlapping a bigger stone already there (small ones may lean on each other).
  for (const o of out) {
    const dx = o.x - x, dz = o.z - z, q = (o.rz + rz) * 0.75;
    if (R > 0.5 && o.rx > 0.5 && dx * dx + dz * dz < q * q) return null;
  }
  if (near && taken(x, z, rx + 1)) return null;
  // Its foot: the lowest ground under it, then sunk a little.
  const c = baseHeight(x, z), qx = ax * rx * 0.7, qz = az * rx * 0.7, px = -az * rz * 0.7, pz = ax * rz * 0.7;
  const low = Math.min(c, baseHeight(x + qx, z + qz), baseHeight(x - qx, z - qz), baseHeight(x + px, z + pz), baseHeight(x - px, z - pz));
  const y0 = low - h * (0.06 + 0.12 * br);
  const wallH = h * stoneProfile(K.profile, T_WALL[K.profile]);
  return {
    x, z, ax, az, rx, rz, h, y0, shape, variant: Math.floor(vr * K.variants), tint: tr, wallH,
    hit: h >= MIN_HIT, cover: h >= MIN_COVER,
  };
}

function pickShape(r: () => number): number {
  let w = r() * SHAPE_WEIGHT, k = 0;
  while (k < STONE_SHAPES.length - 1 && (w -= STONE_SHAPES[k].weight) >= 0) k++;
  return k;
}

const NONE: Stone[] = [];

/** The stones of cell (ix, iz), cell (ix, iz) covering [ix·STONE_CELL, (ix+1)·STONE_CELL) on each axis. */
function cellStones(ix: number, iz: number): Stone[] {
  if (LAB) return NONE;
  const x0 = ix * STONE_CELL, z0 = iz * STONE_CELL;
  // How stony the cell is at its stoniest (a 3 × 3 look): none, none.
  let peak = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const s = stoniness(x0 + (0.17 + 0.33 * i) * STONE_CELL, z0 + (0.17 + 0.33 * j) * STONE_CELL);
    if (s > peak) peak = s;
  }
  if (peak < 0.01) return NONE;
  const r = rng(ix, iz);
  const cx = x0 + STONE_CELL / 2, cz = z0 + STONE_CELL / 2;
  const near = taken(cx, cz, STONE_CELL * 0.71 + STONE_R_MAX + 1);
  const n = Math.floor(N_MAX * peak + r());
  const out: Stone[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * STONE_CELL, z = z0 + r() * STONE_CELL;
    const keep = r(), u = r(), shape = pickShape(r);
    const s = stoniness(x, z);
    // Thinned to the stoniness here: as many as it calls for, wherever in the cell.
    if (keep * peak >= s) continue;
    // Mostly small; big ones only where it is stony (a cliff's foot, a canyon's floor).
    const R = 0.12 + (0.7 + 2.3 * s) * u * u * u * u;
    const st = makeStone(out, x, z, Math.min(R, STONE_R_MAX), shape, r, near);
    if (!st) continue;
    out.push(st);
    // A big one broke as it fell: chips and smaller stones round it.
    if (R > 0.8) {
      const m = Math.floor(r() * (1 + 3 * s));
      for (let j = 0; j < m; j++) {
        let dx = 1, dz = 0;
        for (let k = 0; k < 16; k++) {
          const a = 2 * r() - 1, b = 2 * r() - 1, q = a * a + b * b;
          if (q > 0.01 && q <= 1) { const l = Math.sqrt(q); dx = a / l; dz = b / l; break; }
        }
        const d = R * (1.05 + 1.3 * r()), Rc = R * (0.12 + 0.3 * r());
        const px = x + dx * d, pz = z + dz * d;
        if (px < x0 || px >= x0 + STONE_CELL || pz < z0 || pz >= z0 + STONE_CELL) { r(); continue; }
        const c = makeStone(out, px, pz, Rc, shape === SLAB ? BLOCK : shape, r, near);
        if (c) out.push(c);
      }
    }
  }
  return out;
}

/** The stones of cell (ix, iz) (cached). */
export const stonesIn = cellCache(8192, cellStones);

/** Height (m) of a stone's foot right now: it sinks or rises with the ground dug or piled at its centre. */
export function stoneFoot(st: Stone): number {
  return st.y0 + edits.sample(st.x, st.z);
}

/** The stone's hitbox at (x, z): writes how far the point is out from its centre in units of its rim (`t`, ≥ 1
 *  outside), the rim's distance (m) along that line (`rim`), and that distance (`d`). */
const hitOut = { t: 0, rim: 0, d: 0 };
function hitAt(st: Stone, dx: number, dz: number) {
  const u = (dx * st.ax + dz * st.az) / (st.rx * HIT), v = (dz * st.ax - dx * st.az) / (st.rz * HIT);
  const t = Math.sqrt(u * u + v * v), d = Math.sqrt(dx * dx + dz * dz);
  hitOut.t = t;
  hitOut.d = d;
  hitOut.rim = t > 1e-9 ? d / t : st.rz * HIT;
  return hitOut;
}

/**
 * Collide a mover (circle of `radius` at feet height y; prevY last tick's) with the stones round it. A stone whose
 * shoulder is within `stepUp` below the feet is ground: returns the highest such surface under the circle (or
 * -Infinity). Below its shoulder it is a wall: the position is pushed out to its rim and the velocity into it removed,
 * in place.
 */
export function collideStones(p: { x: number; z: number; vx: number; vz: number }, y: number, prevY: number, radius: number, stepUp: number): number {
  if (LAB) return -Infinity;
  let support = -Infinity;
  const feet = Math.max(y, prevY);
  const reach = STONE_R_MAX + radius;
  const j0 = Math.floor((p.z - reach) / STONE_CELL), j1 = Math.floor((p.z + reach) / STONE_CELL);
  const i0 = Math.floor((p.x - reach) / STONE_CELL), i1 = Math.floor((p.x + reach) / STONE_CELL);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const st of stonesIn(i, j)) {
        if (!st.hit) continue;
        const lim = st.rx + radius;
        let dx = p.x - st.x, dz = p.z - st.z;
        if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
        const { t, rim, d } = hitAt(st, dx, dz);
        if (d - radius >= rim) continue;
        const foot = stoneFoot(st);
        if (feet >= foot + st.wallH - stepUp) {
          // On it (or over its low flank): the highest of it under the circle.
          const tn = d > radius ? (d - radius) / rim : 0;
          const top = foot + st.h * stoneProfile(STONE_SHAPES[st.shape].profile, tn);
          if (top > support) support = top;
          continue;
        }
        // A wall: out to its rim, along the line from its centre.
        if (d > 1e-9) { dx /= d; dz /= d; } else { dx = st.az; dz = -st.ax; }
        const out = rim + radius;
        p.x = st.x + dx * out;
        p.z = st.z + dz * out;
        // The velocity into it (along the ellipse's normal there) is absorbed.
        const ru = t > 1e-9 ? 1 / (t * st.rx * st.rx * HIT * HIT) : 0, rv = t > 1e-9 ? 1 / (t * st.rz * st.rz * HIT * HIT) : 0;
        const a = dx * st.ax + dz * st.az, b = dz * st.ax - dx * st.az;
        let nx = a * ru * st.ax - b * rv * st.az, nz = a * ru * st.az + b * rv * st.ax;
        const nl = Math.sqrt(nx * nx + nz * nz);
        if (nl > 1e-12) { nx /= nl; nz /= nl; } else { nx = dx; nz = dz; }
        const vn = p.vx * nx + p.vz * nz;
        if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
      }
    }
  }
  return support;
}

/** A shot at (x, y, z) is stopped by a stone (one big enough for cover). */
export function stoneSolid(x: number, y: number, z: number): boolean {
  if (LAB) return false;
  const j0 = Math.floor((z - STONE_R_MAX) / STONE_CELL), j1 = Math.floor((z + STONE_R_MAX) / STONE_CELL);
  const i0 = Math.floor((x - STONE_R_MAX) / STONE_CELL), i1 = Math.floor((x + STONE_R_MAX) / STONE_CELL);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const st of stonesIn(i, j)) {
        if (!st.cover) continue;
        const dx = x - st.x, dz = z - st.z;
        if (dx > st.rx || dx < -st.rx || dz > st.rx || dz < -st.rx) continue;
        const { t } = hitAt(st, dx, dz);
        if (t >= 1) continue;
        const foot = stoneFoot(st);
        if (y < foot + st.h * stoneProfile(STONE_SHAPES[st.shape].profile, t) && y > foot - 0.5) return true;
      }
    }
  }
  return false;
}

// Shots stop in them (shotSolid in shared/terrain.ts). (shared/levels.ts imports this module: wherever there is a sim.)
addShotSolid(stoneSolid);

/** A stone with a hitbox reaches within r of (x, z): for keeping things dropped in the world (a broken bike, a cache)
 *  off them. */
export function stonesNear(x: number, z: number, r: number): boolean {
  if (LAB) return false;
  const m = r + STONE_R_MAX;
  for (let j = Math.floor((z - m) / STONE_CELL); j <= Math.floor((z + m) / STONE_CELL); j++) {
    for (let i = Math.floor((x - m) / STONE_CELL); i <= Math.floor((x + m) / STONE_CELL); i++) {
      for (const st of stonesIn(i, j)) {
        if (!st.hit) continue;
        const dx = x - st.x, dz = z - st.z, q = r + st.rx;
        if (dx * dx + dz * dz < q * q) return true;
      }
    }
  }
  return false;
}
