// The solar farms' nests (shared/nest.ts, server/nests.ts): spiderlings clinging to the mirrors by the tower drop off
// when someone comes near and hunt them; a rifle shot kills one, the pistol takes two; the farms have no crawlers.
// Run with: node --test tools/nest.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { CRAWLER } from '../shared/guardians.ts';
import { NEST_N, NEST_R, NEST_STRIDE, nestPerches, WAKE_R } from '../shared/nest.ts';
import { ORIGIN } from '../shared/origin.ts';
import { SP_DIE, SP_DROP, SP_PERCH } from '../shared/queen.ts';
import { HELIO, solarFarmsNear } from '../shared/solarfarms.ts';
import { GuardianServer } from '../server/guardians.ts';
import { LEAVE_R, NestServer } from '../server/nests.ts';
import { Tracks } from '../server/tracks.ts';

const farm = solarFarmsNear(ORIGIN.x, ORIGIN.z, 8000)[0];
const vel = () => new Tracks({ k: (dt) => 1 - Math.exp(-dt * 6), jump: 25, onJump: 'keep' });

/** Ticks the nest at 10 Hz for `s` seconds with player p moved by `move` each tick; returns the bites. */
function run(n, v, p, clock, s, move = () => {}) {
  let bites = 0;
  for (let i = 0; i < s * 10; i++) {
    clock.now += 100;
    move(p);
    const bitten = new Map();
    v.update(clock.now, 0.1, [p]);
    n.tick(0.1, clock.now, [p], [p], bitten, v);
    bites += bitten.size;
  }
  return bites;
}

test('a nest clings to the mirrors by the tower, the same perches every time', () => {
  const ps = nestPerches(farm);
  assert.equal(ps.length, NEST_N);
  for (const q of ps) {
    assert.ok(Math.hypot(q.x - farm.x, q.z - farm.z) < NEST_R + HELIO.hw + 1, 'near the tower');
    const h = q.y - farm.y;
    assert.ok(h > 2.5 && h < HELIO.pivot + HELIO.hh + 1, `up on a mirror (${h.toFixed(2)} m)`);
    assert.ok(Math.abs(Math.hypot(q.ux, q.uy, q.uz) - 1) < 1e-9);
  }
  assert.ok(ps.some((q) => q.uy < 0) && ps.some((q) => q.uy > 0), 'some on the face, some hanging under it');
  assert.equal(JSON.stringify(nestPerches({ ...farm })), JSON.stringify(ps), 'worked out the same from the farm alone');
});

test('they wait on their mirrors until someone comes near, then come down in a wave and hunt', () => {
  const n = new NestServer(), v = vel(), clock = { now: 1000 };
  const p = { id: 1, x: farm.x + 300, y: farm.y, z: farm.z, safe: false };
  run(n, v, p, clock, 5);
  assert.equal(n.all.length, 1, 'the nest is out with someone near the farm');
  assert.ok(n.all[0].lings.every((l) => l.st === SP_PERCH), 'all perched while they are far');
  assert.equal(n.msg(p.x, p.z).length, NEST_N * NEST_STRIDE, 'sent to whoever is near');
  // Walk in to the tower's foot.
  const bites = run(n, v, p, clock, 60, (q) => { if (q.x > farm.x + 12) q.x -= 0.5; });
  const awake = n.all[0].lings.filter((l) => l.st !== SP_PERCH).length;
  assert.ok(awake >= NEST_N * 0.6, `most came down (${awake})`);
  assert.ok(bites > 0, 'and went for whoever walked in, never dodging');
});

test('someone keeping their distance wakes none', () => {
  const n = new NestServer(), v = vel(), clock = { now: 1000 };
  const far = Math.max(...nestPerches(farm).map((q) => Math.hypot(q.x - farm.x, q.z - farm.z))) + WAKE_R + 10;
  const p = { id: 1, x: farm.x + far, y: farm.y, z: farm.z, safe: false };
  run(n, v, p, clock, 20);
  assert.ok(n.all[0].lings.every((l) => l.st === SP_PERCH));
});

test('a rifle shot kills one off its mirror; the pistol takes two, the first knocks it off', () => {
  const n = new NestServer(), v = vel(), clock = { now: 1000 };
  const p = { id: 1, x: farm.x + 300, y: farm.y, z: farm.z, safe: false };
  run(n, v, p, clock, 1);
  const ps = nestPerches(farm), [a, b] = n.all[0].lings;
  const qa = ps[a.perch], qb = ps[b.perch];
  assert.deepEqual(n.shoot(qa.x + 20, qa.y, qa.z, a.id, clock.now, 'rifle').hit, false, 'a shot ending far off misses');
  const r = n.shoot(qa.x, qa.y, qa.z, a.id, clock.now, 'rifle');
  assert.ok(r.hit && r.kill, 'one rifle shot');
  assert.equal(a.st, SP_DIE);
  assert.ok(n.msg(p.x, p.z).some((_, i, s) => i % NEST_STRIDE === 0 && s[i] === a.id && s[i + 6] === a.perch), 'falls off its mirror as it dies');
  const r1 = n.shoot(qb.x, qb.y, qb.z, b.id, clock.now, 'pistol');
  assert.ok(r1.hit && !r1.kill, 'the first pistol shot does not kill it');
  assert.equal(b.st, SP_DROP, 'but knocks it off its mirror');
  const r2 = n.shoot(b.x, farm.y + 0.5, b.z, b.id, clock.now + 100, 'pistol');
  assert.ok(r2.hit && r2.kill, 'the second does');
  assert.equal(n.shoot(qa.x, qa.y, qa.z, a.id, clock.now, 'rifle').hit, false, 'a dead one takes no more');
});

test('a nest left and come back to keeps who was alive', () => {
  const n = new NestServer(), v = vel(), clock = { now: 1000 };
  const p = { id: 1, x: farm.x + 300, y: farm.y, z: farm.z, safe: false };
  run(n, v, p, clock, 1);
  const [a, b, c] = n.all[0].lings, ps = nestPerches(farm);
  for (const l of [a, b, c]) n.shoot(ps[l.perch].x, ps[l.perch].y, ps[l.perch].z, l.id, clock.now, 'rifle');
  p.x = farm.x + LEAVE_R + 50;
  run(n, v, p, clock, 1);
  assert.equal(n.all.length, 0, 'gone with everyone away');
  p.x = farm.x + 300;
  run(n, v, p, clock, 1);
  assert.equal(n.all[0].lings.length, NEST_N - 3);
});

test('the solar farms have no crawlers, only the nest', () => {
  const g = new GuardianServer();
  const p = { id: 1, x: farm.x + 120, y: farm.y, z: farm.z, safe: false };
  for (let i = 0; i < 20; i++) g.tick(0.1, 1000 + i * 100, 0.5, [p]);
  assert.equal(g.guardians.filter((o) => o.kind === CRAWLER && Math.hypot(o.x - farm.x, o.z - farm.z) < 400).length, 0);
  const m = g.msg(3000, p.id, p.x, p.z);
  assert.equal(m.n.length, NEST_N * NEST_STRIDE, "the nest rides in 'bots'");
});

test('one blow of the scrap mace kills one in reach, none from further off', () => {
  const n = new NestServer(), v = vel(), clock = { now: 1000 };
  const p = { id: 1, x: farm.x + 300, y: farm.y, z: farm.z, safe: false };
  run(n, v, p, clock, 1);
  const ps = nestPerches(farm), [a, b] = n.all[0].lings;
  assert.equal(n.smash({ x: ps[a.perch].x + 20, y: farm.y, z: ps[a.perch].z }, a.id, 6.2, clock.now).hit, false, 'on its mirror, from afar');
  assert.equal(a.st, SP_PERCH);
  n.shoot(ps[b.perch].x, ps[b.perch].y, ps[b.perch].z, b.id, clock.now, 'pistol'); // knocked down to the sand
  b.x = farm.x + 120;
  b.z = farm.z;
  const at = { x: b.x + 2, y: farm.y, z: b.z };
  assert.equal(n.smash({ x: b.x + 12, y: farm.y, z: b.z }, b.id, 6.2, clock.now).hit, false, 'too far off');
  const r = n.smash(at, b.id, 6.2, clock.now);
  assert.ok(r.hit && r.kill, 'one blow');
  assert.equal(b.st, SP_DIE);
});
