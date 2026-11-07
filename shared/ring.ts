// The ring station (docs/levels/ring.md): the beginning happens inside a spinning ring, in a hall that runs all the way
// round it. The sim keeps its flat level frame, read as the ring's cylindrical coordinates: z is arc length along the
// deck, x is along the axis (across the hall), y is height above the deck, towards the axis. In those coordinates spin
// gravity is -y and every wall, deck and bulkhead is a box, so step() is unchanged but for Coriolis (Level.spin).
//
// The ring frame (what the client draws): the axis along x through (0, R, 0); the deck at z = 0 is at the origin with
// its "up" (towards the axis) on +y. Pure math, no three.js (Node type stripping rules).

/** The station: radius axis to deck, the hall's width (along the axis) and height (deck to ceiling), all in metres;
 *  `coriolis` scales the Coriolis term in the sim (1: the real thing, 0: none). */
export const RING = { radius: 500, width: 70, height: 36, coriolis: 1 } as const;

/** The sim's gravity (shared/sim.ts GRAVITY), as the spin's: ω² R = g. */
const G = 25;

/** The spin, signed (rad/s): negative turns the deck towards -z, so the walk (+z) goes against the spin. */
export const SPIN = -Math.sqrt(G / RING.radius);

/** The flat level point (x, y, z) in the ring frame, into `out` (x, y, z). */
export function toRing(x: number, y: number, z: number, out: number[] | Float32Array = [0, 0, 0], o = 0) {
  const R = RING.radius, th = z / R, r = R - y;
  out[o] = x;
  out[o + 1] = R - r * Math.cos(th);
  out[o + 2] = r * Math.sin(th);
  return out;
}

/** A flat direction (a normal) at arc length z, turned into the ring frame, into `out`. */
export function dirToRing(nx: number, ny: number, nz: number, z: number, out: number[] | Float32Array = [0, 0, 0], o = 0) {
  const th = z / RING.radius, c = Math.cos(th), s = Math.sin(th);
  out[o] = nx;
  out[o + 1] = ny * c + nz * s;
  out[o + 2] = -ny * s + nz * c;
  return out;
}

/** The rigid motion that puts the flat frame onto the ring at arc length z (exact at that z, d²/2R off d metres along):
 *  a turn by θ = z/R about the axis after a shift of -z, as a column-major 4×4 (three.js Matrix4.fromArray). */
export function ringMatrix(z: number, out: number[] = new Array(16).fill(0)): number[] {
  const R = RING.radius, th = z / R, c = Math.cos(th), s = Math.sin(th);
  // p' = A + Rx(-θ)(p - (0, 0, z) - A), A = (0, R, 0); Rx(-θ): y' = y c + z s, z' = -y s + z c.
  // Columns: x, y, z axes, then the translation (the image of the flat origin).
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = c; out[6] = -s; out[7] = 0;
  out[8] = 0; out[9] = s; out[10] = c; out[11] = 0;
  // origin (0, 0, 0) - (0, 0, z) - A = (0, -R, -z) -> Rx(-θ): (0, -R c - z s, R s - z c), + A.
  out[12] = 0; out[13] = R - R * c - z * s; out[14] = R * s - z * c; out[15] = 1;
  return out;
}

/** The inverse: the ring frame back onto the flat one round arc length z (the stage root's matrix round the camera). */
export function ringMatrixInverse(z: number, out: number[] = new Array(16).fill(0)): number[] {
  const R = RING.radius, th = z / R, c = Math.cos(th), s = Math.sin(th);
  // p = Rx(θ)(p' - A) + A + (0, 0, z); Rx(θ): y' = y c - z s, z' = y s + z c.
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = c; out[6] = s; out[7] = 0;
  out[8] = 0; out[9] = -s; out[10] = c; out[11] = 0;
  // origin' - A = (0, -R, 0) -> Rx(θ): (0, -R c, -R s), + A + (0, 0, z).
  out[12] = 0; out[13] = R - R * c; out[14] = z - R * s; out[15] = 1;
  return out;
}

/** The hall's ribs: a portal frame every `pitch` m round the ring (a column up each side wall, `depth` out from it and
 *  `width` along the ring, a beam `beam` deep under the ceiling). The columns stand on the deck: the beginning's layout
 *  has them as solids where you can walk. */
export const RIB = { pitch: 30, depth: 1.0, width: 1.5, beam: 1.6 } as const;

/** The ribs' arc lengths in [z0, z1]. */
export function ribsIn(z0: number, z1: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(z0 / RIB.pitch); k * RIB.pitch <= z1; k++) out.push(k * RIB.pitch);
  return out;
}

/** A rib's boxes at arc length s, in the flat frame: the two columns, then the beam. */
export function ribBoxes(s: number): [number, number, number, number, number, number][] {
  const X = RING.width / 2, H = RING.height, w = RIB.width / 2;
  return [
    [-X, -X + RIB.depth, 0, H - RIB.beam, s - w, s + w],
    [X - RIB.depth, X, 0, H - RIB.beam, s - w, s + w],
    [-X, X, H - RIB.beam, H, s - w, s + w],
  ];
}
