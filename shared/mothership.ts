// The mothership's orbit, as plain math (no three), so the client's sky (src/world/mothership.ts) and, later, the
// server (the day it comes down: docs/mothership.md) agree on where it is. Deterministic from the time of day.
//
// A real Kepler orbit round a planet the size of Earth: geosynchronous (one turn per day, so it traces the same path
// over the same desert every day and never leaves it), eccentric and a little inclined. From the desert (LAT) it never
// sets: at midnight it's at perigee, nearest (biggest, ~23° long) and lowest (~15° up, due south), right where you
// look over the dunes; through the morning it swings east and climbs, shrinking with distance and slowing (Kepler's
// second law), to ~67° up and ~15° long at noon, and comes back down the west through the evening: a long loop over the
// southern sky. At midnight it passes just clear of the planet's shadow, so it's sunlit all night. Its attitude is nadir-pointing (belly to the planet, nose along its flight), so you see it turn as it
// goes. It goes dark in the planet's shadow only when that shadow reaches it (with a red rim from the planet's
// atmosphere on the way in and out); its own lights stay on.
//
// Frames: inertial I with z the planet's spin axis (north) and the sun fixed at right ascension 0, declination DECL
// (the game has no seasons); the desert's meridian points at right ascension θ = the sun's hour angle. Game axes
// (the same as skyVector's): x = south, y = up, z = east.
import { DECL, LAT, sunHourAngle, type Vec3 } from './sun.ts';

/** Planet radius (km): Earth's. */
export const PLANET_R = 6371;
/** Semi-major axis (km): geosynchronous round an Earth-mass planet (one turn per day). */
export const ORBIT_A = 42164;
/** Eccentricity and inclination. More inclination would take it down into the dunes at perigee; less (≤ 20°) into the
 *  planet's shadow at midnight. */
export const ORBIT_E = 0.25;
export const ORBIT_I = (22 * Math.PI) / 180;
/** Argument of perigee: 270°, so perigee is at the orbit's southernmost point (and apogee its northernmost). */
const ORBIT_W = (270 * Math.PI) / 180;
/** Right ascension of the ascending node, and when (time of day) it passes perigee: perigee on the desert's meridian
 *  at midnight (the meridian is at right ascension π then; perigee is 270° on from the node). */
const ORBIT_NODE = -Math.PI / 2;
const PERIGEE_TOD = 0;
/** Length of the ship, nose to tail (km). A mega-structure the size of a continent: 15–23° across the sky (the moon,
 *  drawn big, is 4°). */
export const SHIP_LENGTH = 12000;

/** Atmosphere's top (km over the surface): sunlight grazing it reddens the ship at the shadow's edge. */
const ATMOSPHERE = 100;

export type Mothership = {
  /** Unit vector from the desert to the ship (game axes). */
  dir: Vec3;
  /** Distance from the desert (km). */
  range: number;
  /** Angular length (radians) of the ship as seen from here, if it were broadside on. */
  angle: number;
  /** Unit vectors (game axes) for its attitude: nose (along its flight) and belly (towards the planet's centre). */
  nose: Vec3;
  belly: Vec3;
  /** Sunlight on it: 1 in full sun, 0 in the planet's shadow; `red` 0..1 in the rim (sunlight through the air). */
  sunlit: number;
  red: number;
  /** How much of the planet's sunlit face it sees (0..1): the glow off the desert on its belly. */
  planetshine: number;
};

const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });
export const newMothership = (): Mothership => ({ dir: v(), range: 0, angle: 0, nose: v(), belly: v(), sunlit: 1, red: 0, planetshine: 0 });

/** Eccentric anomaly for mean anomaly M (Newton on Kepler's equation). */
function eccentric(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

const p = v(), vel = v(), sun = v(), obs = v(), up = v(), east = v(), north = v();
/** Inertial → game axes at the desert (whose meridian is at right ascension θ). */
function toGame(a: Vec3, out: Vec3) {
  const u = a.x * up.x + a.y * up.y + a.z * up.z;
  const e = a.x * east.x + a.y * east.y + a.z * east.z;
  const n = a.x * north.x + a.y * north.y + a.z * north.z;
  out.x = -n;
  out.y = u;
  out.z = e;
  return out;
}
function normalize(a: Vec3) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  a.x /= l;
  a.y /= l;
  a.z /= l;
  return a;
}

/** Where the ship is at time of day `tod` (0 = midnight), written into `out`. */
export function mothershipAt(tod: number, out: Mothership = newMothership()): Mothership {
  // Position and velocity in the orbit's plane (perifocal: x to perigee).
  const M = 2 * Math.PI * (tod - PERIGEE_TOD);
  const E = eccentric(M, ORBIT_E);
  const b = Math.sqrt(1 - ORBIT_E * ORBIT_E);
  const px = ORBIT_A * (Math.cos(E) - ORBIT_E), py = ORBIT_A * b * Math.sin(E);
  const vx = -Math.sin(E), vy = b * Math.cos(E); // direction only
  // Perifocal → inertial: rotate by ω (in plane), i (about the node line), Ω (about z).
  const cw = Math.cos(ORBIT_W), sw = Math.sin(ORBIT_W), ci = Math.cos(ORBIT_I), si = Math.sin(ORBIT_I);
  const cO = Math.cos(ORBIT_NODE), sO = Math.sin(ORBIT_NODE);
  const rot = (x: number, y: number, o: Vec3) => {
    const x1 = cw * x - sw * y, y1 = sw * x + cw * y; // in plane
    const y2 = ci * y1, z2 = si * y1; // tilt
    o.x = cO * x1 - sO * y2;
    o.y = sO * x1 + cO * y2;
    o.z = z2;
    return o;
  };
  rot(px, py, p);
  rot(vx, vy, vel);

  // The desert, turned to θ, and its local up/east/north.
  const th = sunHourAngle(tod);
  const ct = Math.cos(th), st = Math.sin(th), cl = Math.cos(LAT), sl = Math.sin(LAT);
  up.x = cl * ct; up.y = cl * st; up.z = sl;
  east.x = -st; east.y = ct; east.z = 0;
  north.x = -sl * ct; north.y = -sl * st; north.z = cl;
  obs.x = PLANET_R * up.x; obs.y = PLANET_R * up.y; obs.z = PLANET_R * up.z;

  const dx = p.x - obs.x, dy = p.y - obs.y, dz = p.z - obs.z;
  out.range = Math.hypot(dx, dy, dz);
  out.angle = SHIP_LENGTH / out.range;
  toGame({ x: dx, y: dy, z: dz }, out.dir);
  normalize(out.dir);
  // Belly to the planet's centre, nose along the flight made square to it.
  const r = Math.hypot(p.x, p.y, p.z);
  const bx = -p.x / r, by = -p.y / r, bz = -p.z / r;
  const along = vel.x * bx + vel.y * by + vel.z * bz;
  toGame({ x: bx, y: by, z: bz }, out.belly);
  toGame(normalize({ x: vel.x - along * bx, y: vel.y - along * by, z: vel.z - along * bz }), out.nose);

  // Sunlight: the planet's shadow is a cylinder behind it (the sun is far off); its edge is the atmosphere.
  sun.x = Math.cos(DECL); sun.y = 0; sun.z = Math.sin(DECL);
  const toward = p.x * sun.x + p.y * sun.y + p.z * sun.z;
  const off = Math.sqrt(Math.max(0, r * r - toward * toward)); // distance from the shadow's axis
  const lit = toward > 0 ? 1 : smooth(PLANET_R - ATMOSPHERE, PLANET_R + ATMOSPHERE, off);
  out.sunlit = lit;
  out.red = toward > 0 ? 0 : (1 - Math.abs(lit * 2 - 1)) * 0.9;
  out.planetshine = 0.5 + 0.5 * (toward / r);
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
