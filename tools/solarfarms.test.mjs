import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collideSolar, cosPoly, farmLayout, FIELD, HELIO, PAD_R, sinPoly, SOLAR_MIN_R, SOLAR_REACH, solarCeiling, solarFarmsNear, solarSolid,
  TOWER,
} from '../shared/solarfarms.ts';
import { ORIGIN } from '../shared/origin.ts';
import { heightAt, rockTop } from '../shared/terrain.ts';
import { crashSitesNear } from '../shared/crashsites.ts';
import { sheltersNear } from '../shared/shelters.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP, BIKE_RADIUS } from '../shared/sim.ts';

const farms = solarFarmsNear(ORIGIN.x, ORIGIN.z, 8000);

test('solar farms lie far from the start, on cleared, graded ground', () => {
  assert.ok(farms.length >= 2, 'the deterministic world has solar farms within 8 km');
  for (const f of farms) {
    assert.ok(Math.hypot(f.x - ORIGIN.x, f.z - ORIGIN.z) >= SOLAR_MIN_R);
    assert.equal(crashSitesNear(f.x, f.z, SOLAR_REACH).length, 0, 'no crash site on a farm');
    assert.ok(sheltersNear(f.x, f.z, SOLAR_REACH).every((s) => Math.hypot(s.x - f.x, s.z - f.z) > SOLAR_REACH), 'no shelter on a farm');
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39996, r = (PAD_R - 1) * Math.sqrt((i + 0.5) / 40);
      const x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
      assert.equal(heightAt(x, z), f.y, 'the pad is flat');
      assert.equal(rockTop(x, z), -Infinity, 'no rock on the pad');
    }
  }
});

test('heliostats: posts are in the way, the mirrors are over a rider\'s head', () => {
  const f = farms[0];
  const L = farmLayout(f);
  assert.ok(L.helio.length > 1000, 'a big field');
  for (const h of L.helio) {
    if (!h.panels) continue;
    // The mirror's lowest corner stays well over a standing player's (and a rider's) head.
    const low = HELIO.pivot - Math.abs(h.vy) * HELIO.hh - HELIO.t;
    assert.ok(low > PLAYER_HEIGHT + 0.8, `mirror low edge ${low.toFixed(2)} m`);
    assert.ok(Math.hypot(h.x, h.z) >= FIELD.r0 - 1 && Math.hypot(h.x, h.z) <= FIELD.r1 + 1);
  }
  // Standing next to a mirrored post: pushed out of it, and the ceiling over you leaves room to stand.
  const h = L.helio.find((o) => o.panels === 15);
  for (const radius of [PLAYER_RADIUS, BIKE_RADIUS]) {
    const p = { x: f.x + h.x + 0.05, z: f.z + h.z, vx: -1, vz: 0 };
    collideSolar(p, f.y, f.y, radius, PLAYER_HEIGHT, STEP_UP);
    assert.ok(Math.hypot(p.x - f.x - h.x, p.z - f.z - h.z) >= HELIO.r + radius - 1e-6, 'pushed out of the post');
    assert.ok(p.vx >= 0, 'velocity into the post absorbed');
  }
  const under = solarCeiling(f.x + h.x + h.ux, f.z + h.z + h.uz, f.y, PLAYER_HEIGHT);
  assert.ok(under < Infinity && under > f.y + 0.8, 'a mirror overhead is a ceiling well above the feet');
});

test('the tower stops players and shots', () => {
  const f = farms[0];
  const p = { x: f.x + 2, z: f.z, vx: -3, vz: 0 };
  collideSolar(p, f.y, f.y, PLAYER_RADIUS, PLAYER_HEIGHT, STEP_UP);
  assert.ok(Math.hypot(p.x - f.x, p.z - f.z) >= TOWER.r + PLAYER_RADIUS - 1e-6);
  assert.equal(solarSolid(f.x, f.y + 50, f.z + 2), true);
  assert.equal(solarSolid(f.x, f.y + TOWER.top + 5, f.z), null);
});

test('the polynomial sine matches Math.sin', () => {
  for (let a = -20; a <= 20; a += 0.0137) {
    assert.ok(Math.abs(sinPoly(a) - Math.sin(a)) < 1e-8);
    assert.ok(Math.abs(cosPoly(a) - Math.cos(a)) < 1e-8);
  }
});
