// Every level (shared/levels.ts) but the desert: its spawns are clear, every exit can be walked to from a spawn, and
// the walls are closed (nothing walkable reaches out of its bounds). Walkable is a 0.25 m grid on the floor where a
// standing player's circle (PLAYER_RADIUS) overlaps no box that is too tall to step onto; then the real step() walks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESERT, LEVELS, inBox } from '../shared/levels.ts';
import { DATACENTER } from '../shared/levels/datacenter.ts';
import { DT, FORWARD, levelSpawn, PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP, quantizeYaw, step } from '../shared/sim.ts';

const LAYOUTS = { datacenter: DATACENTER };
const GRID = 0.25;

/** Solid boxes a standing player at (x, z) with feet at y would be pushed out of. */
function blocked(solids, x, z, y = 0) {
  for (const b of solids) {
    if (b[2] >= y + PLAYER_HEIGHT || b[3] <= y + STEP_UP) continue;
    const px = Math.min(Math.max(x, b[0]), b[1]), pz = Math.min(Math.max(z, b[4]), b[5]);
    if ((x - px) ** 2 + (z - pz) ** 2 < PLAYER_RADIUS ** 2) return true;
  }
  return false;
}
/** A floor under (x, z) (a box whose top is within a step of the feet). */
const floored = (solids, x, z) => solids.some((b) => x >= b[0] && x <= b[1] && z >= b[4] && z <= b[5] && b[3] <= STEP_UP && b[3] > -0.1);

for (const L of LEVELS.filter((l) => l.id !== DESERT)) {
  const layout = LAYOUTS[L.key];
  const solids = layout.boxes.filter((b) => b.use !== 'draw').map((b) => b.b);

  test(`${L.key}: spawns are clear and on the floor, inside the bounds`, () => {
    assert.ok(L.spawns.length > 0);
    for (const s of L.spawns) {
      assert.ok(inBox(L.bounds, s.x, s.y, s.z), `spawn ${s.x},${s.z} out of bounds`);
      assert.ok(!blocked(solids, s.x, s.z, s.y), `spawn ${s.x},${s.z} is in a box`);
      assert.ok(floored(solids, s.x, s.z), `spawn ${s.x},${s.z} has no floor`);
    }
  });

  test(`${L.key}: every exit is reachable from a spawn, and the walls are closed`, () => {
    const b = L.bounds, pad = 2;
    const x0 = b[0] - pad, z0 = b[4] - pad;
    const nx = Math.ceil((b[1] - b[0] + 2 * pad) / GRID), nz = Math.ceil((b[5] - b[4] + 2 * pad) / GRID);
    const seen = new Uint8Array(nx * nz);
    const s0 = L.spawns[0];
    const queue = [[Math.round((s0.x - x0) / GRID), Math.round((s0.z - z0) / GRID)]];
    seen[queue[0][1] * nx + queue[0][0]] = 1;
    let escaped = null, cells = 0;
    while (queue.length) {
      const [i, j] = queue.pop();
      cells++;
      const x = x0 + i * GRID, z = z0 + j * GRID;
      if (!inBox([b[0], b[1], -Infinity, Infinity, b[4], b[5]], x, 0, z) || !floored(solids, x, z)) { escaped = [x, z]; break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= nx || c >= nz || seen[c * nx + a]) continue;
        if (blocked(solids, x0 + a * GRID, z0 + c * GRID)) continue;
        seen[c * nx + a] = 1;
        queue.push([a, c]);
      }
    }
    assert.equal(escaped, null, `walked out of the walls at ${escaped}`);
    assert.ok(cells > 1000, `only ${cells} cells walkable`);
    for (const e of L.exits) {
      let reach = false;
      for (let j = 0; j < nz && !reach; j++) for (let i = 0; i < nx && !reach; i++) {
        if (seen[j * nx + i] && inBox(e, x0 + i * GRID, (e[2] + e[3]) / 2, z0 + j * GRID)) reach = true;
      }
      assert.ok(reach, `exit ${e} can't be reached`);
    }
    // The other spawns are in the same space.
    for (const s of L.spawns) assert.ok(seen[Math.round((s.z - z0) / GRID) * nx + Math.round((s.x - x0) / GRID)], `spawn ${s.x},${s.z} cut off`);
  });

  test(`${L.key}: step() stands on the floor and the walls stop a walk`, () => {
    let s = levelSpawn(L.id, 0);
    for (let t = 0; t < 60; t++) s = step(s, 0, quantizeYaw(s.facing));
    assert.ok(s.grounded && Math.abs(s.y - L.spawns[0].y) < 1e-6, `standing at ${s.y}, grounded ${s.grounded}`);
    // Walk 20 s the way the spawn faces, then 20 s the other way: never out of the bounds, always on a floor.
    for (const yaw of [s.facing, s.facing + Math.PI, s.facing + Math.PI / 2]) {
      for (let t = 0; t < 20 / DT; t++) {
        s = step(s, FORWARD, quantizeYaw(yaw));
        assert.ok(inBox(L.bounds, s.x, s.y, s.z), `out at ${s.x},${s.y},${s.z}`);
        assert.equal(s.level, L.id);
      }
      assert.ok(s.y > -0.01 && s.y < 2.5, `feet at ${s.y}`);
    }
  });
}
