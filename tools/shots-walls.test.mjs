// Shots stop at walls (shared/terrain.ts shotGround, shotSolid): a shelter's hut (0.5 m concrete) stops a beam, the
// blaster's plasma bolt flown a stretch a frame (src/rifle.ts flyBolts: each stretch after the first looked along from
// its start, none of it skipped), a guardian's bolt flown a stretch a tick (server/guardians.ts tickBolts), and the
// guardians' and drones' sight (shared/guardians.ts lineOfSight). The burst of a guardian's bolt on the wall spares
// whoever hides behind it.
// Run with: node --test tools/shots-walls.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { lineOfSight } from '../shared/guardians.ts';
import { PLASMA_SPEED, plasmaAt } from '../shared/rifle.ts';
import { S_HUT, shelterSolid, sheltersNear, shelterToWorld } from '../shared/shelters.ts';
import { shotGround, shotSolid } from '../shared/terrain.ts';
import { ORIGIN } from '../shared/origin.ts';
import { GuardianServer } from '../server/guardians.ts';

/** A few shelters near the origin, and a seeded spread of shots at each hut's middle that the hut is in the way of. */
function hutShots() {
  let ss = [];
  for (let r = 1000; ss.length < 6 && r < 20000; r += 1000) ss = sheltersNear(ORIGIN.x, ORIGIN.z, r);
  assert.ok(ss.length >= 3, 'shelters to shoot at');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shots = [];
  for (const s of ss.slice(0, 6)) {
    const c = shelterToWorld(s, 0, (S_HUT.z0 + S_HUT.z1) / 2);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, dist = 3 + rnd() * 60, hy = 0.4 + rnd() * 2;
      const o = { x: c.x + Math.sin(a) * dist, y: s.y + hy, z: c.z + Math.cos(a) * dist };
      const L = Math.hypot(c.x - o.x, c.z - o.z);
      const d = { x: (c.x - o.x) / L, y: 0, z: (c.z - o.z) / L };
      if (shotSolid(o.x, o.y, o.z)) continue;
      // The hut (not the sand, or the doorway's opening) is what's in the way first.
      let first = -1;
      for (let t = 0; t < L; t += 0.02) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        if (shotSolid(x, y, z)) {
          first = shelterSolid(x, y, z) === true ? t : -1;
          break;
        }
      }
      // Through the wall, not grazing a corner (a sliver finer than the shot's steps).
      for (let t = first; first >= 0 && t < first + 0.3; t += 0.02) if (!shotSolid(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)) first = -1;
      // From further than a body's radius off the wall (a beam skips its first half metre: the eye).
      if (first >= 0.5) shots.push({ o, d, L, first, s });
    }
  }
  assert.ok(shots.length > 300, `enough shots at huts (${shots.length})`);
  return shots;
}

const SHOTS = hutShots();

test("a beam stops at a shelter's hut, at its wall", () => {
  for (const { o, d, L, first } of SHOTS) {
    const t = shotGround(o.x, o.y, o.z, d.x, d.y, d.z, L + 10);
    assert.ok(Math.abs(t - first) < 0.2, `stopped at the wall (${t.toFixed(2)} vs ${first.toFixed(2)})`);
  }
});

test("the blaster's bolt, flown a stretch a frame, never passes through a hut's wall", () => {
  for (const fps of [30, 60, 75, 120, 144, 240]) {
    let through = 0;
    for (const { o, d, L } of SHOTS) {
      const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
      let stopped = false;
      for (let f = 0; f * PLASMA_SPEED / fps < L + 10; f++) {
        plasmaAt(o, d, f / fps, a);
        plasmaAt(o, d, (f + 1) / fps, b);
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const t = shotGround(a.x, a.y, a.z, (b.x - a.x) / len, (b.y - a.y) / len, (b.z - a.z) / len, len, f === 0 ? 0.5 : 0);
        if (t < len) {
          stopped = true;
          break;
        }
      }
      if (!stopped) through++;
    }
    assert.equal(through, 0, `at ${fps} fps`);
  }
});

test("a guardian or drone doesn't see through a hut", () => {
  for (const { o, d, L, first } of SHOTS) {
    if (L - first < 3) continue;
    // Someone just behind the hut's far side, and someone just this side of it.
    const bx = o.x + d.x * (L + 4), bz = o.z + d.z * (L + 4);
    assert.equal(lineOfSight(o.x, o.y, o.z, bx, o.y, bz), false, 'hidden behind it');
    const nx = o.x + d.x * (first - 0.4), nz = o.z + d.z * (first - 0.4);
    if (first > 1) assert.equal(lineOfSight(o.x, o.y, o.z, nx, o.y, nz), true, 'seen this side of it');
  }
});

test("a guardian's bolt bursts on a hut's wall, sparing whoever hides behind it", () => {
  const shot = SHOTS.find(({ L, first, o }) => first > 20 && L - first > 3 && o.y - 0.4 > 0);
  assert.ok(shot, 'a long shot at a hut');
  const { o, d, L, first } = shot;
  const s = new GuardianServer();
  // The bolt starts this side of the hut, flying at it; someone stands right behind the wall it meets.
  const hx = o.x + d.x * (first + 1.2), hz = o.z + d.z * (first + 1.2);
  const behind = { id: 7, x: hx, y: shot.s.y + 0.05, z: hz, safe: false };
  assert.equal(shelterSolid(behind.x, behind.y + 1, behind.z) === true, false, 'not standing in the wall');
  s.bolts.push({ id: 1, x: o.x, y: o.y, z: o.z, dx: d.x, dy: d.y, dz: d.z, flown: 0, by: 0 });
  const killed = [], events = [];
  for (let i = 0; i < 200 && s.bolts.length; i++) s.tickBolts(0.05, [behind], killed, events);
  assert.equal(s.bolts.length, 0, 'it burst');
  const boom = events.find((e) => e.msg.t === 'boom').msg;
  const at = (boom.x - o.x) * d.x + (boom.z - o.z) * d.z;
  assert.ok(Math.abs(at - first) < 0.3, `at the wall (${at.toFixed(2)} m along, the wall at ${first.toFixed(2)}, ${L.toFixed(1)} to the middle)`);
  assert.equal(boom.ground, false, 'on the wall, not the sand');
  assert.deepEqual(killed, [], 'the one behind the wall lives');
});
