// Towing the cart (docs/cart.md "Towing"): it slows the bike a little, Space doesn't hop while it's hitched, and the
// cart drawn behind hangs from the bike's tow ball (shared/cartHang.ts): its coupler exactly on it every frame, on the
// ground and in the air, flying off a dune crest with the bike and landing back on its wheels.
// Run with: node --test tools/cart-tow.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { CART_HALF_TRACK, COUPLER_Y, CART_WHEEL_R, HITCH_BACK, HITCH_Y, TOW_LENGTH } from '../shared/cart.ts';
import { hangCart, newHang, turned } from '../shared/cartHang.ts';
import { BACK, bikeCruise, DT, FORWARD, JUMP, LEFT, quantizeYaw, RIGHT, spawnState, step } from '../shared/sim.ts';
import { heightAt } from '../shared/terrain.ts';

const bike = (tow, x = 3000, z = 3000, h = 0.4) => ({ ...spawnState(x, z), riding: true, bike: 4, heading: h, tow, hitch: h });

test('towing slows the bike a little: it levels off 10–15% slower', () => {
  for (const q of [0, 1, 2, 3]) {
    const free = bikeCruise(q), towed = bikeCruise(q, true);
    assert.ok(towed < free * 0.92 && towed > free * 0.85, `quality ${q}: ${towed.toFixed(1)} vs ${free.toFixed(1)} m/s`);
  }
  // And riding it: the same throttle over the same sand gets less far.
  let a = bike(0), b = bike(7);
  for (let t = 0; t < 600; t++) {
    a = step(a, FORWARD, quantizeYaw(a.heading));
    b = step(b, FORWARD, quantizeYaw(b.heading));
  }
  const da = Math.hypot(a.x - 3000, a.z - 3000), db = Math.hypot(b.x - 3000, b.z - 3000);
  assert.ok(db < da * 0.95, `towing went ${db.toFixed(0)} m, free ${da.toFixed(0)} m`);
});

test('no hop while towing: holding and letting go of Space stays on the ground', () => {
  const hop = (tow) => {
    let s = bike(tow);
    for (let t = 0; t < 30; t++) s = step(s, 0, quantizeYaw(s.heading)); // settle
    for (let t = 0; t < 30; t++) s = step(s, JUMP, quantizeYaw(s.heading));
    let left = false;
    for (let t = 0; t < 60; t++) {
      s = step(s, 0, quantizeYaw(s.heading));
      left ||= !s.grounded;
    }
    return left;
  };
  assert.equal(hop(0), true, 'it hops without the cart');
  assert.equal(hop(7), false, 'not with it');
});

/** The tow ball of the bike in state `s` (drawn along its nose, unleaning): src/bike.ts HITCH in its tilted frame. */
const ball = (s) => {
  const p = turned({ x: 0, y: HITCH_Y, z: HITCH_BACK }, s.heading, s.nose, 0);
  return { x: s.x + p.x, y: s.y + p.y, z: s.z + p.z };
};
const COUPLER = { x: 0, y: COUPLER_Y, z: -TOW_LENGTH };

test('the cart hangs from the tow ball: coupler on it every frame, flying off a crest with the bike, landing on its wheels', () => {
  // Full throttle from here launches off a crest around tick 300 for about a second, after turns both ways.
  let s = bike(7);
  const h = newHang();
  let worst = 0, bikeAir = 0, flewWith = 0, under = 0, longest = 0;
  for (let t = 0; t < 600; t++) {
    const input = FORWARD | (t > 60 && t < 120 ? LEFT : t > 150 && t < 200 ? RIGHT : 0);
    s = step(s, input, quantizeYaw(s.heading));
    const H = ball(s);
    hangCart(h, H, s.hitch, s.nose, s.heading, COUPLER, DT, heightAt);
    const c = turned(COUPLER, h.psi, h.phi, h.roll);
    worst = Math.max(worst, Math.hypot(h.x + c.x - H.x, h.y + c.y - H.y, h.z + c.z - H.z));
    // Never into the sand: the axle's middle at least a wheel's radius over it (a little slack for the roll).
    const rx = Math.cos(h.psi) * CART_HALF_TRACK, rz = -Math.sin(h.psi) * CART_HALF_TRACK; // (the sand under its two wheels)
    const sand = (heightAt(h.axle.x - rx, h.axle.z - rz) + heightAt(h.axle.x + rx, h.axle.z + rz)) / 2;
    under = Math.max(under, sand + CART_WHEEL_R - h.axle.y);
    bikeAir = s.grounded ? 0 : bikeAir + 1;
    longest = Math.max(longest, bikeAir);
    // Well into the bike's flight, the cart is in the air too, well off the sand.
    if (bikeAir > 10 && !h.onSand && h.axle.y - heightAt(h.axle.x, h.axle.z) - CART_WHEEL_R > 0.5) flewWith++;
  }
  assert.ok(longest > 40, `the bike flew (${longest} ticks)`);
  assert.ok(worst < 1e-9, `coupler off the ball by ${worst}`);
  assert.ok(under < 0.02, `wheels into the sand by ${under.toFixed(3)} m`);
  assert.ok(flewWith > 20, `the cart flew with the bike (${flewWith} ticks)`);
  assert.equal(h.onSand, true, 'back on its wheels');
});

test('a wheelie or the bike rising sharply lifts the cart only past the coupler\'s play', () => {
  // On the flat sand: the bike's nose up a little leaves the cart on its wheels; the ball lifted 2 m pulls it up.
  const s = bike(7);
  const g = heightAt(s.x, s.z);
  const st = { ...s, y: g, nose: 0.2 };
  const h = newHang();
  for (let i = 0; i < 30; i++) hangCart(h, ball(st), st.hitch, st.nose, st.heading, COUPLER, DT, heightAt);
  assert.equal(h.onSand, true, 'small wheelie: on its wheels');
  const up = { ...st, y: g + 2.5, nose: 0 };
  hangCart(h, ball(up), up.hitch, up.nose, up.heading, COUPLER, DT, heightAt);
  assert.equal(h.onSand, false, 'yanked up off the sand');
  assert.ok(h.avy > 5, 'and moving up');
});

test('getting off with the cart linked: it hangs from the parked bike\'s ball, on its wheels, without a jump', () => {
  // Ride a while, then the bike stands parked where it stopped, leaning on its stand (src/world/vehicles.ts).
  let s = bike(7);
  const h = newHang();
  for (let t = 0; t < 360; t++) {
    const vf = -s.vx * Math.sin(s.heading) - s.vz * Math.cos(s.heading);
    s = step(s, t < 180 ? FORWARD | (t > 60 && t < 120 ? LEFT : 0) : vf > 0.2 ? BACK : 0, quantizeYaw(s.heading));
    hangCart(h, ball(s), s.hitch, s.nose, s.heading, COUPLER, DT, heightAt);
  }
  const before = { x: h.x, y: h.y, z: h.z };
  const p = turned({ x: 0, y: HITCH_Y, z: HITCH_BACK }, s.heading, s.nose, 0.12);
  const parkedBall = { x: s.x + p.x, y: s.y + p.y, z: s.z + p.z };
  for (let i = 0; i < 60; i++) hangCart(h, parkedBall, s.hitch, s.nose, s.heading, COUPLER, DT, heightAt);
  const c = turned(COUPLER, h.psi, h.phi, h.roll);
  assert.ok(Math.hypot(h.x + c.x - parkedBall.x, h.y + c.y - parkedBall.y, h.z + c.z - parkedBall.z) < 1e-9, 'coupler on the ball');
  assert.equal(h.onSand, true, 'on its wheels');
  const jump = Math.hypot(h.x - before.x, h.y - before.y, h.z - before.z);
  assert.ok(jump < 0.1, `no jump (${jump.toFixed(3)} m, still ${Math.hypot(s.vx, s.vz).toFixed(2)} m/s)`);
});

// ---- Rolling over shaped sand (a profile along the way it goes, -z), at any frame rate ----------------------------------

/** Drive a bike at `speed` along -z over `prof(u)` (u = -z), drawn at `fps` (0: jittery frames, 4–33 ms), its cart
 *  behind; what the cart did once its axle is past u = 2: the most its wheels rose off the sand, how often it left the
 *  sand, how often its pitch's rate turned back (a bounce rocks it). */
function roll(prof, speed, fps) {
  const ground = (x, z) => prof(-z);
  const h = newHang();
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let u = -20, lift = 0, left = 0, wasOn = true, flips = 0, lastRate = 0, prevPhi = NaN;
  while (u < 70) {
    const dt = fps ? 1 / fps : 0.004 + rand() * 0.029;
    u += speed * dt;
    const e = 0.01, nose = Math.atan((prof(u + e) - prof(u - e)) / (2 * e));
    const p = turned({ x: 0, y: HITCH_Y, z: HITCH_BACK }, 0, nose, 0);
    hangCart(h, { x: p.x, y: prof(u) + p.y, z: -u + p.z }, 0, nose, 0, COUPLER, dt, ground);
    if (-h.axle.z > 2) {
      lift = Math.max(lift, h.axle.y - CART_WHEEL_R - ground(h.axle.x, h.axle.z));
      if (wasOn && !h.onSand) left++;
      if (Number.isFinite(prevPhi)) {
        const rate = (h.phi - prevPhi) / dt;
        if (Math.abs(rate) > 0.02) {
          if (lastRate && Math.sign(rate) !== Math.sign(lastRate)) flips++;
          lastRate = rate;
        }
      }
    }
    prevPhi = h.phi;
    wasOn = h.onSand;
  }
  return { lift, left, flips };
}
/** Flat, then curving over 8 m into a steady slope `k` (rise per m; < 0 downhill). */
const hill = (k) => (u) => (u < 0 ? 0 : u < 8 ? (k * u * u) / 16 : k * (u - 4));
/** A rounded dune crest 3 m high, and a sharp one (the bike leaves it at speed too: shared/sim.ts BIKE_LAUNCH_EPS). */
const crest = (u) => 3 * Math.exp(-(((u - 20) / 10) ** 2));
const sharp = (u) => 3 * Math.exp(-(((u - 20) / 4) ** 2));
const FPS = [30, 60, 144, 0];
const named = (fps) => (fps ? `${fps} fps` : 'jittery frames');

test('up a long dune slope the cart rolls on its wheels: no lift, no bounce, at any speed and frame rate', () => {
  for (const k of [0.3, 0.6]) for (const speed of [4, 12, 25, 35]) for (const fps of FPS) {
    const r = roll(hill(k), speed, fps), at = `slope ${k}, ${speed} m/s, ${named(fps)}`;
    assert.ok(r.lift < 0.003, `${at}: lifted ${(r.lift * 1000).toFixed(1)} mm`);
    assert.equal(r.left, 0, `${at}: left the sand`);
    assert.ok(r.flips <= 1, `${at}: its pitch rocked (${r.flips} turns)`);
  }
});

test('downhill and over a crest at low speed it stays on the sand; fast over a crest it flies, as high at any frame rate', () => {
  for (const speed of [4, 12]) for (const fps of FPS) {
    const at = `${speed} m/s, ${named(fps)}`;
    const down = roll(hill(-0.4), speed, fps), over = roll(crest, speed, fps);
    assert.ok(down.lift < 0.003 && down.left === 0, `${at} downhill: lifted ${(down.lift * 1000).toFixed(1)} mm`);
    assert.ok(over.lift < 0.003 && over.left === 0, `${at} over the crest: lifted ${(over.lift * 1000).toFixed(1)} mm`);
    assert.ok(down.flips <= 1 && over.flips <= 2, `${at}: its pitch rocked (${down.flips}, ${over.flips} turns)`);
  }
  // At 30 m/s the sharp crest drops away faster than gravity follows: it leaves the sand, as high at any frame rate.
  const tops = FPS.map((fps) => roll(sharp, 30, fps).lift);
  assert.ok(tops[0] > 0.2, `it flew (${tops[0].toFixed(2)} m)`);
  // (The bike is drawn, and so the ball sampled, once a frame: at 30 fps that rounds the crest's sharp top off a little.)
  const fine = tops.slice(1);
  assert.ok(Math.max(...fine) - Math.min(...fine) < 0.1, `as high at 60, 144 fps and jittery: ${tops.map((t) => t.toFixed(3))}`);
  assert.ok(Math.abs(tops[0] - tops[1]) < 0.4, `about as high at 30 fps: ${tops.map((t) => t.toFixed(3))}`);
});
