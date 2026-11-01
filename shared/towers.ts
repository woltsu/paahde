// Radio towers (docs/radiotowers.md): huge abandoned telecom towers standing here and there on high ground, a triangular
// steel lattice tapering from a 16 m base to the top deck 120 m up, a mast over it with an aviation lamp. A caged
// ladder runs straight up inside it, through hatches in two rest decks (40 m, 80 m: the dish deck) to the top deck;
// the radio's cabinet stands at its foot. You climb it (the ladder is in shared/sim.ts, read through the desert level's
// `ladder`, shared/levels.ts), stand on its decks (ground for feet that were over them), and fix it: its parts are fitted
// at the cabinet, the dish deck and the top deck (server/towers.ts).
//
// Shared by server physics and client prediction (collideTowers, towerGround, towerLadder), the terrain (the pad in
// baseHeight), the shots and the renderer (src/world/towers.ts builds them from these numbers).
//
// Same determinism rules as shared/rocks.ts: integer hashing and + - * /, Math.sqrt, Math.floor, Math.abs,
// Math.min/max only.
//
// Placement: the world is cut into TOWER_CELL squares; a cell holds at most one tower (TOWER_ODDS), none within
// TOWER_MIN_R of the origin, none in a biome without them (`towers: false` in shared/biomes.ts, or `empty`) or on a
// solar farm's ground. Of a few
// spots in the cell it takes the highest whose ground is even enough to pad (a dune's crest, a low rise of rock), so
// it stands against the sky. Only the dunes, rocks and canyons (shared/terrain.ts groundAt) are asked, so nothing calls
// back into it; scrap, crash sites, wrecks and shelters keep off it (towerWithin), and its reach stays well inside its
// cell, so only the cell a point is in can hold a tower that reaches it.

import { collideCapsules, type Capsule } from './capsules.ts';
import { ORIGIN } from './origin.ts';
import { WORLD_SEED } from './dunes.ts';
import { BIOMES, biome } from './biomes.ts';
import { cellId, cellOf } from './cells.ts';
import { mulberry32 } from './noise.ts';
import { groundAt } from './terrain.ts';
import { solarWithin } from './solarfarms.ts';
import { LAB } from './world.ts';

/** Grid cell size (m): at most one tower per cell. */
export const TOWER_CELL = 1800;
/** The odds a cell holds a tower. */
const TOWER_ODDS = 0.5;
/** No towers this close to the origin (m). */
export const TOWER_MIN_R = 800;

const SQRT3 = 1.7320508075688772;
/** The lattice: the triangle's side at the foot and at the top deck (m), the top deck's height, the mast over it and
 *  the lamp on the mast's tip, the legs' radius. */
export const TOWER = { base: 16, top: 4, height: 120, mast: 22, legR: 0.32 };
/** The lamp's height over the pad. */
export const LAMP_Y = TOWER.height + TOWER.mast;
/** The decks' heights over the pad: a rest deck, the dish deck, the top deck. */
export const DECKS = [40, 80, TOWER.height] as const;
export const DISH_DECK = 1, TOP_DECK = 2;
/** How far a deck's floor reaches past the legs (m, on the circumradius), the top deck's further (the antennas' ring). */
const DECK_OUT = 1.2, TOP_OUT = 3.4;
/** Rails round a deck's edge: height over the floor, radius. */
export const RAIL = { h: 1.1, r: 0.05 };
/** The ladder: its column's middle (m out from the tower's axis, towards the first leg) and the column's half width
 *  (the hatches in the decks are the same square). */
export const LADDER = { at: 1.05, half: 0.55 };
/** Up and down the ladder, and sideways on it (m/s). */
export const CLIMB_SPEED = 2.6, CLIMB_SIDE = 1.4;
/** The radio cabinet at the foot: its middle (m from the axis, away from the ladder), half width and half depth, height. */
export const CABINET = { at: -3.2, hw: 0.8, hd: 0.45, h: 2.1 };
/** The mast's radius. */
export const MAST_R = 0.28;

/** The flat pad (m from the axis) and how far it blends back into the ground. */
export const PAD_R = 13, PAD_BLEND = 16;
/** A tower reaches at most this far from its axis (m). */
export const TOWER_REACH = PAD_R + PAD_BLEND;
/** A tower stays this far inside its cell (m): two in neighbouring cells stand at least twice this apart. */
const CELL_MARGIN = 400;
/** Most cut or fill the pad may need (m of ground height range under it). */
const MAX_RANGE = 4;

/** Circumradius of the lattice's triangle at height h over the pad (m). */
export function legRadius(h: number): number {
  const t = Math.max(0, Math.min(1, h / TOWER.height));
  return (TOWER.base + (TOWER.top - TOWER.base) * t) / SQRT3;
}
/** Circumradius of deck k's floor. */
export function deckRadius(k: number): number {
  return legRadius(DECKS[k]) + (k === TOP_DECK ? TOP_OUT : DECK_OUT);
}

export type Tower = {
  id: number;
  /** World position of the tower's axis at the foot, `y` the pad's height. */
  x: number; y: number; z: number;
  /** The first leg's direction from the axis (unit, horizontal): the ladder is on its side. (vx, vz) = (-uz, ux). */
  ux: number; uz: number;
  /** Its seeded look and state, 0..1 each: which parts start missing and how worn the rest (server/towers.ts), the
   *  dishes' and panels' damage (src/world/towers.ts). */
  seed: number;
};

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

/** True where no tower may stand: a biome without them. */
function noTowers(x: number, z: number): boolean {
  for (const b of BIOMES) if ((b.empty || b.towers === false) && biome(b.id, x, z) > 0) return true;
  return false;
}

// --- Placement ---

function cellTower(ix: number, iz: number): Tower | null {
  if (LAB) return null;
  const r = rng(ix, iz, 0x7e3a);
  if (r() > TOWER_ODDS) return null;
  const span = TOWER_CELL - 2 * CELL_MARGIN;
  let best: Tower | null = null, bestY = -Infinity;
  for (let tries = 0; tries < 14; tries++) {
    const x = Math.round(ix * TOWER_CELL + CELL_MARGIN + span * r());
    const z = Math.round(iz * TOWER_CELL + CELL_MARGIN + span * r());
    const bx = x - ORIGIN.x, bz = z - ORIGIN.z;
    if (bx * bx + bz * bz < TOWER_MIN_R * TOWER_MIN_R) continue;
    // Even enough to pad, and out of the biomes without towers anywhere in its reach. The pad sits at the mean height
    // under it (a crest is cut down a little, a hollow filled).
    if (solarWithin(x, z, TOWER_REACH)) continue;
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0, bad = false, i = 0;
    for (let lz = -TOWER_REACH; lz <= TOWER_REACH && !bad; lz += 4) {
      for (let lx = -TOWER_REACH; lx <= TOWER_REACH; lx += 4) {
        const d2 = lx * lx + lz * lz;
        if (d2 > TOWER_REACH * TOWER_REACH) continue;
        if (i++ % 5 === 0 && noTowers(x + lx, z + lz)) {
          bad = true;
          break;
        }
        if (d2 > PAD_R * PAD_R) continue;
        const g = groundAt(x + lx, z + lz), h = Math.max(g.sand, g.rock);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n++;
      }
    }
    if (bad || hi - lo >= MAX_RANGE) continue;
    const y = sum / n;
    if (y <= bestY) continue;
    bestY = y;
    const [ux, uz] = unit2(r);
    best = { id: cellId(ix, iz), x, y: Math.round(y * 100) / 100, z, ux, uz, seed: r() };
  }
  return best;
}

const cells = new Map<number, Tower | null>();

function towerInCell(ix: number, iz: number): Tower | null {
  const k = cellId(ix, iz);
  let t = cells.get(k);
  if (t === undefined) cells.set(k, (t = cellTower(ix, iz)));
  return t;
}

/** The last cell towerAt looked in, and its tower: heightAt asks it for every sample, nearly always the same cell. */
let lastIx = NaN, lastIz = NaN, lastTower: Tower | null = null;

/** The tower that may reach world (x, z) (the one in its cell), or null. */
export function towerAt(x: number, z: number): Tower | null {
  const ix = Math.floor(x / TOWER_CELL), iz = Math.floor(z / TOWER_CELL);
  if (ix !== lastIx || iz !== lastIz) {
    lastTower = towerInCell(ix, iz);
    lastIx = ix;
    lastIz = iz;
  }
  return lastTower;
}

/** Towers whose axis lies within `r` of (x, z). */
export function towersNear(x: number, z: number, r: number): Tower[] {
  const out: Tower[] = [];
  for (let iz = Math.floor((z - r) / TOWER_CELL); iz <= Math.floor((z + r) / TOWER_CELL); iz++) {
    for (let ix = Math.floor((x - r) / TOWER_CELL); ix <= Math.floor((x + r) / TOWER_CELL); ix++) {
      const t = towerInCell(ix, iz);
      if (t && (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < r * r) out.push(t);
    }
  }
  return out;
}

/** The tower with this id (its cell's id), or null. */
export function towerById(id: number): Tower | null {
  const c = cellOf(id);
  return c ? towerInCell(c.ix, c.iz) : null;
}

/** True if a tower or its pad may reach within `r` of (x, z): keeps scrap, wrecks, crash sites and shelters off them. */
export function towerWithin(x: number, z: number, r: number): boolean {
  return towersNear(x, z, TOWER_REACH + r).length > 0;
}

// --- Terrain ---

/** Terrain height with the towers' pads: `h` graded flat to the pad's height round a tower. */
export function withTowerPad(x: number, z: number, h: number): number {
  const t = towerAt(x, z);
  if (!t) return h;
  const dx = x - t.x, dz = z - t.z, d2 = dx * dx + dz * dz;
  if (d2 <= PAD_R * PAD_R) return t.y;
  if (d2 >= TOWER_REACH * TOWER_REACH) return h;
  let k = (Math.sqrt(d2) - PAD_R) / PAD_BLEND;
  k = k * k * (3 - 2 * k);
  return t.y + (h - t.y) * k;
}

// --- The frame: legs, decks, ladder ---

/** World offset of tower-local (a, b): a along the first leg's direction, b across it (to its left). */
export function towerToWorld(t: Tower, a: number, b: number): [number, number] {
  return [t.ux * a - t.uz * b, t.uz * a + t.ux * b];
}
/** Tower-local (a, b) of world (x, z). */
function local(t: Tower, x: number, z: number): [number, number] {
  const dx = x - t.x, dz = z - t.z;
  return [dx * t.ux + dz * t.uz, -dx * t.uz + dz * t.ux];
}

/** The legs' directions in the local frame (unit): 0°, 120°, 240°. */
export const LEG_DIRS: readonly (readonly [number, number])[] = [[1, 0], [-0.5, SQRT3 / 2], [-0.5, -SQRT3 / 2]];

/** Is local (a, b) inside the equilateral triangle of circumradius R with a vertex along +a? */
function inTriangle(a: number, b: number, R: number): boolean {
  const ri = R / 2; // inradius
  return a >= -ri && 0.5 * a + (SQRT3 / 2) * b <= ri && 0.5 * a - (SQRT3 / 2) * b <= ri;
}

/** In the ladder's column (local)? */
function inColumn(a: number, b: number): boolean {
  return Math.abs(a - LADDER.at) <= LADDER.half && Math.abs(b) <= LADDER.half;
}

/** The capsules (tower-local, heights over the pad): the legs in short straight pieces, the mast, the deck rails, the
 *  cabinet. The same for every tower. */
const FRAME: Capsule[] = (() => {
  const caps: Capsule[] = [];
  const PIECE = 4;
  for (const [da, db] of LEG_DIRS) {
    for (let y0 = -1; y0 < TOWER.height; y0 += PIECE) {
      const y1 = Math.min(TOWER.height + 1.2, y0 + PIECE), R = legRadius((y0 + y1) / 2);
      // The leg leans in a little over a piece: its radius covers the lean.
      const lean = (legRadius(y0) - legRadius(y1)) / 2;
      caps.push({ x: da * R, z: db * R, ax: 1, az: 0, half: 0, r: TOWER.legR + lean, y0, top: y1 });
    }
  }
  caps.push({ x: 0, z: 0, ax: 1, az: 0, half: 0, r: MAST_R, y0: TOWER.height, top: LAMP_Y });
  DECKS.forEach((y, k) => {
    const R = deckRadius(k);
    for (let i = 0; i < 3; i++) {
      const [a0, b0] = LEG_DIRS[i], [a1, b1] = LEG_DIRS[(i + 1) % 3];
      const x0 = a0 * R, z0 = b0 * R, x1 = a1 * R, z1 = b1 * R, len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
      caps.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, ax: (x1 - x0) / len, az: (z1 - z0) / len, half: len / 2, r: RAIL.r, y0: y + 0.1, top: y + RAIL.h });
    }
  });
  caps.push({ x: CABINET.at, z: 0, ax: 0, az: 1, half: CABINET.hw - CABINET.hd, r: CABINET.hd, y0: -Infinity, top: CABINET.h });
  return caps;
})();

/** The tower whose frame world (x, z) is in (+ margin), or null. */
function frameAt(x: number, z: number, margin: number): Tower | null {
  const t = towerAt(x, z);
  if (!t) return null;
  const dx = x - t.x, dz = z - t.z, m = deckRadius(TOP_DECK) + 2 + margin;
  const m0 = legRadius(0) + 2 + margin, mm = Math.max(m, m0);
  return dx * dx + dz * dz < mm * mm ? t : null;
}

// --- Collision ---

const q = { x: 0, z: 0, vx: 0, vz: 0 };

/**
 * Collide a mover (world position p, moved in place, velocity absorbed) with a tower's legs, mast, rails and cabinet:
 * `y`/`prevY` are the feet heights (world) this and last tick. Returns the height (world) of what it stands on (the
 * cabinet's top), or -Infinity. The bracing between the legs doesn't collide: you pass between it.
 */
export function collideTowers(p: { x: number; z: number; vx: number; vz: number }, y: number, prevY: number, radius: number, height: number, stepUp: number): number {
  const t = frameAt(p.x, p.z, radius);
  if (!t) return -Infinity;
  const [a, b] = local(t, p.x, p.z);
  q.x = a;
  q.z = b;
  q.vx = p.vx * t.ux + p.vz * t.uz;
  q.vz = -p.vx * t.uz + p.vz * t.ux;
  const feet = Math.max(y, prevY) - t.y, head = Math.min(y, prevY) - t.y + height;
  const support = collideCapsules(q, FRAME, feet, head, radius, stepUp, -Infinity);
  const [wx, wz] = towerToWorld(t, q.x, q.z);
  p.x = t.x + wx;
  p.z = t.z + wz;
  p.vx = q.vx * t.ux - q.vz * t.uz;
  p.vz = q.vx * t.uz + q.vz * t.ux;
  return support === -Infinity ? support : support + t.y;
}

/** The deck under world (x, z) for feet that were at prevY (on it or above it), as ground (world height), or
 *  -Infinity. The hatch where the ladder comes through is open. */
export function towerGround(x: number, z: number, prevY: number): number {
  const t = frameAt(x, z, 0);
  if (!t) return -Infinity;
  const [a, b] = local(t, x, z);
  if (inColumn(a, b)) return -Infinity;
  const feet = prevY - t.y;
  for (let k = DECKS.length - 1; k >= 0; k--) {
    const y = DECKS[k];
    if (feet >= y - 0.3 && inTriangle(a, b, deckRadius(k))) return t.y + y;
  }
  return -Infinity;
}

/** The ladder at world (x, y, z): its foot and top (world heights) while (x, z) is in its column and y on its length,
 *  else null. */
export function towerLadder(x: number, y: number, z: number): { bottom: number; top: number } | null {
  const t = frameAt(x, z, 0);
  if (!t) return null;
  const [a, b] = local(t, x, z);
  if (!inColumn(a, b)) return null;
  const h = y - t.y;
  if (h < -0.5 || h > TOWER.height + 0.3) return null;
  return { bottom: t.y, top: t.y + TOWER.height };
}

/** On a ladder at world (x, y, z) (off its foot): the facing (as PlayerState.facing) that looks at its rungs, else null. */
export function ladderFacing(x: number, y: number, z: number): number | null {
  const lad = towerLadder(x, y, z), t = lad && towerAt(x, z);
  if (!lad || !t || y < lad.bottom + 0.05) return null;
  // The rungs are on the column's side towards the axis: look along -u, (-sin f, -cos f) = (-ux, -uz).
  return Math.atan2(t.ux, t.uz);
}

/** What a shot meets at world (x, y, z) at a tower: true in a leg, the mast or the cabinet, null elsewhere. */
export function towerSolid(x: number, y: number, z: number): boolean | null {
  const t = frameAt(x, z, 0);
  if (!t) return null;
  const h = y - t.y;
  if (h < -2 || h > LAMP_Y) return null;
  const [a, b] = local(t, x, z);
  if (h < CABINET.h && Math.abs(a - CABINET.at) < CABINET.hd && Math.abs(b) < CABINET.hw) return true;
  if (h > TOWER.height) return a * a + b * b < MAST_R * MAST_R ? true : null;
  const R = legRadius(h), rr = TOWER.legR * TOWER.legR;
  for (const [da, db] of LEG_DIRS) {
    const ea = a - da * R, eb = b - db * R;
    if (ea * ea + eb * eb < rr) return true;
  }
  return null;
}

/** Near a tower's frame (shots step finely there). */
export function nearTower(x: number, z: number): boolean {
  return frameAt(x, z, 1) !== null;
}

/** Too close to a tower's frame to put something up (margin m round it), at world (x, z). */
export function towerBlocked(x: number, z: number, margin: number): boolean {
  const t = frameAt(x, z, margin);
  if (!t) return false;
  const [a, b] = local(t, x, z), r = legRadius(0) + 1 + margin;
  return a * a + b * b < r * r;
}

// --- Places on the tower ---

/** Where the parts are fitted (server/towers.ts): at the cabinet, in the dish deck's junction box, in the top deck's feed
 *  box. Tower-local (a, b) and height over the pad of where you stand to reach each. */
export const SPOTS = [
  { key: 'cabinet', a: CABINET.at + CABINET.hd + 0.7, b: 0, y: 0 },
  { key: 'dish', a: -1.2, b: 0, y: DECKS[DISH_DECK] },
  { key: 'feed', a: -1.6, b: 0, y: DECKS[TOP_DECK] },
] as const;
export type SpotKey = (typeof SPOTS)[number]['key'];
/** The fixture fitted at each spot (shared/gear.ts GEAR): the radio, the dish drive, the antenna feed. */
export const SPOT_ITEMS = ['tower_radio', 'tower_dish', 'tower_feed'] as const;
/** What a live tower's radio draws from its battery (W, game time: shared/power.ts GAME_SPEED): a receiver, not a
 *  transmitter. A Scrap battery (0.6 kWh) runs it some 150 game hours, three real ones. */
export const TOWER_W = 4;

/** World position of spot i at tower t (its floor height). */
export function spotAt(t: Tower, i: number): { x: number; y: number; z: number } {
  const s = SPOTS[i], [wx, wz] = towerToWorld(t, s.a, s.b);
  return { x: t.x + wx, y: t.y + s.y, z: t.z + wz };
}

/** The spot (index) within reach (m) of world (x, y, z), with its tower, or null. */
export function spotNear(x: number, y: number, z: number, reach: number): { t: Tower; i: number } | null {
  const t = frameAt(x, z, 2);
  if (!t) return null;
  for (let i = 0; i < SPOTS.length; i++) {
    const p = spotAt(t, i);
    if (Math.abs(y - p.y) < 1.6 && (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < reach * reach) return { t, i };
  }
  return null;
}
