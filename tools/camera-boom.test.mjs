// The third-person camera's boom pulls in short of a level's solids (Level.solid, src/camera.ts blocked): walls, floors,
// ceilings and shut doors, a margin off them; open air and open doors don't stop it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../shared/levels.ts';
import { GATE, beginningLevel } from '../shared/levels/beginning.ts';
import { datacenterLevel } from '../shared/levels/datacenter.ts';

const R = 0.2; // src/camera.ts WALL_CLEARANCE

/** How far a boom from (x, y, z) along (dx, dy, dz) gets (m) before it comes within R of a solid, by 2 cm steps. */
function reach(L, x, y, z, dx, dy, dz, full, gates = 0) {
  for (let d = 0.02; d <= full; d += 0.02) if (L.solid(x + dx * d, y + dy * d, z + dz * d, R, gates)) return d - 0.02;
  return full;
}

test('every level answers solid()', () => {
  for (const L of LEVELS) assert.equal(typeof L.solid, 'function', L.key);
});

test('the beginning: the corridor walls and ceiling stop the boom a margin short', () => {
  const L = beginningLevel;
  // The corridor (x within ±1.2, ceiling 2.6) at eye height.
  assert.equal(L.solid(0, 1.65, 12, R), false);
  assert.equal(L.solid(1.1, 1.65, 12, R), true); // 0.1 m off the wall
  assert.equal(L.solid(0, 2.5, 12, R), true); // 0.1 m under the ceiling
  // Sideways into the wall from the middle: stops ~R short of it at x = 1.2.
  const side = reach(L, 0, 1.65, 12, 1, 0, 0, 4.5);
  assert.ok(side > 0.9 && side < 1.0, `side ${side}`);
  // Up and back under the ceiling.
  const up = reach(L, 0, 1.65, 12, 0, Math.SQRT1_2, Math.SQRT1_2, 4.5);
  assert.ok(Math.abs(up * Math.SQRT1_2 - (2.6 - R - 1.65)) < 0.05, `up ${up}`);
  // Straight back along the corridor: the full boom.
  assert.equal(reach(L, 0, 1.65, 12, 0, 0, -1, 3), 3);
});

test('the beginning: the quarters door stops the boom while shut, not once open', () => {
  const L = beginningLevel;
  // From the quarters (z 0..8) out towards the corridor through the door's opening at z ≈ 8.
  const shut = reach(L, 0, 1.2, 6.5, 0, 0, 1, 4.5, 0);
  assert.ok(shut < 2, `shut ${shut}`);
  const open = reach(L, 0, 1.2, 6.5, 0, 0, 1, 4.5, GATE.quarters);
  assert.ok(open > shut, `open ${open} vs shut ${shut}`);
});

test('the datacenter: its walls stop the boom', () => {
  const L = datacenterLevel;
  const s = L.spawns[0];
  let hit = false;
  for (let a = 0; a < 8 && !hit; a++) hit = reach(L, s.x, s.y + 1.65, s.z, Math.sin(a), 0, Math.cos(a), 200) < 200;
  assert.ok(hit);
});
