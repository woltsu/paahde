// Gameplay test scenarios (shared/scenarios.ts): what they carry exists, and their places in the test world's seed are
// still open sand with a clear line of sight to the enemies placed round them (a seed or terrain change that moves a dune
// or a wreck onto a scenario shows up here).
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.WORLD_ID = 'test'; // (the layouts are seeded from the world id as the shared modules load)
const { TEST_WORLD, WORLD_ID } = await import('../shared/world.ts');
const { SCENARIOS } = await import('../shared/scenarios.ts');
const { ITEMS, HOTBAR } = await import('../shared/items.ts');
const { GEAR } = await import('../shared/gear.ts');
const { heightAt } = await import('../shared/terrain.ts');
const { crashSitesNear } = await import('../shared/crashsites.ts');
const { sheltersNear } = await import('../shared/shelters.ts');
const { BODY_H } = await import('../shared/guardians.ts');

test('scenarios are seeded from the test world', () => assert.equal(WORLD_ID, TEST_WORLD));

test('scenario ids are unique and what they carry exists', () => {
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const sc of SCENARIOS) {
    assert.ok(sc.hotbar.length <= HOTBAR, `${sc.id}: more than the hotbar holds`);
    for (const it of [...sc.hotbar, ...(sc.bag ?? [])]) {
      assert.ok(it.kind in ITEMS, `${sc.id}: no item ${it.kind}`);
      if (it.tier) assert.ok(GEAR[it.kind], `${sc.id}: ${it.kind} has a tier but isn't gear`);
    }
    assert.ok(sc.tod >= 0 && sc.tod < 1, `${sc.id}: time of day out of 0..1`);
  }
});

test('scenario places are open, with a clear line to each enemy', () => {
  for (const sc of SCENARIOS) {
    const { x, z, facing } = sc.at;
    assert.equal(crashSitesNear(x, z, 60).length, 0, `${sc.id}: a crash site on the spot`);
    assert.equal(sheltersNear(x, z, 60).length, 0, `${sc.id}: a shelter on the spot`);
    const eye = heightAt(x, z) + 1.7;
    for (const e of sc.enemies) {
      // Placed as server/world.ts onScenario places it; the line to the middle of a guardian's body.
      const a = facing + (e.bearing ?? 0), ex = x - Math.sin(a) * e.dist, ez = z - Math.cos(a) * e.dist;
      const top = heightAt(ex, ez) + BODY_H / 2;
      for (let t = 0.02; t < 1; t += 0.01) {
        const ground = heightAt(x + (ex - x) * t, z + (ez - z) * t);
        assert.ok(ground < eye + (top - eye) * t, `${sc.id}: ground in the way of the ${e.kind} at ${Math.round(t * e.dist)} m`);
      }
    }
  }
});
