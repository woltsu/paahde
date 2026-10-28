// The beginning (shared/levels/beginning.ts, docs/levels/tutorial.md), walked with the real step(): from the bunk to the
// pod's hatch with every gate opened in the order the server opens them; each obstacle stops you while its gate is shut
// or until you do the thing it asks (crouch, jump, air jump, slide); the sub-floor has a way back up; nothing in it can
// harm you; the relay is the only item it gives, and the pod takes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { level, LEVELS } from '../shared/levels.ts';
import { BEGINNING, BLAST, CABINET, FALLEN, GAP, GATE, POD, TRAY, beatAt, beginningLevel, triggersAt } from '../shared/levels/beginning.ts';
import { CROUCH, FORWARD, JUMP, SLIDE, levelSpawn, quantizeYaw, step } from '../shared/sim.ts';
import { ITEMS, levelOnlyItems } from '../shared/items.ts';
import * as tables from '../shared/tables.ts';

const inBoxFeet = (b, s) => s.x >= b[0] && s.x <= b[1] && s.y >= b[2] && s.y <= b[3] && s.z >= b[4] && s.z <= b[5];

const L = beginningLevel;

/** Walk `s` towards (x, z) with these extra keys (`keys(s, t)`: per tick), the gates opened by `open(s)` every tick;
 *  up to `max` s. Returns the state on arrival (within 0.3 m, on the ground) or when time ran out. */
function walk(s, x, z, { keys = () => 0, open = (st) => st.gates | triggersAt(st.x, st.y, st.z), max = 20 } = {}) {
  for (let t = 0; t < max * 60; t++) {
    if (Math.hypot(s.x - x, s.z - z) < 0.3 && s.grounded) return s;
    const yaw = Math.atan2(-(x - s.x), -(z - s.z));
    s = step({ ...s, gates: open(s) }, FORWARD | keys(s, t), quantizeYaw(yaw));
    assert.equal(s.level, L.id);
  }
  return s;
}

/** Stand still a moment (landing, a slide running out). */
function settle(s, ticks = 40) {
  for (let t = 0; t < ticks; t++) s = step({ ...s, gates: s.gates | triggersAt(s.x, s.y, s.z) }, 0, quantizeYaw(s.facing));
  return s;
}

/** Jump at the first tick, the air jump at the top (`air`), else nothing. */
const jumps = (air) => (s, t) => (t < 2 ? JUMP : air && t > 22 && t < 25 ? JUMP : 0);

/** From the spawn up to just before the fallen rack, gates as the server opens them. */
function toAisle() {
  let s = settle(levelSpawn(L.id));
  s = walk(s, 0, 6);
  s = walk(s, 0, 13);
  s = walk(s, 0, 18, { keys: () => CROUCH });
  s = walk(s, 0, 45.5);
  return s;
}

test('the registry: the beginning is a private, immortal, crouch-under level with no weather, enemies or things', () => {
  assert.equal(LEVELS[L.id], L);
  assert.equal(level(L.id).key, 'beginning');
  assert.ok(L.private && !L.mortal && L.crouchUnder && L.flat && L.indoors);
  assert.ok(!L.weather && !L.enemies && !L.building && !L.things);
  assert.ok(L.climate && L.climate.tempC <= 22, 'no heat');
});

test('the walk: bunk to pod with every gate opened in order', () => {
  let s = toAisle();
  assert.ok(s.z > 45 && s.y === 0, `stuck at ${s.z.toFixed(2)}`);
  // Over the fallen rack: a jump from just before it.
  s = walk(s, 0, FALLEN.z0 - 0.9);
  s = walk(s, 0, 52, { keys: jumps(false) });
  s = settle(s);
  assert.ok(s.z > FALLEN.z1 && Math.abs(s.y) < 1e-6, `not over the rack: ${s.z.toFixed(2)}, ${s.y.toFixed(2)}`);
  // Over the gap: a run-up, the jump at its edge, the air jump at the top.
  s = walk(s, 0, 49.5);
  s = settle(s);
  s = walk(s, 0, GAP.z0 - 0.4);
  s = walk(s, 0, 63, { keys: jumps(true) });
  s = settle(s);
  assert.ok(s.z > GAP.z1 && Math.abs(s.y) < 1e-6, `fell in the gap: ${s.z.toFixed(2)}, ${s.y.toFixed(2)}`);
  // The control room: its door shut until the relay is out (the server's GATE.control).
  s = walk(s, 0, 66);
  let shut = walk(s, 0, 74, { max: 6 });
  assert.ok(shut.z < 72, `through the shut control door: ${shut.z}`);
  const relayOut = (st) => st.gates | GATE.control | triggersAt(st.x, st.y, st.z);
  s = walk(s, 0, 80, { open: relayOut });
  assert.ok(s.gates & GATE.blast, 'the blast door never started');
  // The blast door: standing, it stops you; a slide (or a crouch) gets under it.
  const stood = walk(s, 0, 90.5, { open: relayOut, max: 6 });
  assert.ok(stood.z < BLAST.z0, `walked through the blast door standing: ${stood.z}`);
  s = walk(s, 0, 84, { open: relayOut });
  s = walk(s, 0, 91, { open: relayOut, keys: (_s, t) => (t < 20 ? SLIDE : 0) });
  assert.ok(s.z > BLAST.z1, `didn't get under the blast door: ${s.z.toFixed(2)}`);
  s = walk(s, 0, 92.5, { open: relayOut });
  assert.ok(s.gates & GATE.shut);
  // Shut behind you.
  const back = walk({ ...s }, 0, 85, { open: relayOut, keys: () => CROUCH, max: 8 });
  assert.ok(back.z > BLAST.z1, `back under the shut blast door: ${back.z}`);
  // The hatch.
  s = walk(s, 0, 97.6, { open: relayOut });
  assert.ok(inBoxFeet(POD.hatch, s), `not at the hatch: ${s.x.toFixed(2)}, ${s.z.toFixed(2)}`);
  assert.ok(L.doors().some((d) => inBoxFeet(d.trigger, s)));
});

test('crouching under the fallen tray', () => {
  let s = settle(levelSpawn(L.id));
  s = walk(s, 0, 6);
  // The quarters' door shut: you stay in.
  const shut = walk({ ...s, gates: 0 }, 0, 12, { open: () => 0, max: 6 });
  assert.ok(shut.z < 8, `through the shut door: ${shut.z}`);
  s = walk(s, 0, 13);
  // Standing, the tray stops you; jumping under it you don't get onto it.
  const stood = walk(s, 0, 18, { max: 6, keys: (_s, t) => (t % 50 < 2 ? JUMP : 0) });
  assert.ok(stood.z < TRAY.z0, `walked through the tray standing: ${stood.z}`);
  const under = walk(s, 0, 18, { keys: () => CROUCH, max: 10 });
  assert.ok(under.z > TRAY.z1, `didn't crouch under: ${under.z}`);
  // Let go of crouch right under it: still crouched (no room to stand), and walked out the other side.
  let mid = walk(s, 0, (TRAY.z0 + TRAY.z1) / 2, { keys: () => CROUCH });
  mid = settle(mid, 5);
  assert.ok(mid.crouching, 'stood up under the tray');
  assert.ok(Math.abs(mid.z - (TRAY.z0 + TRAY.z1) / 2) < 0.5, `pushed out: ${mid.z}`);
  mid = walk(mid, 0, 18, { max: 10 });
  assert.ok(mid.z > TRAY.z1 + 1, `stuck under the tray: ${mid.z}`);
});

test('the fallen rack needs a jump, the gap the air jump, and the sub-floor has a way back up', () => {
  let s = toAisle();
  const walked = walk(s, 0, 52, { max: 6 });
  assert.ok(walked.z < FALLEN.z0, `walked through the fallen rack: ${walked.z}`);
  s = walk(s, 0, FALLEN.z0 - 0.9);
  s = settle(walk(s, 0, 52, { keys: jumps(false) }));
  s = settle(walk(s, 0, 49.5));
  s = walk(s, 0, GAP.z0 - 0.4);
  // One jump only: down into the sub-floor.
  let fell = settle(walk(s, 0, 63, { keys: jumps(false), max: 4 }), 120);
  assert.ok(fell.y < -2 && fell.grounded, `one jump crossed the gap: ${fell.z.toFixed(2)}, ${fell.y.toFixed(2)}`);
  assert.equal(beatAt(fell.x, fell.y, fell.z), 5);
  // Back up: onto the ladder of trays, a jump each, then up onto the aisle's floor.
  fell = walk(fell, 1.9, 55.6);
  fell = settle(walk(fell, 1.9, 54.4, { keys: jumps(false), max: 3 }));
  assert.ok(Math.abs(fell.y + 1.6) < 1e-6, `not on the first tray: ${fell.y}`);
  fell = settle(walk(fell, 0.7, 54.4, { keys: jumps(false), max: 3 }));
  assert.ok(Math.abs(fell.y + 0.8) < 1e-6, `not on the second tray: ${fell.y}`);
  fell = settle(walk(fell, 0.7, 52.5, { keys: jumps(false), max: 3 }));
  assert.ok(Math.abs(fell.y) < 1e-6 && fell.z < GAP.z0, `not back up: ${fell.z.toFixed(2)}, ${fell.y.toFixed(2)}`);
});

test('nothing in it can harm you: no fall is hard, nothing reaches in', () => {
  // The worst fall here, into the sub-floor from a double jump, lands slower than a hard landing hurts (it slows you at
  // most) and nothing in the server's hurt runs in an immortal level (tools/server-beginning.test.mjs).
  let s = { ...levelSpawn(L.id), x: 0, z: (GAP.z0 + GAP.z1) / 2, y: 4.5 - 1.8, grounded: false };
  let fastest = 0;
  for (let t = 0; t < 120; t++) {
    fastest = Math.max(fastest, -s.vy);
    s = step(s, 0, quantizeYaw(0));
  }
  assert.ok(s.grounded && s.y < -2);
  assert.ok(!L.mortal);
  assert.ok(fastest < 20, `fell at ${fastest}`);
});

test('the relay is the only item it gives, never loot, and it belongs to the level', () => {
  assert.deepEqual(levelOnlyItems('beginning'), ['tut_relay']);
  assert.equal(ITEMS.tut_relay.levelOnly, 'beginning');
  assert.ok(!JSON.stringify(Object.values(tables)).includes('tut_relay'), 'the relay is in a loot table or recipe');
  assert.ok(CABINET.kind === 'control_cabinet');
  // Every box is inside the bounds.
  for (const b of BEGINNING.boxes) {
    const B = BEGINNING.bounds;
    assert.ok(b.b[0] >= B[0] - 1e-6 && b.b[1] <= B[1] + 1e-6 && b.b[4] >= B[4] - 1e-6 && b.b[5] <= B[5] + 1e-6, `box out of bounds ${b.b}`);
  }
});
