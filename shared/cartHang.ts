// A towed cart hanging from its bike's tow ball (docs/cart.md "Towing"), for drawing (src/world/carts.ts). The sim
// (shared/sim.ts, shared/cart.ts towHitch) only says which way the cart points (PlayerState.hitch); this hangs it in 3D
// from the tow ball where the bike is drawn: the coupler pinned exactly to it, the cart pitched about it. Its axle has a
// height and a vertical speed of its own: rolling, its wheels stay on the sand (up a slope and down it) until the sand
// drops away faster than gravity could follow (a crest at speed) or the ball yanks it up (the coupler lets it pitch at
// most TOW_ARTIC off the bike's line); then it falls (the sim's gravity, so it flies as the bike does) and lands on its
// wheels, bouncing a little only when it comes down hard. It steps at a fixed rate (TOW_STEP, the ball and the bike's
// pitch interpolated across the frame), so it moves the same at any frame rate. Nothing the server cares about depends
// on it, and ours and others' are hung the same way, each from its bike as drawn. No three.js, so the tests run it
// (tools/cart-tow.test.mjs).
import { CART_HALF_TRACK, CART_WHEEL_R } from './cart.ts';

const TOW_FALL = 25; // shared/sim.ts GRAVITY
/** The coupler's play: the cart pitches at most this far off the bike's line (rad). */
export const TOW_ARTIC = 0.6;
/** Its fixed step (s). */
const TOW_STEP = 1 / 120;
/** Bounce: landing (coming down from the air, never while rolling) faster than TOW_BOUNCE_MIN (m/s) into the sand, this
 *  share of the speed past it comes back. */
const TOW_BOUNCE = 0.25;
const TOW_BOUNCE_MIN = 3;
/** Rolling, the wheels stay on the sand unless free fall would leave it more than this far below them (m) in a step:
 *  the sand dropping away faster than gravity follows, by as much as it takes the bike off it (shared/sim.ts
 *  BIKE_LAUNCH_EPS, 3 cm a 1/60 s tick: ~110 m/s² more than gravity), so the cart leaves a crest where the bike would and
 *  rolls over the dunes' little ripples. */
const TOW_STICK = 0.0075;
/** How fast it rolls onto the sand under its two wheels (per s), and back level in the air. */
const TOW_ROLL_RATE = 12;
/** The tow ball moving further than this in a frame (m): a teleport or a mount, start afresh on the ground. */
const TOW_JUMP = 4;
/** A frame longer than this (s) is only stepped this far (a stalled tab). */
const TOW_MAX_FRAME = 0.25;

type XYZ = { x: number; y: number; z: number };

/** A hanging cart's state, and its pose: the cart's origin (`x`, `y`, `z`: on the ground under its axle's middle when
 *  it stands level) and rotation (YXZ: heading `psi`, pitch `phi` + = nose up, `roll` + = its right side up). */
export type Hang = {
  /** The axle's height and vertical speed at the last step, whether its wheels were on the sand, and the time since. */
  ay: number; avy: number; on: boolean; left: number;
  /** Last frame's inputs (the ball, the cart's heading, the bike's pitch along it), interpolated between by the steps. */
  hx: number; hy: number; hz: number; hpsi: number; hpitch: number;
  x: number; y: number; z: number; psi: number; phi: number; roll: number;
  /** The axle's middle, and whether its wheels are on the sand. */
  axle: XYZ; onSand: boolean;
};

export const newHang = (): Hang => ({
  ay: NaN, avy: 0, on: true, left: 0, hx: 0, hy: 0, hz: 0, hpsi: 0, hpitch: 0,
  x: 0, y: 0, z: 0, psi: 0, phi: 0, roll: 0, axle: { x: 0, y: 0, z: 0 }, onSand: true,
});

/** Point `p` of the cart's frame turned by (psi, phi, roll), YXZ (three.js Euler order). */
export function turned(p: XYZ, psi: number, phi: number, roll: number): XYZ {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(phi), sp = Math.sin(phi), cy = Math.cos(psi), sy = Math.sin(psi);
  const x1 = p.x * cr - p.y * sr, y1 = p.x * sr + p.y * cr, z1 = p.z;
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  return { x: x1 * cy + z2 * sy, y: y2, z: -x1 * sy + z2 * cy };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clampS = (v: number) => Math.max(-0.98, Math.min(0.98, v));

/** Where the axle settles hung from the ball at `H` (heading `psi`, the bike pitched `bike` along it), its middle's
 *  height wanting to be `y`: on the sand if it would go into it, or if `stick` and it would leave it by under
 *  TOW_STICK; lifted by the coupler's play. */
type Fit = { phi: number; on: boolean; gl: number; gr: number; ay: number };
const fit: Fit = { phi: 0, on: false, gl: 0, gr: 0, ay: 0 };
function settle(H: XYZ, psi: number, bike: number, y: number, stick: boolean, D: number, B0: number,
  ground: (x: number, z: number) => number): Fit {
  const bx = Math.sin(psi), bz = Math.cos(psi), rx = Math.cos(psi), rz = -Math.sin(psi), R = CART_WHEEL_R;
  const lo = bike - TOW_ARTIC, hi = bike + TOW_ARTIC;
  let phi = Math.max(lo, Math.min(hi, Math.asin(clampS((H.y - y) / D)) - B0));
  /** How far the wheels' middle is over the sand under them at pitch `p` (m; the sand's height under each wheel kept). */
  const gapAt = (p: number) => {
    const d = D * Math.cos(p + B0), ax = H.x + bx * d, az = H.z + bz * d;
    fit.gl = ground(ax - rx * CART_HALF_TRACK, az - rz * CART_HALF_TRACK);
    fit.gr = ground(ax + rx * CART_HALF_TRACK, az + rz * CART_HALF_TRACK);
    return H.y - D * Math.sin(p + B0) - (fit.gl + fit.gr) / 2 - R;
  };
  // The most nose-up pitch (that drops the axle) keeping the wheels on or over the sand. Where the axle comes down moves
  // with the pitch: a few fixed-point steps find it on gentle sand; on steep slopes that can stall, so then bisect.
  let top = phi;
  for (let i = 0; i < 4; i++) {
    gapAt(top);
    top = Math.asin(clampS((H.y - (fit.gl + fit.gr) / 2 - R) / D)) - B0;
  }
  if (Math.abs(gapAt(top)) > 1e-5) {
    let a = -1.45 - B0, b = 1.45 - B0; // (gap > 0 at a: the axle up high; < 0 at b)
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (gapAt(m) > 0) a = m;
      else b = m;
    }
    top = a;
  }
  // Into the sand: on it (the sand wins over the coupler's play). Rolling, it also stays down unless free fall leaves the
  // sand by more than TOW_STICK, or the coupler's play won't let it down.
  const gap = gapAt(phi);
  fit.on = phi >= top || (stick && gap < TOW_STICK && top <= hi);
  if (fit.on) phi = top;
  gapAt(phi); // (the sand under its wheels where it ends up)
  fit.phi = phi;
  fit.ay = H.y - D * Math.sin(phi + B0);
  return fit;
}

/**
 * One frame of hanging: the tow ball at `H` (world), the cart heading `psi` (PlayerState.hitch), the bike's drawn pitch
 * and heading, the coupler in the cart's frame, `dt` the frame's length, `ground` the sand's height. Updates `h` in place.
 */
export function hangCart(h: Hang, H: XYZ, psi: number, bikePitch: number, bikeHeading: number, coupler: XYZ, dt: number,
  ground: (x: number, z: number) => number): Hang {
  const R = CART_WHEEL_R;
  // Coupler to axle: its length, and how far below the level the axle hangs with the cart level.
  const D = Math.hypot(coupler.z, coupler.y - R), B0 = Math.atan2(coupler.y - R, -coupler.z);
  const bike = bikePitch * Math.cos(psi - bikeHeading); // the bike's pitch, as far as the cart points its way
  const fresh = !Number.isFinite(h.ay) || Math.hypot(H.x - h.hx, H.y - h.hy, H.z - h.hz) > TOW_JUMP || !(dt > 0);
  if (fresh) {
    // Straight down onto the sand (or as low as the coupler lets it).
    const f = settle(H, psi, bike, -Infinity, false, D, B0, ground);
    h.ay = f.ay;
    h.avy = 0;
    h.on = f.on;
    h.left = 0;
    h.roll = f.on ? Math.atan2(f.gr - f.gl, 2 * CART_HALF_TRACK) : 0;
  } else {
    // Fixed steps up to now, the inputs interpolated from last frame's to this one's.
    const frame = Math.min(dt, TOW_MAX_FRAME);
    let left = h.left + frame;
    const dpsi = wrap(psi - h.hpsi);
    const at = { x: 0, y: 0, z: 0 };
    while (left >= TOW_STEP) {
      left -= TOW_STEP;
      const u = Math.max(0, Math.min(1, 1 - left / frame));
      at.x = h.hx + (H.x - h.hx) * u; at.y = h.hy + (H.y - h.hy) * u; at.z = h.hz + (H.z - h.hz) * u;
      const ps = h.hpsi + dpsi * u, pb = h.hpitch + (bike - h.hpitch) * u;
      const vIn = h.avy - TOW_FALL * TOW_STEP;
      const f = settle(at, ps, pb, h.ay + vIn * TOW_STEP, h.on, D, B0, ground);
      let vy = (f.ay - h.ay) / TOW_STEP;
      // A landing (not rolling): the speed into the sand past TOW_BOUNCE_MIN partly comes back.
      if (f.on && !h.on && vy - vIn > TOW_BOUNCE_MIN) vy += TOW_BOUNCE * (vy - vIn - TOW_BOUNCE_MIN);
      h.ay = f.ay;
      h.avy = Math.max(-60, Math.min(60, vy));
      h.on = f.on;
      // Rolls onto its two wheels' sand; levels out in the air.
      const roll = f.on ? Math.atan2(f.gr - f.gl, 2 * CART_HALF_TRACK) : 0;
      h.roll += (roll - h.roll) * (1 - Math.exp(-TOW_STEP * TOW_ROLL_RATE));
    }
    h.left = left;
  }
  h.hx = H.x; h.hy = H.y; h.hz = H.z; h.hpsi = psi; h.hpitch = bike;
  // Drawn now, hung from the ball where it is this frame: rolling, on the sand under it (the steps decide when it
  // leaves); in the air, from the last step carried on over the leftover time.
  const r = h.left;
  const f = settle(H, psi, bike, h.on ? -Infinity : h.ay + h.avy * r - 0.5 * TOW_FALL * r * r, false, D, B0, ground);
  h.psi = psi;
  h.phi = f.phi;
  h.onSand = f.on;
  // Pinned: the coupler, turned with the cart, lands exactly on the tow ball.
  const c = turned(coupler, psi, f.phi, h.roll);
  h.x = H.x - c.x; h.y = H.y - c.y; h.z = H.z - c.z;
  const d = D * Math.cos(f.phi + B0);
  h.axle.x = H.x + Math.sin(psi) * d; h.axle.y = f.ay; h.axle.z = H.z + Math.cos(psi) * d;
  return h;
}
