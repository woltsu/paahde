// The ring station's frame (shared/ring.ts, docs/levels/ring.md): the flat level frame read as the ring's cylindrical
// coordinates, the rigid motions the client draws it with, and Coriolis in the sim (Level.spin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RING, SPIN, dirToRing, ringMatrix, ringMatrixInverse, toRing } from '../shared/ring.ts';
import { level } from '../shared/levels.ts';
import { FORWARD, JUMP, levelSpawn, quantizeYaw, step } from '../shared/sim.ts';

const R = RING.radius;
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const near = (a, b, eps, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${what}: ${a} vs ${b}`));

test('the deck is a cylinder round the axis, and up is towards it', () => {
  for (const z of [0, 37, 250, -400, Math.PI * R, 2.5 * Math.PI * R]) {
    for (const [x, y] of [[0, 0], [12, 0], [-30, 1.7], [5, 60]]) {
      const p = toRing(x, y, z);
      // Its distance from the axis (along x through (0, R, 0)) is R - y.
      assert.ok(Math.abs(Math.hypot(p[1] - R, p[2]) - (R - y)) < 1e-9);
      assert.equal(p[0], x);
    }
    // The deck's normal (flat +y) points at the axis.
    const p = toRing(0, 0, z), n = dirToRing(0, 1, 0, z);
    const toAxis = [0, R - p[1], -p[2]].map((v) => v / R);
    near(n, toAxis, 1e-9, `up at ${z}`);
  }
  // The origin is the deck at z = 0, up +y.
  near(toRing(3, 2, 0), [3, 2, 0], 1e-12, 'origin');
});

test('ringMatrix(z) is exact at z and d²/2R off along; its inverse undoes it', () => {
  for (const z of [0, 24, 190, -77, 1500]) {
    const m = ringMatrix(z), inv = ringMatrixInverse(z);
    for (const p of [[0, 0, z], [10, 1.6, z], [-35, 60, z]]) near(apply(m, p), toRing(...p), 1e-9, `at ${z}`);
    for (const p of [[1, 2, 3], [-20, 40, z + 10]]) near(apply(inv, apply(m, p)), p, 1e-9, 'round trip');
    // 10 m along, the deck under the rigid motion is d²/2R from the true deck (here 10 cm).
    const off = Math.hypot(...apply(m, [0, 0, z + 10]).map((v, i) => v - toRing(0, 0, z + 10)[i]));
    assert.ok(Math.abs(off - 100 / (2 * R)) < 0.01, `off ${off}`);
  }
});

test('Coriolis: the spin is the gravity, jumps drift with it, and going against it you are lighter', () => {
  const L = level(2);
  assert.equal(L.key, 'beginning');
  assert.ok(Math.abs(SPIN * SPIN * R - 25) < 1e-9, 'ω²R is the sim gravity');
  assert.equal(L.spin, SPIN * RING.coriolis);
  const save = L.spin;
  /** A standing jump straight up: where it lands along z. */
  const hop = (spin) => {
    L.spin = spin;
    let s = { ...levelSpawn(L.id), x: 0, z: 100 }, t = 0;
    do s = step(s, t++ < 2 ? JUMP : 0, quantizeYaw(0)); while (!s.grounded || t < 3);
    return s.z - 100;
  };
  /** A running jump along +z (against the spin): how far it carries. */
  const leap = (spin, yaw) => {
    L.spin = spin;
    let s = { ...levelSpawn(L.id), x: 0, z: 100 };
    for (let t = 0; t < 120; t++) s = step(s, FORWARD, yaw);
    const z0 = s.z;
    let t = 0;
    do s = step(s, FORWARD | (t++ < 2 ? JUMP : 0), yaw); while (!s.grounded || t < 3);
    return Math.abs(s.z - z0);
  };
  try {
    assert.equal(hop(0), 0);
    // Up and down, it lands along the spin (-z), a few tens of cm off.
    const d = hop(SPIN);
    assert.ok(d < -0.1 && d > -0.6, `drift ${d}`);
    const against = leap(SPIN, quantizeYaw(Math.PI)), with_ = leap(SPIN, quantizeYaw(0)), still = leap(0, quantizeYaw(Math.PI));
    assert.ok(against > still && with_ < still, `against ${against}, with ${with_}, none ${still}`);
    // Deterministic: the same inputs, the same state.
    assert.equal(leap(SPIN, quantizeYaw(Math.PI)), against);
  } finally {
    L.spin = save;
  }
});
