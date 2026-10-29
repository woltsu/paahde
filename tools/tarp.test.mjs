// The tarp (shared/tarp.ts): made by hand, no wrench; you walk in between its poles and stand under the high middle,
// the low sides are solid; under it is shade; things fit under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craft, HAND_RECIPES, isBuildable } from '../shared/crafting.ts';
import { placeError, placedY, setPlaced, placed } from '../shared/placed.ts';
import { collideOutdoor } from '../shared/capsules.ts';
import { heightAt } from '../shared/terrain.ts';
import { sunOnBody } from '../shared/shade.ts';
import { canvasYAt, tarpRig } from '../shared/tarp.ts';
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

test('in between the poles to the middle, the low sides solid', () => {
  put(0);
  const mid = walk(-8, 0.3, 0, 0);
  assert.ok(Math.hypot(mid.x, mid.z) < 0.1, `from the pole's side: ${JSON.stringify(mid)}`);
  const low = walk(0, 8, 0, 0);
  assert.ok(low.z > 1.5, `under the low side: ${JSON.stringify(low)}`);
  const out = walk(0, 0, 0, 6);
  assert.ok(out.z < 2.2, `out under the low side: ${JSON.stringify(out)}`);
  // Where you can stand, there's room for a head.
  const r = tarpRig(X, Z, 0);
  for (const [x, z] of [[0, 0], [1, 0.5], [-2, -1], [3, 0]]) assert.ok(canvasYAt(r, X + x, Z + z) - heightAt(X + x, Z + z) > 1.9, `${x},${z}`);
});

test('shade under the middle all day with the low sides to the sun', () => {
  put(0);
  for (let h = 7; h <= 17; h += 1) {
    assert.equal(sunOnBody(X, heightAt(X, Z), Z, false, h / 24), 0, `${h}:00`);
    assert.equal(sunOnBody(X + 30, heightAt(X + 30, Z), Z, false, h / 24), 1, `open sand at ${h}:00`);
  }
});

test('a bedroll, a chest and a workbench go under it', () => {
  put(0);
  assert.equal(placeError('bedroll', X + 1.5, Z, 0, null, placed), null);
  assert.equal(placeError('storage_chest', X - 2, Z + 0.5, 0, null, placed), null);
  assert.equal(placeError('workbench', X, Z - 1, 0, null, placed), null);
});
