// The mothership's orbit (shared/mothership.ts): always up over the desert, sunlit all night, biggest at midnight.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mothershipAt, ORBIT_A, ORBIT_E, PLANET_R } from '../shared/mothership.ts';

const deg = (r) => (r * 180) / Math.PI;
const day = Array.from({ length: 24 * 12 }, (_, i) => mothershipAt(i / (24 * 12)));

test('never sets: always well above the horizon', () => {
  for (const s of day) assert.ok(deg(Math.asin(s.dir.y)) > 8, `elevation ${deg(Math.asin(s.dir.y))}`);
});

test('sunlit all day and night (clear of the planet\'s shadow)', () => {
  for (const s of day) assert.equal(s.sunlit, 1);
});

test('lowest, nearest and biggest due south at midnight; smaller and higher at noon', () => {
  const night = mothershipAt(0), noon = mothershipAt(0.5);
  assert.ok(night.dir.x > 0.9, 'south at midnight');
  assert.ok(night.angle > noon.angle * 1.3);
  assert.ok(night.dir.y < noon.dir.y);
  assert.ok(deg(night.angle) > 18 && deg(noon.angle) > 12);
});

test('a real orbit: range within perigee and apogee, the same path every day', () => {
  for (const s of day) {
    assert.ok(s.range > ORBIT_A * (1 - ORBIT_E) - PLANET_R - 1 && s.range < ORBIT_A * (1 + ORBIT_E) + PLANET_R + 1);
    const n = s.nose, b = s.belly;
    assert.ok(Math.abs(n.x * b.x + n.y * b.y + n.z * b.z) < 1e-9, 'nose square to belly');
  }
  const a = mothershipAt(0.3), b = mothershipAt(1.3);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(a.dir[k] - b.dir[k]) < 1e-9);
});
