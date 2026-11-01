import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CABINET, DECKS, LADDER, PAD_R, spotAt, SPOTS, spotNear, TOWER, TOWER_MIN_R, TOWER_REACH, towerGround, towerLadder,
  towersNear, towerSolid, towerToWorld,
} from '../shared/towers.ts';
import { ORIGIN } from '../shared/origin.ts';
import { heightAt } from '../shared/terrain.ts';
import { crashSitesNear } from '../shared/crashsites.ts';
import { sheltersNear } from '../shared/shelters.ts';
import { solarFarmsNear } from '../shared/solarfarms.ts';
import { BACK, FORWARD, JUMP, LEFT, quantizeYaw, RIGHT, spawnState, step } from '../shared/sim.ts';

const towers = towersNear(ORIGIN.x, ORIGIN.z, 6000);

test('radio towers stand here and there, on padded ground, clear of the rest', () => {
  assert.ok(towers.length >= 4, `the deterministic world has towers within 6 km (${towers.length})`);
  for (const t of towers) {
    assert.ok(Math.hypot(t.x - ORIGIN.x, t.z - ORIGIN.z) >= TOWER_MIN_R);
    for (const o of towers) if (o !== t) assert.ok(Math.hypot(o.x - t.x, o.z - t.z) >= 800, 'towers stand apart');
    assert.equal(crashSitesNear(t.x, t.z, TOWER_REACH).length, 0, 'no crash site on a tower');
    assert.ok(sheltersNear(t.x, t.z, TOWER_REACH + 30).every((s) => Math.hypot(s.x - t.x, s.z - t.z) > TOWER_REACH), 'no shelter on a tower');
    assert.equal(solarFarmsNear(t.x, t.z, 600).length, 0, 'not on a solar farm');
    for (let i = 0; i < 30; i++) {
      const a = i * 2.39996, r = (PAD_R - 1) * Math.sqrt((i + 0.5) / 30);
      assert.equal(heightAt(t.x + Math.sin(a) * r, t.z + Math.cos(a) * r), t.y, 'the pad is flat');
    }
  }
});

/** Run ticks of input with the camera's yaw. */
function run(s, input, yaw, ticks) {
  for (let i = 0; i < ticks; i++) s = step(s, input, quantizeYaw(yaw));
  return s;
}

test('the ladder: climb to the top, stand on the decks, come back down', () => {
  const t = towers[0];
  // The ladder's column, and in front of it on the sand.
  const [cx, cz] = towerToWorld(t, LADDER.at, 0);
  const at = { x: t.x + cx, z: t.z + cz };
  let s = spawnState(at.x, at.z, t.y);
  assert.ok(towerLadder(s.x, s.y, s.z), 'in the column at its foot');
  // W climbs; nothing held, you hang where you are.
  s = run(s, FORWARD, 0, 60 * 5);
  assert.ok(s.y > t.y + 10, `climbed (${(s.y - t.y).toFixed(1)} m)`);
  const hang = s.y;
  s = run(s, 0, 0, 60);
  assert.equal(s.y, hang, 'hangs still');
  // To the top (it stops there).
  s = run(s, FORWARD, 0, 60 * 60);
  assert.equal(s.y, t.y + TOWER.height, 'at the top deck');
  // Step off sideways onto the top deck, and stand there.
  const yawSide = 0;
  s = run(s, RIGHT, yawSide, 60);
  assert.equal(towerLadder(s.x, s.y, s.z), null, 'off the ladder');
  s = run(s, 0, 0, 60);
  assert.equal(s.y, t.y + TOWER.height, 'standing on the top deck');
  assert.ok(s.grounded);
  // The rail keeps you on it: walk a long way one way.
  for (const yaw of [0, 2.1, 4.2]) {
    const r = run(s, FORWARD, yaw, 60 * 4);
    assert.equal(r.y, t.y + TOWER.height, 'still on the deck after walking into the rail');
  }
  // Back into the hatch: S goes down; stop at the dish deck and step off.
  s = run(s, LEFT, yawSide, 60);
  assert.ok(towerLadder(s.x, s.y, s.z), 'back on the ladder');
  const toDish = (TOWER.height - DECKS[1]) / 2.6;
  s = run(s, BACK, 0, Math.round(toDish * 60));
  assert.ok(Math.abs(s.y - (t.y + DECKS[1])) < 0.2, `near the dish deck (${(s.y - t.y).toFixed(2)})`);
  s = run(s, RIGHT, 0, 60);
  s = run(s, 0, 0, 30);
  assert.equal(s.y, t.y + DECKS[1], 'standing on the dish deck');
  // Let go of the ladder (from a fresh grip, 60 m up): you drop onto the rest deck under it (no fall damage).
  s = spawnState(at.x, at.z, t.y + 60);
  s = run(s, JUMP, 0, 1);
  assert.equal(towerLadder(s.x, s.y, s.z), null, 'let go of it');
  s = run(s, 0, 0, 60 * 8);
  assert.ok(s.grounded && s.y === t.y + DECKS[0], `fell and landed on the rest deck (${(s.y - t.y).toFixed(2)})`);
  // Over the rail (jumped) and off the deck's edge to the sand.
  s = run(s, FORWARD | JUMP, Math.PI, 30);
  s = run(s, FORWARD, Math.PI, 60 * 10);
  assert.ok(s.grounded && s.y < t.y + 1, `down on the sand (${(s.y - t.y).toFixed(2)})`);
});

test('the legs and cabinet are solid; the spots for fitting parts are on the decks', () => {
  const t = towers[0];
  const [lx, lz] = towerToWorld(t, (TOWER.base / Math.sqrt(3)), 0);
  assert.equal(towerSolid(t.x + lx, t.y + 0.5, t.z + lz), true, 'a leg at its foot');
  const [kx, kz] = towerToWorld(t, CABINET.at, 0);
  assert.equal(towerSolid(t.x + kx, t.y + 1, t.z + kz), true, 'the cabinet');
  assert.equal(towerSolid(t.x, t.y + 60, t.z), null, 'the middle is open');
  for (let i = 0; i < SPOTS.length; i++) {
    const p = spotAt(t, i);
    assert.equal(spotNear(p.x, p.y, p.z, 1.5)?.i, i);
    if (i) assert.equal(towerGround(p.x, p.z, p.y), p.y, 'a deck under the spot');
  }
});

test('fixing a tower: its fixtures are made as you come near, open where they are fitted, and with every part in and a charged battery it comes alive and draws on it', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDb } = await import('../server/db.ts');
  const { ItemServer } = await import('../server/items.ts');
  const { TowerServer } = await import('../server/towers.ts');
  const { towerBox } = await import('../shared/boxes.ts');
  const { GEAR, repaired } = await import('../shared/gear.ts');
  const { chargeOf, partAt, partKind, setPart } = await import('../shared/items.ts');
  const { openBoxes } = await import('../shared/storage.ts');
  const { SPOT_ITEMS } = await import('../shared/towers.ts');
  const dir = mkdtempSync(join(tmpdir(), 'paahde-towers-'));
  try {
    const db = openDb(join(dir, 'world.db'));
    const items = new ItemServer(db);
    const sent = [];
    const towersSrv = new TowerServer(items, (box) => sent.push(box));
    const t = towers[0];
    assert.equal(towersSrv.tick([{ x: t.x + 2000, z: t.z }], 1, 0), false, 'nothing made from far off');
    assert.equal(sent.length, 0);
    towersSrv.tick([{ x: t.x + 300, z: t.z }], 1, 0);
    const boxes = SPOTS.map((_, i) => towerBox(t.id, i));
    assert.deepEqual(sent, boxes, 'its three fixtures made and sent');
    const fixtures = boxes.map((b) => items.slots('', b)[0]);
    assert.deepEqual(fixtures.map((f) => f.kind), [...SPOT_ITEMS]);
    assert.ok(!fixtures.every((f) => repaired(f)), 'found broken');
    // Each opens where it's fitted, only there.
    for (let i = 0; i < SPOTS.length; i++) {
      const p = spotAt(t, i);
      assert.ok(openBoxes({ x: p.x, y: p.y, z: p.z, level: 0, riding: false }).includes(boxes[i]));
      assert.ok(!openBoxes({ x: p.x, y: p.y + 30, z: p.z, level: 0, riding: false }).includes(boxes[i]));
    }
    // Every part in, the battery charged: alive.
    for (const f of fixtures) GEAR[f.kind].slots.forEach((s, i) => {
      if (!f.parts?.[i]) setPart(f, i, { kind: 'part' in s ? partKind(s.part, 'scrap') : s.scrap[0] });
    });
    const battery = GEAR.tower_radio.slots.findIndex((s) => s.part === 'battery');
    setPart(fixtures[0], battery, { kind: 'battery_scrap', data: { charge: 1 } });
    assert.equal(towersSrv.tick([{ x: t.x, z: t.z }], 1, 1000), true, 'came alive');
    assert.deepEqual(towersSrv.msg(), { t: 'towers', alive: [t.id] });
    // It draws on the battery: a Scrap one lasts some three real hours.
    for (let s = 0; s < 3600; s++) towersSrv.tick([{ x: t.x, z: t.z }], 1, 2000 + s * 1000);
    const left = chargeOf(partAt(fixtures[0], battery));
    assert.ok(left > 0.55 && left < 0.8, `an hour took a third of it (${left.toFixed(2)} left)`);
    // A part out: dead again.
    setPart(fixtures[1], 0, null);
    assert.equal(towersSrv.tick([{ x: t.x, z: t.z }], 1, 1e7), true);
    assert.deepEqual(towersSrv.msg(), { t: 'towers', alive: [] });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a couple of drones keep a tower: shot down they stay down until everyone has left, and are back next time', async () => {
  const { DroneServer } = await import('../server/drones.ts');
  const t = towers[0];
  const srv = new DroneServer();
  const at = (x, z) => ({ id: 1, x, y: heightAt(x, z), z, safe: false });
  const tick = (p, n = 1) => {
    for (let i = 0; i < n; i++) srv.tick(0.1, 1000 + i * 100, 0.5, [p], [p], new Map([[1, p]]), [], () => {});
  };
  const mine = () => srv.drones.filter((d) => d.site <= -1_000_000 && d.downAt < 0 && !d.leaving);
  tick(at(t.x + 900, t.z));
  assert.equal(mine().length, 0, 'none from far off');
  const near = at(t.x + 300, t.z);
  tick(near);
  assert.equal(mine().length, 2, 'two come');
  for (const d of mine()) d.downAt = 1000; // shot down
  tick(near, 600);
  assert.equal(mine().length, 0, 'none come back while you stay');
  tick(at(t.x + 1500, t.z), 5);
  tick(near);
  assert.equal(mine().length, 2, 'back once you have left and come again');
});
