// Towing the cart (docs/cart.md "Towing"): it slows the bike a little, Space doesn't hop while it's hitched, and the
// cart drawn behind hangs from the bike's tow ball (shared/cartHang.ts): its coupler exactly on it every frame, on the
// ground and in the air, flying off a dune crest with the bike and landing back on its wheels.
// Run with: node --test tools/cart-tow.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { COUPLER_Y, CART_WHEEL_R, HITCH_BACK, HITCH_Y, TOW_LENGTH } from '../shared/cart.ts';
import { hangCart, newHang, turned } from '../shared/cartHang.ts';
import { bikeCruise, DT, FORWARD, JUMP, LEFT, quantizeYaw, RIGHT, spawnState, step } from '../shared/sim.ts';
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
    under = Math.max(under, heightAt(h.axle.x, h.axle.z) + CART_WHEEL_R - h.axle.y);
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
