// The tarp (shared/tarp.ts): made by hand, no wrench; you walk in under it, its poles solid; the canvas stops a jump from
// under it and holds you up from above; under it is shade; things fit under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craft, HAND_RECIPES, isBuildable } from '../shared/crafting.ts';
import { placeError, placedY, setPlaced, placed } from '../shared/placed.ts';
import { collideOutdoor } from '../shared/capsules.ts';
import { heightAt } from '../shared/terrain.ts';
import { sunOnBody } from '../shared/shade.ts';
import { canvasYAt, TARP_HALF, tarpRig } from '../shared/tarp.ts';
import { JUMP, PLAYER_HEIGHT, quantizeYaw, spawnState, step } from '../shared/sim.ts';
import { freeSlots } from '../shared/items.ts';

const X = 400, Z = -300;
const put = (rot) => setPlaced([{ id: 1, kind: 'tarp', x: X, y: placedY('tarp', X, Z, rot, null), z: Z, rot }]);

/** Walk from (sx, sz) towards (ex, ez) (offsets from the tarp) in 5 cm steps, colliding: where we end up. */
function walk(sx, sz, ex, ez) {
  const p = { x: X + sx, z: Z + sz, vx: 0, vz: 0 };
  for (let i = 0; i < 400; i++) {
    const dx = X + ex - p.x, dz = Z + ez - p.z, l = Math.hypot(dx, dz);
    if (l < 0.05) break;
    p.x += (dx / l) * 0.05;
    p.z += (dz / l) * 0.05;
    const y = heightAt(p.x, p.z);
    collideOutdoor(p, y, y, 0.3, 1.8, 0.4);
  }
  return { x: p.x - X, z: p.z - Z };
}

test('made by hand from cloth and scrap, not put up with the wrench', () => {
  assert.ok(HAND_RECIPES.tarp);
  assert.ok(!isBuildable('tarp'));
  let id = 1;
  const bag = [{ id: id++, kind: 'cloth', n: 3 }, { id: id++, kind: 'scrap', n: 2 }, ...Array(10).fill(null)];
  assert.ok(craft(bag, 'tarp', () => id++, freeSlots(bag.length)));
  assert.deepEqual(bag.filter(Boolean).map((it) => it.kind), ['tarp']);
});

test('walked under from the poles\' sides and the low sides alike, the poles solid', () => {
  put(0);
  const mid = walk(-8, 0.3, 0, 0);
  assert.ok(Math.hypot(mid.x, mid.z) < 0.1, `from the pole's side: ${JSON.stringify(mid)}`);
  const low = walk(1.2, 8, 0, 0);
  assert.ok(Math.hypot(low.x, low.z) < 0.1, `under the low side: ${JSON.stringify(low)}`);
  const pole = walk(9, 0, 0, 0);
  assert.ok(pole.x > TARP_HALF, `through the pole: ${JSON.stringify(pole)}`);
  // Where you can walk, there's room for a head.
  const r = tarpRig(X, Z, 0);
  for (const [x, z] of [[0, 0], [1, 0.5], [-2, -1], [3, 0], [0.5, 3.5], [-1, -3]]) assert.ok(canvasYAt(r, X + x, Z + z) - heightAt(X + x, Z + z) > 1.9, `${x},${z}`);
});

test('shade under the middle through the day with the low sides to the sun', () => {
  put(0);
  for (let h = 9; h <= 17; h += 1) {
    assert.equal(sunOnBody(X, heightAt(X, Z), Z, false, h / 24), 0, `${h}:00`);
    assert.equal(sunOnBody(X + 30, heightAt(X + 30, Z), Z, false, h / 24), 1, `open sand at ${h}:00`);
  }
});

test('a jump from under the canvas stops at it', () => {
  put(0);
  const r = tarpRig(X, Z, 0);
  for (const [x, z] of [[0, 0], [2, 0.5], [-1, 2.5]]) {
    const cy = canvasYAt(r, X + x, Z + z);
    let s = spawnState(X + x, Z + z);
    let high = -Infinity;
    for (let t = 0; t < 120; t++) {
      // Jump, then the air jump at the top.
      s = step(s, t < 3 || (t > 22 && t < 25) ? JUMP : 0, quantizeYaw(0));
      high = Math.max(high, s.y);
    }
    assert.ok(high + PLAYER_HEIGHT <= cy + 1e-6, `${x},${z}: head at ${(high + PLAYER_HEIGHT).toFixed(2)} through ${cy.toFixed(2)}`);
    assert.ok(s.grounded && Math.abs(s.y - heightAt(s.x, s.z)) < 0.05, `${x},${z}: ended at ${s.y}`);
  }
});

test('dropped onto it from above you land on the canvas, not through it', () => {
  put(0);
  const r = tarpRig(X, Z, 0);
  for (const [x, z] of [[0, 0], [-1.5, 1], [2.5, -0.5]]) {
    const cy = canvasYAt(r, X + x, Z + z);
    let s = { ...spawnState(X + x, Z + z, cy + 3), grounded: false };
    for (let t = 0; t < 120; t++) {
      s = step(s, 0, quantizeYaw(0));
      const c = canvasYAt(r, s.x, s.z);
      // Over the canvas the feet never go under it (slid off past its edge: NaN).
      assert.ok(!(s.y < c - 0.05), `${x},${z}: tick ${t} at ${s.y.toFixed(2)} under ${c.toFixed(2)}`);
    }
    assert.ok(s.grounded && s.y > heightAt(s.x, s.z) + 1, `${x},${z}: ended at ${s.y.toFixed(2)} on the sand`);
  }
});

test('a bedroll, a chest and a workbench go under it', () => {
  put(0);
  assert.equal(placeError('bedroll', X + 1.5, Z, 0, null, placed), null);
  assert.equal(placeError('storage_chest', X - 2, Z + 0.5, 0, null, placed), null);
  assert.equal(placeError('workbench', X, Z - 1, 0, null, placed), null);
});
