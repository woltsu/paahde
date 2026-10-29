// The beginning (shared/levels/beginning.ts, docs/levels/tutorial.md), walked with the real step(): from the bunk to the
// pod's hatch with every gate opened in the order the server opens them; each obstacle stops you while its gate is shut
// or until you do the thing it asks (crouch, jump, air jump, slide); the sub-floor has a way back up; nothing in it can
// harm you; the relay is the only item it gives, and the pod takes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { level, LEVELS } from '../shared/levels.ts';
import { BEGINNING, BLAST, CABINET, CART, CART_CROSSED, FALLEN, GAP, GATE, POD, POD_OPEN_MS, TRAY, WINDOW, beatAt, beginningLevel, cartTicks, cartX, triggersAt } from '../shared/levels/beginning.ts';
import { CROUCH, FORWARD, JUMP, PLAYER_RADIUS, SLIDE, levelSpawn, quantizeYaw, step } from '../shared/sim.ts';
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
  // The pod's hull stops you short of it, still at the hatch.
  const bumped = walk({ ...s }, 0, 100.2, { open: relayOut, max: 3 });
  assert.ok(bumped.z < POD.hull[4] && inBoxFeet(POD.hatch, bumped), `into the pod or past its hatch: ${bumped.z.toFixed(2)}`);
  assert.equal(L.doors().length, 0, 'an F that just takes you out');
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

test('the cabinet door comes first: nothing inside it can be worked (or shows its marker) while it is shut', async () => {
  const { cabinetSteps, CABINET_SEED } = await import('../shared/levels/beginningCabinet.ts');
  const { stepList, stepAllowed } = await import('../shared/machineSteps.ts');
  for (const rules of [cabinetSteps(), ...[1, 7919, 23757].map((seed) => stepList('control_cabinet', seed + CABINET_SEED, 2))]) {
    const first = rules.list.map((_, i) => i).filter((i) => stepAllowed(rules, new Set(), i));
    assert.equal(first.length, 1, 'more than the door latch can be worked at first');
    // Every other step waits on the latch (and so on the door's seam after it).
    const waits = (i, seen = new Set()) => rules.list[i].after.some((n) => n === first[0] || (!seen.has(n) && (seen.add(n), waits(n, seen))));
    rules.list.forEach((_, i) => i === first[0] || assert.ok(waits(i), `step ${i} can be worked through the shut door`));
  }
});

test('the cabinet and the pod on the server: the relay out opens the door, into the panel powers the pod, F rides it down', async () => {
  const { TutorialServer, RIDE_MS, atHatch } = await import('../server/tutorial.ts');
  const { CABINET_GONE, RELAY_INDEX, cabinetSteps } = await import('../shared/levels/beginningCabinet.ts');
  const t = new TutorialServer();
  const at = (x, z, gates = 0) => ({ ...levelSpawn(L.id), x, z, gates });
  // Too far from it: nothing.
  assert.equal(t.site(1, at(0, 2), { t: 'siteJoin' }, () => true).answers.length, 0);
  const s = at(CABINET.x - 1.5, CABINET.z);
  const join = t.site(1, s, { t: 'siteJoin' }, () => true).answers[0];
  assert.equal(join.t, 'siteState');
  assert.deepEqual([...join.taken].sort(), [...CABINET_GONE].sort(), 'only the relay is left to take');
  // The relay can't come out before what holds it; every step in an allowed order, then it does.
  let bag = 0;
  const give = () => (bag++, true);
  assert.equal(t.site(1, s, { t: 'siteTake', i: RELAY_INDEX }, give).answers.length, 0);
  const rules = cabinetSteps();
  const done = new Set();
  while (done.size < rules.list.length) {
    const i = rules.list.findIndex((r, k) => !done.has(k) && r.after.every((n) => done.has(n)));
    assert.ok(i >= 0, 'a step left that can never be done');
    const r = t.site(1, s, { t: 'siteDone', i }, give);
    assert.equal(r.answers[0]?.t, 'siteDone');
    assert.equal(r.gates, 0, 'a step opened something');
    done.add(i);
  }
  for (const i of CABINET_GONE) assert.equal(t.site(1, s, { t: 'siteTake', i }, give).answers.length, 0, 'another part came out');
  const took = t.site(1, s, { t: 'siteTake', i: RELAY_INDEX }, give);
  assert.ok(took.gates & GATE.control, 'the door stayed shut');
  assert.equal(bag, 1);
  assert.equal(took.answers.find((a) => a.t === 'siteTook').kind, 'tut_relay');
  assert.equal(t.site(1, s, { t: 'siteTake', i: RELAY_INDEX }, give).answers.length, 0, 'a second relay');
  // Another player's cabinet is whole.
  assert.ok(!t.site(2, s, { t: 'siteJoin' }, give).answers[0].taken.includes(RELAY_INDEX));
  // The hatch: away from it nothing; without the relay nothing; with it, powered (it is used up); then in and down.
  const hatch = at(0, 98, took.gates);
  assert.ok(atHatch(hatch));
  assert.equal(t.hatch(1, at(0, 90, took.gates), () => true, 0), null);
  assert.equal(t.hatch(1, hatch, () => false, 0), null);
  let used = 0;
  const powered = t.hatch(1, hatch, () => (used++, true), 0);
  assert.ok(powered & GATE.powered && used === 1);
  // Not in while its hatch is still swinging open (POD_OPEN_MS), then in.
  assert.equal(t.hatch(1, { ...hatch, gates: powered }, () => (used++, true), POD_OPEN_MS - 1), null, 'in before the hatch was open');
  const go = POD_OPEN_MS;
  const launch = t.hatch(1, { ...hatch, gates: powered }, () => (used++, true), go);
  assert.ok(launch & GATE.launch && used === 1, 'the pod took a second relay');
  assert.ok(t.riding(1) && !t.landed(1, go + RIDE_MS - 1) && t.landed(1, go + RIDE_MS) && !t.riding(1));
  // Back after a reconnect with the relay already in (a new server's memory): its hatch stands open, in at once.
  const fresh = new TutorialServer();
  assert.ok(fresh.hatch(3, { ...hatch, gates: powered }, () => false, 0) & GATE.launch);
});

test('every solid is drawn: nothing invisible in your way', () => {
  // A collide-only box is drawn by the instanced racks standing in it, or by the stage (src/levels/beginning): these.
  const byStage = [
    [-FALLEN.x, FALLEN.x, 0, FALLEN.h, FALLEN.z0, FALLEN.z1], // the fallen rack (props.ts)
    [CABINET.x - 0.7, CABINET.x + 0.7, 0, 0.5, CABINET.z - 0.65, CABINET.z + 0.65], // the cabinet (the disassembly)
    POD.hull, // the pod (pod.glb: src/levels/beginning/pod.ts)
    [WINDOW.x, WINDOW.x + 0.3, WINDOW.y0, WINDOW.y1, WINDOW.z0, WINDOW.z1], // the window's pane (props.ts)
    [-1.2, 1.2, BLAST.y0, 2.6, BLAST.z0, BLAST.z1], // the blast door over its edge, and shut (props.ts)
    [-1.2, 1.2, 0, BLAST.y0, BLAST.z0, BLAST.z1],
  ];
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const inRack = (x, z) => BEGINNING.racks.some((r) => Math.abs(x - r.x) <= 0.3 + 1e-6 && Math.abs(z - r.z) <= 0.6 + 1e-6);
  for (const b of BEGINNING.boxes) {
    if (b.use !== 'collide') continue;
    if (byStage.some((k) => same(k, b.b))) continue;
    assert.equal(b.mat, 'rack', `an invisible solid ${b.mat} ${b.b}`);
    // Every point of its footprint under a rack drawn there.
    for (let x = b.b[0] + 0.01; x <= b.b[1]; x += 0.05) {
      for (let z = b.b[4] + 0.01; z <= b.b[5]; z += 0.05) assert.ok(inRack(x, z), `no rack drawn at ${x.toFixed(2)}, ${z.toFixed(2)} in ${b.b}`);
    }
  }
});

test('walking the hall and the aisle, nothing stops you but the fallen rack and the gap', () => {
  let s = toAisle();
  // No jump: up to the fallen rack, and stopped right at it.
  const walked = walk(s, 0, 52, { max: 4 });
  assert.ok(walked.z > FALLEN.z0 - PLAYER_RADIUS - 0.05 && walked.z < FALLEN.z0, `stopped short of the fallen rack: ${walked.z.toFixed(2)}`);
  // Over it, then along the aisle's floor to the gap's edge, by either side.
  s = settle(walk(walk(s, 0, FALLEN.z0 - 0.9), 0, 50, { keys: jumps(false) }));
  for (const x of [-1.45, 0, 1.45]) {
    const edge = walk(walk(s, x, 50), x, GAP.z0 - 0.1, { max: 4 });
    assert.ok(edge.z > GAP.z0 - 0.4 && Math.abs(edge.y) < 1e-6, `stopped short of the gap at x ${x}: ${edge.z.toFixed(2)}`);
  }
});

test('the cleaning cart: solid, parked until you come in, across the hall in its own lane, never into a wall', () => {
  // Parked at the west end, then across to the east end in CART.ticks ticks, counted by step() itself.
  assert.equal(cartX(0), CART.x0);
  assert.equal(cartX(CART_CROSSED), CART.x1);
  let s = { ...levelSpawn(L.id), x: 0, z: 29, gates: GATE.quarters | GATE.cart };
  for (let t = 0; t < CART.ticks + 30; t++) s = step(s, 0, quantizeYaw(0));
  assert.equal(cartTicks(s.gates), CART.ticks);
  assert.equal(step({ ...s, gates: GATE.quarters }, 0, 0).gates, GATE.quarters, 'it set off by itself');
  // Its whole run is clear of every other solid, with a body's width left at each end to the wall.
  const lane = [CART.x0 - CART.hx, CART.x1 + CART.hx, 0.01, CART.h, CART.z - CART.hz, CART.z + CART.hz];
  for (const b of BEGINNING.boxes) {
    if (b.use === 'draw') continue;
    const hit = b.b[0] < lane[1] && b.b[1] > lane[0] && b.b[2] < lane[3] && b.b[3] > lane[2] && b.b[4] < lane[5] && b.b[5] > lane[4];
    assert.ok(!hit, `the cart's run goes through ${b.mat} ${b.b}`);
  }
  assert.ok(6 - lane[1] >= 2 * PLAYER_RADIUS && lane[0] + 6 >= 2 * PLAYER_RADIUS, 'it can pin you to the wall');
  // You walk into it, parked: it stops you.
  const from = { ...levelSpawn(L.id), x: CART.x0, z: CART.z - 1.5, gates: GATE.quarters };
  const parked = walk(from, CART.x0, CART.z + 1.5, { open: () => GATE.quarters, max: 3 });
  assert.ok(parked.z < CART.z - CART.hz, `walked through the parked cart: ${parked.z.toFixed(2)}`);
  // Standing in its way, it pushes you along (never through you), and you can't walk through it rolling either.
  let stood = { ...levelSpawn(L.id), x: 0, z: CART.z, gates: GATE.quarters | GATE.cart };
  for (let t = 0; t < CART.ticks; t++) {
    stood = step(stood, 0, quantizeYaw(0));
    const x = cartX(stood.gates), px = Math.max(x - CART.hx, Math.min(x + CART.hx, stood.x));
    const pz = Math.max(CART.z - CART.hz, Math.min(CART.z + CART.hz, stood.z));
    assert.ok(Math.hypot(stood.x - px, stood.z - pz) >= PLAYER_RADIUS - 1e-3, `inside the cart at tick ${t}`);
  }
  assert.ok(stood.x > CART.x1 + CART.hx, `not pushed along: ${stood.x.toFixed(2)}`);
  // Jumped onto, it holds you up.
  let top = { ...levelSpawn(L.id), x: CART.x0, z: CART.z, y: CART.h + 0.2, grounded: false, gates: GATE.quarters };
  top = settle(top, 60);
  assert.ok(Math.abs(top.y - CART.h) < 1e-6, `fell through the cart's top: ${top.y}`);
});
