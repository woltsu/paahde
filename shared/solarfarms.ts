// Solar farms: old solar power towers, long abandoned, far out in the desert. A concrete tower over a hundred metres
// tall stands in the middle of a graded plain, its receiver up top, and round it ring after ring of heliostats: big
// mirrors on posts that once turned with the sun to throw its light onto the receiver. They froze where they were when
// the power went, still roughly aimed at the tower for the sun of that hour (so on the hour its light comes round to
// the same place, the receiver glows again: src/world/solarfarms.ts); some lie flat in their stow position, some hang
// broken, some are snapped off at the post, a few are gone. The mirrors are high enough to walk and ride under (their
// shade counts: shared/shade.ts), only the posts are in the way. Four access roads cross the field, and by the tower's
// foot a roofless control shed. Stashes lie in the shed, at the tower's foot and under the broken heliostats
// (server/loot.ts, SOLAR_STASHES); a pack of crawlers keeps each farm (server/guardians.ts).
//
// Shared by server physics and client prediction (collideSolar, solarCeiling in sim.ts), the terrain (the pad in
// baseHeight), the shade, the shots and the renderer (src/world/solarfarms.ts builds them from this layout).
//
// Same determinism rules as shared/rocks.ts: integer hashing and + - * /, Math.sqrt, Math.floor, Math.abs,
// Math.min/max only (the rings' angles go through sinPoly, a polynomial).
//
// Placement: the world is cut into SOLAR_CELL squares; a cell holds at most one farm (SOLAR_ODDS), none within
// SOLAR_MIN_R of the origin, on dunes gentle enough to grade, off the canyons and mud flats. The ground was cleared for
// it: no rocks stand within its reach (shared/rocks.ts makeRock asks solarWithin) and no shelters (shared/shelters.ts),
// so this module asks neither of them anything. Its pad and blend stay well inside its cell, so only the cell a point is
// in can hold a farm that reaches it. Everything in a farm is kept relative to its centre (x, z) and its pad's height y.

import { collideCapsules, type Capsule } from './capsules.ts';
import { ORIGIN } from './origin.ts';
import { duneHeight, WORLD_SEED } from './dunes.ts';
import { biome } from './biomes.ts';
import { cellId } from './cells.ts';
import { mulberry32 } from './noise.ts';
import { DECL, LAT } from './sun.ts';
import { LAB } from './world.ts';

/** Grid cell size (m): at most one farm per cell. */
export const SOLAR_CELL = 2800;
/** The odds a cell holds a farm. */
const SOLAR_ODDS = 0.6;
/** No farms this close to the origin (m): they are far out, a long ride from the pods. */
export const SOLAR_MIN_R = 2300;

/** The tower: radius at its foot and under the receiver, the shaft's top, the receiver (radius, bottom, top), the crown's top. */
export const TOWER = { r: 8.5, rTop: 6, shaft: 108, rRecv: 7.6, recv0: 108, recv1: 126, top: 132 };
/** Where the mirrors aim: the receiver's middle, over the pad. */
const AIM_Y = (TOWER.recv0 + TOWER.recv1) / 2;
/** The heliostat field: first and last ring (m from the tower), ring spacing, spacing along a ring. */
export const FIELD = { r0: 42, r1: 232, dr: 11.5, along: 9.6 };
/** The access roads' width (m): four, crossing at the tower, kept clear of heliostats. */
const ROAD_W = 10;
/** A heliostat: the post's radius and its top (the pivot) over the pad, the mirror's half width (along its tilt axis)
 *  and half height, its thickness. */
export const HELIO = { r: 0.24, pivot: 5.4, hw: 3.3, hh: 2.5, t: 0.12 };
/** The steepest a mirror tilts (least n.y): aimed ones, broken hanging ones. Keeps its low edge over 3 m. */
const MIN_NY = 0.55, HANG_NY = 0.35;
/** The flat pad (m from the centre) and how far it blends back into the dunes. */
export const PAD_R = FIELD.r1 + 20, PAD_BLEND = 80;
/** A farm reaches at most this far from its centre (m). */
export const SOLAR_REACH = PAD_R + PAD_BLEND;
/** A farm's centre stays this far inside its cell (m). */
const CELL_MARGIN = SOLAR_REACH + 30;
/** Most cut or fill the pad may need (m of dune height range under it). */
const MAX_RANGE = 26;

/** The control shed by the tower's foot, along the first road: its middle (m out from the tower), half width across the
 *  road and half depth along it, wall thickness and height, and the doorway's half width (in its outer wall). */
export const SHED = { at: 27, hw: 6, hd: 4, t: 0.4, h: 3.4, door: 1.3 };

/** A heliostat's state: aimed at the tower (as it froze), flat in its stow position, broken (the mirror hanging
 *  steep), snapped off at the post (no mirror). */
export const AIMED = 0, STOWED = 1, BROKEN = 2, SNAPPED = 3;
export type HelioState = typeof AIMED | typeof STOWED | typeof BROKEN | typeof SNAPPED;

export type Heliostat = {
  /** Farm-local position (m from the centre). */
  x: number; z: number;
  state: HelioState;
  /** The post's top over the pad (HELIO.pivot, or lower snapped). */
  post: number;
  /** Which of the mirror's four panels are still there (bits 0..3), 0 with no mirror. */
  panels: number;
  /** The mirror's unit normal (its face), its tilt axis (horizontal unit u) and up the mirror (v = n × u). */
  nx: number; ny: number; nz: number;
  ux: number; uz: number;
  vx: number; vy: number; vz: number;
};

export type SolarFarm = {
  id: number;
  /** World position of the tower's foot, `y` the pad's height. */
  x: number; y: number; z: number;
  /** The sun as it stood when the farm froze (unit, towards it; on its daily path, shared/sun.ts): the mirrors are aimed
   *  by it. */
  sx: number; sy: number; sz: number;
  /** The first road's direction (unit, horizontal); the others are at right angles. The shed stands along it. */
  rx: number; rz: number;
};

/** sin(a) for any a, to ~1e-9, from + - * / only (the same bits everywhere, unlike Math.sin). */
export function sinPoly(a: number): number {
  const TAU = 6.283185307179586, PI = 3.141592653589793, H = 1.5707963267948966;
  let x = a - Math.floor(a / TAU + 0.5) * TAU; // -π..π
  if (x > H) x = PI - x;
  else if (x < -H) x = -PI - x;
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
export const cosPoly = (a: number) => sinPoly(a + 1.5707963267948966);

/** Deterministic PRNG seeded from a cell (integer hashing only). */
function rng(ix: number, iz: number, salt: number) {
  return mulberry32(Math.imul(ix | 0, 0x2c1b3c6d) ^ Math.imul(iz | 0, 0x297a2d39) ^ Math.imul(WORLD_SEED, 0x85ebca6b) ^ salt);
}

/** A random horizontal unit vector (rejection sampled). */
function unit2(r: () => number): [number, number] {
  for (;;) {
    const a = r() * 2 - 1, b = r() * 2 - 1, d = a * a + b * b;
    if (d > 0.04 && d <= 1) {
      const l = Math.sqrt(d);
      return [a / l, b / l];
    }
  }
}

/** The hours a farm may have frozen at (time of day, 0..1): the sun well up. */
const FROZE = [0.36, 0.64];

/** The unit vector to the sun at time of day `tod`: shared/sun.ts skyVector(sunHourAngle(tod), DECL), in polynomials. */
function frozenSun(tod: number): { sx: number; sy: number; sz: number } {
  const sl = sinPoly(LAT), cl = cosPoly(LAT), sd = sinPoly(DECL), cd = cosPoly(DECL);
  const h = (tod - 0.5) * 6.283185307179586, ch = cosPoly(h);
  const up = sl * sd + cl * cd * ch, east = -cd * sinPoly(h), north = cl * sd - sl * cd * ch;
  const len = Math.sqrt(north * north + up * up + east * east);
  return { sx: -north / len, sy: up / len, sz: east / len };
}

// --- Placement ---

function cellFarm(ix: number, iz: number): SolarFarm | null {
  if (LAB) return null;
  const r = rng(ix, iz, 0x50ab);
  if (r() > SOLAR_ODDS) return null;
  const span = SOLAR_CELL - 2 * CELL_MARGIN;
  let best: SolarFarm | null = null, bestRange = MAX_RANGE;
  for (let tries = 0; tries < 12; tries++) {
    const x = Math.round(ix * SOLAR_CELL + CELL_MARGIN + span * r());
    const z = Math.round(iz * SOLAR_CELL + CELL_MARGIN + span * r());
    const bx = x - ORIGIN.x, bz = z - ORIGIN.z;
    if (bx * bx + bz * bz < SOLAR_MIN_R * SOLAR_MIN_R) continue;
    // No canyon or mud flat (the harvester's) anywhere in its reach; gentle enough to grade: the pad sits at the mean
    // dune height under it.
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0, mud = false;
    for (let lz = -SOLAR_REACH; lz <= SOLAR_REACH && !mud; lz += 24) {
      for (let lx = -SOLAR_REACH; lx <= SOLAR_REACH; lx += 24) {
        const d2 = lx * lx + lz * lz;
        if (d2 > SOLAR_REACH * SOLAR_REACH) continue;
        if (biome('mudflat', x + lx, z + lz) > 0 || biome('canyon', x + lx, z + lz) > 0) {
          mud = true;
          break;
        }
        if (d2 > PAD_R * PAD_R) continue;
        const h = duneHeight(x + lx, z + lz, WORLD_SEED, 0);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n++;
      }
    }
    if (mud || hi - lo >= bestRange) continue;
    bestRange = hi - lo;
    const [rx, rz] = unit2(r);
    best = { id: cellId(ix, iz), x, y: Math.round((sum / n) * 100) / 100, z, ...frozenSun(FROZE[0] + (FROZE[1] - FROZE[0]) * r()), rx, rz };
  }
  return best;
}

const cells = new Map<number, SolarFarm | null>();

function farmInCell(ix: number, iz: number): SolarFarm | null {
  const k = cellId(ix, iz);
  let f = cells.get(k);
  if (f === undefined) cells.set(k, (f = cellFarm(ix, iz)));
  return f;
}

/** The last cell solarAt looked in, and its farm: heightAt asks it for every sample, nearly always the same cell. */
let lastIx = NaN, lastIz = NaN, lastFarm: SolarFarm | null = null;

/** The farm that may reach world (x, z) (the one in its cell), or null. */
export function solarAt(x: number, z: number): SolarFarm | null {
  const ix = Math.floor(x / SOLAR_CELL), iz = Math.floor(z / SOLAR_CELL);
  if (ix !== lastIx || iz !== lastIz) {
    lastFarm = farmInCell(ix, iz);
    lastIx = ix;
    lastIz = iz;
  }
  return lastFarm;
}

/** Farms whose centre lies within `r` of (x, z). */
export function solarFarmsNear(x: number, z: number, r: number): SolarFarm[] {
  const out: SolarFarm[] = [];
  for (let iz = Math.floor((z - r) / SOLAR_CELL); iz <= Math.floor((z + r) / SOLAR_CELL); iz++) {
    for (let ix = Math.floor((x - r) / SOLAR_CELL); ix <= Math.floor((x + r) / SOLAR_CELL); ix++) {
      const f = farmInCell(ix, iz);
      if (f && (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < r * r) out.push(f);
    }
  }
  return out;
}

/** True if a farm or its pad may reach within `r` of (x, z): keeps scrap, wrecks and crash sites off them. */
export function solarWithin(x: number, z: number, r: number): boolean {
  return solarFarmsNear(x, z, SOLAR_REACH + r).length > 0;
}

// --- Terrain ---

/** Terrain height with the farms' pads: `h` graded flat to the pad's height round a farm. */
export function withSolarPad(x: number, z: number, h: number): number {
  const f = solarAt(x, z);
  if (!f) return h;
  const dx = x - f.x, dz = z - f.z, d2 = dx * dx + dz * dz;
  if (d2 <= PAD_R * PAD_R) return f.y;
  if (d2 >= SOLAR_REACH * SOLAR_REACH) return h;
  let t = (Math.sqrt(d2) - PAD_R) / PAD_BLEND;
  t = t * t * (3 - 2 * t);
  return f.y + (h - f.y) * t;
}

// --- The layout: heliostats, the shed, the capsules ---

export type FarmLayout = {
  helio: Heliostat[];
  /** What collides (farm-local, heights over the pad), by grid cell (cellKey): the posts, the tower, the shed's walls. */
  grid: Map<number, Capsule[]>;
  /** Heliostats by grid cell (cellKey), for the mirrors' ceiling and shade. */
  mirrors: Map<number, Heliostat[]>;
  /** The shed's walls (farm-local capsules). */
  shed: Capsule[];
};

/** Grid cells (m) the layout is kept in. */
const GRID = 16;
/** Capsules are filed in every cell within this margin of them (more than any body's radius), so a body only looks
 *  in its own cell. Mirrors likewise, by their reach. */
const GRID_MARGIN = 2;
const cellKey = (ix: number, iz: number) => (ix + 64) * 128 + (iz + 64);

/** World offset of local (along, across) in the shed's frame: along the first road (rx, rz), across to its left. */
export function roadToLocal(f: SolarFarm, along: number, across: number): [number, number] {
  return [f.rx * along - f.rz * across, f.rz * along + f.rx * across];
}

function fileInGrid<T>(grid: Map<number, T[]>, x0: number, z0: number, x1: number, z1: number, item: T) {
  for (let iz = Math.floor(z0 / GRID); iz <= Math.floor(z1 / GRID); iz++) {
    for (let ix = Math.floor(x0 / GRID); ix <= Math.floor(x1 / GRID); ix++) {
      const k = cellKey(ix, iz);
      const l = grid.get(k);
      if (l) l.push(item);
      else grid.set(k, [item]);
    }
  }
}

function buildLayout(f: SolarFarm): FarmLayout {
  const r = mulberry32(f.id ^ Math.imul(WORLD_SEED, 0x9e3779b1) ^ 0x7a11);
  const helio: Heliostat[] = [];
  const half = ROAD_W / 2;
  const onRoad = (lx: number, lz: number) => {
    const a = lx * f.rx + lz * f.rz, b = lx * f.rz - lz * f.rx;
    return Math.abs(a) < half || Math.abs(b) < half;
  };
  const rings = Math.floor((FIELD.r1 - FIELD.r0) / FIELD.dr) + 1;
  for (let k = 0; k < rings; k++) {
    const rad = FIELD.r0 + k * FIELD.dr;
    const n = Math.floor((6.283185307179586 * rad) / FIELD.along);
    const a0 = (k % 2) * (3.141592653589793 / n) + r() * 0.01;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * 6.283185307179586) / n;
      const x = Math.round(sinPoly(a) * rad * 1000) / 1000, z = Math.round(cosPoly(a) * rad * 1000) / 1000;
      if (onRoad(x, z)) continue;
      const u = r();
      if (u < 0.04) continue; // gone: nothing left but its footing in the sand
      const state: HelioState = u < 0.74 ? AIMED : u < 0.82 ? STOWED : u < 0.93 ? BROKEN : SNAPPED;
      let nx = 0, ny = 1, nz = 0;
      if (state === AIMED) {
        // Half way between the sun of that hour and the receiver, a little off after the years.
        const tx = -x, ty = AIM_Y - HELIO.pivot, tz = -z, tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        nx = f.sx + tx / tl + (r() - 0.5) * 0.08;
        ny = f.sy + ty / tl;
        nz = f.sz + tz / tl + (r() - 0.5) * 0.08;
      } else if (state === STOWED) {
        nx = (r() - 0.5) * 0.06;
        nz = (r() - 0.5) * 0.06;
      } else if (state === BROKEN) {
        const [hx, hz] = unit2(r);
        nx = hx;
        ny = 0.1;
        nz = hz;
      }
      let l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const least = state === BROKEN ? HANG_NY : MIN_NY;
      if (ny < least) {
        // Tilted no steeper than that: the low edge stays over a rider's head.
        const h = Math.sqrt(nx * nx + nz * nz), k2 = Math.sqrt(1 - least * least) / h;
        nx *= k2;
        nz *= k2;
        ny = least;
      }
      // The tilt axis lies flat, across the way the mirror faces; up the mirror is n × u.
      let ux = -nz, uz = nx;
      l = Math.sqrt(ux * ux + uz * uz);
      if (l < 1e-6) {
        ux = 1;
        uz = 0;
      } else {
        ux /= l;
        uz /= l;
      }
      const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
      const panels = state === SNAPPED ? 0 : state === BROKEN ? (1 + Math.floor(r() * 15)) : r() < 0.12 ? 15 & ~(1 << Math.floor(r() * 4)) : 15;
      const post = state === SNAPPED ? 1.2 + r() * 1.6 : HELIO.pivot;
      helio.push({ x, z, state, post, panels, nx, ny, nz, ux, uz, vx, vy, vz });
    }
  }

  const grid = new Map<number, Capsule[]>(), mirrors = new Map<number, Heliostat[]>();
  const file = (c: Capsule) => {
    const ex = Math.abs(c.ax) * c.half + c.r + GRID_MARGIN, ez = Math.abs(c.az) * c.half + c.r + GRID_MARGIN;
    fileInGrid(grid, c.x - ex, c.z - ez, c.x + ex, c.z + ez, c);
  };
  for (const h of helio) {
    file({ x: h.x, z: h.z, ax: 1, az: 0, half: 0, r: HELIO.r, y0: -Infinity, top: h.post });
    if (h.panels) {
      const m = HELIO.hw + GRID_MARGIN;
      fileInGrid(mirrors, h.x - m, h.z - m, h.x + m, h.z + m, h);
    }
  }
  file({ x: 0, z: 0, ax: 1, az: 0, half: 0, r: TOWER.r, y0: -Infinity, top: TOWER.top });
  // The shed: four walls, a doorway in the outer one (facing out along the road). Its roof fell in long ago.
  const shed: Capsule[] = [];
  const wall = (a0: number, b0: number, a1: number, b1: number) => {
    const [x0, z0] = roadToLocal(f, a0, b0), [x1, z1] = roadToLocal(f, a1, b1);
    const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz);
    shed.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, ax: dx / len, az: dz / len, half: len / 2, r: SHED.t / 2, y0: -Infinity, top: SHED.h });
  };
  const { at, hw, hd, door } = SHED, n0 = at - hd, n1 = at + hd;
  wall(n0, -hw, n0, hw);
  wall(n0, -hw, n1, -hw);
  wall(n0, hw, n1, hw);
  wall(n1, -hw, n1, -door);
  wall(n1, door, n1, hw);
  for (const c of shed) file(c);
  return { helio, grid, mirrors, shed };
}

const layouts = new Map<number, FarmLayout>();
/** A farm's heliostats, shed and what collides, made the first time they're needed (a few at most are kept). */
export function farmLayout(f: SolarFarm): FarmLayout {
  let l = layouts.get(f.id);
  if (!l) {
    if (layouts.size >= 6) layouts.delete(layouts.keys().next().value!);
    layouts.set(f.id, (l = buildLayout(f)));
  }
  return l;
}

/** The farm whose field world (x, z) is in (+ margin), or null. */
function fieldAt(x: number, z: number, margin: number): SolarFarm | null {
  const f = solarAt(x, z);
  if (!f) return null;
  const dx = x - f.x, dz = z - f.z, m = FIELD.r1 + HELIO.hw + margin;
  return dx * dx + dz * dz < m * m ? f : null;
}

// --- Collision ---

const local = { x: 0, z: 0, vx: 0, vz: 0 };

/**
 * Collide a player (world position p, moved in place, velocity absorbed) with a farm's posts, tower and shed: `y`/`prevY`
 * are the feet heights (world) this and last tick. Returns the height (world) of what the player stands on (a snapped
 * post's top), or -Infinity.
 */
export function collideSolar(p: { x: number; z: number; vx: number; vz: number }, y: number, prevY: number, radius: number, height: number, stepUp: number): number {
  const f = fieldAt(p.x, p.z, 2);
  if (!f) return -Infinity;
  const q = local;
  q.x = p.x - f.x;
  q.z = p.z - f.z;
  const caps = farmLayout(f).grid.get(cellKey(Math.floor(q.x / GRID), Math.floor(q.z / GRID)));
  if (!caps) return -Infinity;
  q.vx = p.vx;
  q.vz = p.vz;
  const feet = Math.max(y, prevY) - f.y, head = Math.min(y, prevY) - f.y + height;
  const support = collideCapsules(q, caps, feet, head, radius, stepUp, -Infinity);
  p.x = f.x + q.x;
  p.z = f.z + q.z;
  p.vx = q.vx;
  p.vz = q.vz;
  return support === -Infinity ? support : support + f.y;
}

/** Height (farm-local, over the pad) of mirror h's underside straight over farm-local (lx, lz), or Infinity when (lx, lz)
 *  isn't under it. */
function mirrorUnder(h: Heliostat, lx: number, lz: number): number {
  const dx = lx - h.x, dz = lz - h.z;
  // Where the vertical line meets the mirror's plane, and that point in the mirror's own axes.
  const dy = -(h.nx * dx + h.nz * dz) / h.ny;
  const a = dx * h.ux + dz * h.uz, b = dx * h.vx + dy * h.vy + dz * h.vz;
  if (Math.abs(a) > HELIO.hw || Math.abs(b) > HELIO.hh) return Infinity;
  return HELIO.pivot + dy - HELIO.t / h.ny;
}

/** Highest the feet may go at world (x, z) for a player of this height whose feet were at `prevY`, or Infinity: under the
 *  mirror over them (you can't jump up through one). */
export function solarCeiling(x: number, z: number, prevY: number, height: number): number {
  const f = fieldAt(x, z, 0);
  if (!f) return Infinity;
  const lx = x - f.x, lz = z - f.z;
  const list = farmLayout(f).mirrors.get(cellKey(Math.floor(lx / GRID), Math.floor(lz / GRID)));
  if (!list) return Infinity;
  const feet = prevY - f.y;
  let c = Infinity;
  for (const h of list) {
    const u = mirrorUnder(h, lx, lz);
    if (u < c && u > feet + 0.5) c = u;
  }
  return c === Infinity ? c : c + f.y - height;
}

/** What a shot meets at world (x, y, z) at a farm: true in the tower or a shed wall, null elsewhere. */
export function solarSolid(x: number, y: number, z: number): boolean | null {
  const f = solarAt(x, z);
  if (!f) return null;
  const lx = x - f.x, lz = z - f.z, ly = y - f.y;
  if (lx * lx + lz * lz > (SHED.at + SHED.hd + SHED.hw + 2) * (SHED.at + SHED.hd + SHED.hw + 2)) return null;
  const rt = TOWER.r + ((TOWER.rTop - TOWER.r) * Math.max(0, Math.min(ly, TOWER.shaft))) / TOWER.shaft;
  if (ly < TOWER.top && ly > -2 && lx * lx + lz * lz < rt * rt) return true;
  if (ly < SHED.h && ly > -2) {
    for (const c of farmLayout(f).shed) {
      let t = (lx - c.x) * c.ax + (lz - c.z) * c.az;
      t = Math.max(-c.half, Math.min(c.half, t));
      const ex = lx - c.x - c.ax * t, ez = lz - c.z - c.az * t;
      if (ex * ex + ez * ez < c.r * c.r) return true;
    }
  }
  return null;
}

/** Near a farm's tower and shed (shots step finely there). */
export function nearSolarBuildings(x: number, z: number): boolean {
  const f = solarAt(x, z);
  if (!f) return false;
  const lx = x - f.x, lz = z - f.z, m = SHED.at + SHED.hd + SHED.hw + 4;
  return lx * lx + lz * lz < m * m;
}

/** Too close to a farm's posts, tower or shed to put something up (margin m round them), at world (x, z). */
export function solarBlocked(x: number, z: number, margin: number): boolean {
  const f = fieldAt(x, z, margin);
  if (!f) return false;
  const lx = x - f.x, lz = z - f.z;
  const caps = farmLayout(f).grid.get(cellKey(Math.floor(lx / GRID), Math.floor(lz / GRID)));
  if (!caps) return false;
  for (const c of caps) {
    let t = (lx - c.x) * c.ax + (lz - c.z) * c.az;
    t = Math.max(-c.half, Math.min(c.half, t));
    const ex = lx - c.x - c.ax * t, ez = lz - c.z - c.az * t, rr = c.r + margin;
    if (ex * ex + ez * ez < rr * rr) return true;
  }
  return false;
}

// --- Shade ---

/** A mirror's four corners (world), for heliostat h of farm f. */
export function mirrorCorners(f: SolarFarm, h: Heliostat): { x: number; y: number; z: number }[] {
  const cx = f.x + h.x, cy = f.y + HELIO.pivot, cz = f.z + h.z;
  const corner = (a: number, b: number) => ({
    x: cx + h.ux * a + h.vx * b, y: cy + h.vy * b, z: cz + h.uz * a + h.vz * b,
  });
  return [corner(-HELIO.hw, -HELIO.hh), corner(HELIO.hw, -HELIO.hh), corner(HELIO.hw, HELIO.hh), corner(-HELIO.hw, HELIO.hh)];
}

/** The heliostats with mirrors within `r` of world (x, z) (whole cells of them), with their farm. */
export function mirrorsNear(x: number, z: number, r: number): { f: SolarFarm; h: Heliostat }[] {
  const f = fieldAt(x, z, r);
  if (!f) return [];
  const lx = x - f.x, lz = z - f.z, { mirrors } = farmLayout(f), out: { f: SolarFarm; h: Heliostat }[] = [];
  const seen = new Set<Heliostat>();
  for (let iz = Math.floor((lz - r) / GRID); iz <= Math.floor((lz + r) / GRID); iz++) {
    for (let ix = Math.floor((lx - r) / GRID); ix <= Math.floor((lx + r) / GRID); ix++) {
      for (const h of mirrors.get(cellKey(ix, iz)) ?? []) {
        if (seen.has(h)) continue;
        seen.add(h);
        out.push({ f, h });
      }
    }
  }
  return out;
}

// --- Loot ---

/** The farms within this of the origin (m) are stocked with stashes (server/loot.ts): the ones a journey reaches. */
export const SOLAR_LOOT_R = 6000;

/** The farms stocked with stashes (SOLAR_LOOT_R). */
export const stockedFarms = () => solarFarmsNear(ORIGIN.x, ORIGIN.z, SOLAR_LOOT_R);

/** A random spot for a stash at farm f (`rand` 0..1): in the shed, at the tower's foot, or under a broken heliostat. */
export function solarLootSpot(f: SolarFarm, rand: () => number): { x: number; z: number } {
  const u = rand();
  if (u < 0.45) {
    const [ox, oz] = roadToLocal(f, SHED.at + (rand() * 2 - 1) * (SHED.hd - 0.8), (rand() * 2 - 1) * (SHED.hw - 0.8));
    return { x: f.x + ox, z: f.z + oz };
  }
  if (u < 0.65) {
    // At the tower's foot, off the roads' mouths a little.
    const [hx, hz] = unit2(rand), d = TOWER.r + 1.2 + rand() * 1.5;
    return { x: f.x + hx * d, z: f.z + hz * d };
  }
  const broken = farmLayout(f).helio.filter((h) => h.state === BROKEN || h.state === SNAPPED);
  const h = broken[Math.floor(rand() * broken.length)];
  const [hx, hz] = unit2(rand), d = 1 + rand() * 1.5;
  return { x: f.x + h.x + hx * d, z: f.z + h.z + hz * d };
}
