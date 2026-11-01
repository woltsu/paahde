// A towed cart hanging from its bike's tow ball (docs/cart.md "Towing"), for drawing (src/world/carts.ts). The sim
// (shared/sim.ts, shared/cart.ts towHitch) only says which way the cart points (PlayerState.hitch); this hangs it in 3D
// from the tow ball where the bike is drawn: the coupler pinned exactly to it, the cart pitched about it. Its axle has a
// height and a vertical speed of its own: it falls (the sim's gravity, so it flies as the bike does off a crest), is held
// off the sand under its wheels (bouncing a little when it comes down hard), and can't pitch further than TOW_ARTIC off
// the bike's line (the coupler's play), which lifts it off the ground when the bike rises sharply. Nothing the server
// cares about depends on it, and ours and others' are hung the same way, each from its bike as drawn. No three.js, so
// the tests run it (tools/cart.test.mjs).
import { CART_HALF_TRACK, CART_WHEEL_R } from './cart.ts';

const TOW_FALL = 25; // shared/sim.ts GRAVITY
/** The coupler's play: the cart pitches at most this far off the bike's line (rad). */
export const TOW_ARTIC = 0.6;
/** Bounce: this share of a landing's speed into the sand past TOW_BOUNCE_MIN (m/s) comes back. */
const TOW_BOUNCE = 0.25;
const TOW_BOUNCE_MIN = 3;
/** How fast it rolls onto the sand under its two wheels (per s), and back level in the air. */
const TOW_ROLL_RATE = 12;
/** The tow ball moving further than this in a frame (m): a teleport or a mount, start afresh on the ground. */
const TOW_JUMP = 4;

type XYZ = { x: number; y: number; z: number };

/** A hanging cart's state, and its pose: the cart's origin (`x`, `y`, `z`: on the ground under its axle's middle when
 *  it stands level) and rotation (YXZ: heading `psi`, pitch `phi` + = nose up, `roll` + = its right side up). */
export type Hang = {
  ay: number; avy: number; hx: number; hy: number; hz: number;
  x: number; y: number; z: number; psi: number; phi: number; roll: number;
  /** The axle's middle, and whether its wheels are on the sand. */
  axle: XYZ; onSand: boolean;
};

export const newHang = (): Hang => ({ ay: NaN, avy: 0, hx: 0, hy: 0, hz: 0, x: 0, y: 0, z: 0, psi: 0, phi: 0, roll: 0, axle: { x: 0, y: 0, z: 0 }, onSand: true });

/** Point `p` of the cart's frame turned by (psi, phi, roll), YXZ (three.js Euler order). */
export function turned(p: XYZ, psi: number, phi: number, roll: number): XYZ {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(phi), sp = Math.sin(phi), cy = Math.cos(psi), sy = Math.sin(psi);
  const x1 = p.x * cr - p.y * sr, y1 = p.x * sr + p.y * cr, z1 = p.z;
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  return { x: x1 * cy + z2 * sy, y: y2, z: -x1 * sy + z2 * cy };
}

/**
 * One frame of hanging: the tow ball at `H` (world), the cart heading `psi` (PlayerState.hitch), the bike's drawn pitch
 * and heading, the coupler in the cart's frame, `ground` the sand's height. Updates `h` in place.
 */
export function hangCart(h: Hang, H: XYZ, psi: number, bikePitch: number, bikeHeading: number, coupler: XYZ, dt: number,
  ground: (x: number, z: number) => number): Hang {
  const bx = Math.sin(psi), bz = Math.cos(psi), rx = Math.cos(psi), rz = -Math.sin(psi);
  const R = CART_WHEEL_R;
  // Coupler to axle: its length, and how far below the level the axle hangs with the cart level.
  const D = Math.hypot(coupler.z, coupler.y - R), B0 = Math.atan2(coupler.y - R, -coupler.z);
  const fresh = !Number.isFinite(h.ay) || Math.hypot(H.x - h.hx, H.y - h.hy, H.z - h.hz) > TOW_JUMP || dt <= 0;
  h.hx = H.x; h.hy = H.y; h.hz = H.z;
  const clampS = (v: number) => Math.max(-0.98, Math.min(0.98, v));
  // Under the wheels at pitch phi: the sand under its two wheels, and the most nose-up pitch (that drops the axle) that
  // keeps them on or over it.
  let gl = 0, gr = 0;
  const top = (phi: number) => {
    const d = D * Math.cos(phi + B0), ax = H.x + bx * d, az = H.z + bz * d;
    gl = ground(ax - rx * CART_HALF_TRACK, az - rz * CART_HALF_TRACK);
    gr = ground(ax + rx * CART_HALF_TRACK, az + rz * CART_HALF_TRACK);
    return Math.asin(clampS((H.y - (gl + gr) / 2 - R) / D)) - B0;
  };
  // Falling: where its own vertical speed and gravity take the axle (fresh: straight down onto the sand).
  const vIn = fresh ? 0 : h.avy - TOW_FALL * dt;
  let phi = fresh ? Math.PI / 2 : Math.asin(clampS((H.y - (h.ay + vIn * dt)) / D)) - B0;
  // The coupler's play off the bike's line (the bike's pitch, as far as the cart points the bike's way).
  const bike = bikePitch * Math.cos(psi - bikeHeading);
  phi = Math.max(bike - TOW_ARTIC, Math.min(bike + TOW_ARTIC, phi));
  // The sand holds it up (twice: where the axle comes down moves a little with the pitch).
  let onSand = false;
  for (let i = 0; i < 2; i++) {
    const t = top(phi);
    if (phi >= t - 1e-4) {
      phi = t;
      onSand = true;
    }
  }
  const ay = H.y - D * Math.sin(phi + B0);
  let vy = fresh ? 0 : (ay - h.ay) / dt;
  if (onSand && vy - vIn > TOW_BOUNCE_MIN) vy += TOW_BOUNCE * (vy - vIn - TOW_BOUNCE_MIN);
  h.ay = ay;
  h.avy = Math.max(-60, Math.min(60, vy));
  // Rolls onto its two wheels' sand; levels out in the air.
  const roll = onSand ? Math.atan2(gr - gl, 2 * CART_HALF_TRACK) : 0;
  h.roll = fresh ? roll : h.roll + (roll - h.roll) * (1 - Math.exp(-dt * TOW_ROLL_RATE));
  h.psi = psi;
  h.phi = phi;
  h.onSand = onSand;
  // Pinned: the coupler, turned with the cart, lands exactly on the tow ball.
  const c = turned(coupler, psi, phi, h.roll);
  h.x = H.x - c.x; h.y = H.y - c.y; h.z = H.z - c.z;
  const d = D * Math.cos(phi + B0);
  h.axle.x = H.x + bx * d; h.axle.y = ay; h.axle.z = H.z + bz * d;
  return h;
}
