// Every level (shared/levels.ts) but the desert: its spawns are clear and away from its doors, every door can be walked
// to from a spawn, the walls are closed (nothing walkable reaches out of its bounds), walking and jumping in it behave
// (no step further than the speed allows, walls stop you, ceilings stop a jump without throwing you sideways).
// Walkable is a 0.25 m grid on the floor where a standing player's circle (PLAYER_RADIUS) overlaps no box too tall to
// step onto; then the real step() walks and jumps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESERT, LEVELS, doorAt, inBox } from '../shared/levels.ts';
import { DATACENTER } from '../shared/levels/datacenter.ts';
import { DT, FORWARD, JUMP, PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP, quantizeYaw, spawnState, step } from '../shared/sim.ts';

const LAYOUTS = { datacenter: DATACENTER };
const GRID = 0.25;
/** The server's slack round a door's trigger (server/world.ts EXIT_SLACK). */
const DOOR_SLACK = 0.6;
/** Fastest a player moves on a level's flat floor (a slide's top speed), per tick, with a little room. */
const MAX_STEP = 18 * DT * 1.05;

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

test('the registry: a level is LEVELS[its id], the desert first', () => {
  LEVELS.forEach((l, i) => assert.equal(l.id, i, l.key));
  assert.equal(LEVELS[DESERT].key, 'desert');
});

for (const L of LEVELS.filter((l) => l.id !== DESERT)) {
  const layout = LAYOUTS[L.key];
  const solids = layout.boxes.filter((b) => b.use !== 'draw').map((b) => b.b);

  test(`${L.key}: spawns are clear, on the floor, inside the bounds and away from the doors`, () => {
    assert.ok(L.spawns.length > 0);
    for (const s of L.spawns) {
      assert.ok(inBox(L.bounds, s.x, s.y, s.z), `spawn ${s.x},${s.z} out of bounds`);
      assert.ok(!blocked(solids, s.x, s.z, s.y), `spawn ${s.x},${s.z} is in a box`);
      assert.ok(floored(solids, s.x, s.z), `spawn ${s.x},${s.z} has no floor`);
      // An F pressed twice at a door must not take you straight back out through the one you arrive by.
      assert.equal(doorAt(L, s.x, s.y, s.z, DOOR_SLACK), undefined, `spawn ${s.x},${s.z} is at a door`);
    }
  });

  test(`${L.key}: every door is reachable from a spawn, and the walls are closed`, () => {
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
    assert.ok(L.doors().length > 0, 'no way out');
    for (const { trigger: e } of L.doors()) {
      let reach = false;
      for (let j = 0; j < nz && !reach; j++) for (let i = 0; i < nx && !reach; i++) {
        if (seen[j * nx + i] && inBox(e, x0 + i * GRID, (e[2] + e[3]) / 2, z0 + j * GRID)) reach = true;
      }
      assert.ok(reach, `door ${e} can't be reached`);
    }
    for (const s of L.spawns) assert.ok(seen[Math.round((s.z - z0) / GRID) * nx + Math.round((s.x - x0) / GRID)], `spawn ${s.x},${s.z} cut off`);
  });

  test(`${L.key}: step() stands on the floor, never jumps further than it can move, and walls stop it`, () => {
    let s = spawnState(L.spawns[0].x, L.spawns[0].z, L.spawns[0].y, L.id, L.spawns[0].facing);
    for (let t = 0; t < 60; t++) s = step(s, 0, quantizeYaw(s.facing));
    assert.ok(s.grounded && Math.abs(s.y - L.spawns[0].y) < 1e-6, `standing at ${s.y}, grounded ${s.grounded}`);
    for (const yaw of [s.facing, s.facing + Math.PI, s.facing + Math.PI / 2, s.facing - Math.PI / 2]) {
      let stuck = 0;
      for (let t = 0; t < 12 / DT; t++) {
        const n = step(s, FORWARD | (t % 90 < 3 ? JUMP : 0), quantizeYaw(yaw));
        // (an out-of-bounds reset would show as a jump far past the speed)
        assert.ok(Math.hypot(n.x - s.x, n.z - s.z) <= MAX_STEP, `moved ${Math.hypot(n.x - s.x, n.z - s.z).toFixed(2)} m in a tick at ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
        assert.ok(inBox(L.bounds, n.x, n.y, n.z), `out at ${n.x},${n.y},${n.z}`);
        assert.equal(n.level, L.id);
        if (Math.hypot(n.x - s.x, n.z - s.z) < 1e-4) stuck++;
        s = n;
      }
      // 12 s at walking speed is longer than any straight line in here: it ends against a wall, pressed still.
      assert.ok(stuck > 30, `never stopped walking towards ${yaw.toFixed(2)}`);
      assert.ok(s.y > -0.01 && s.y < 2.5, `feet at ${s.y}`);
    }
  });
}

test('datacenter: a jump and a double jump in every room, under the beams and lintels, go straight up and down', () => {
  const L = LEVELS.find((l) => l.key === 'datacenter');
  const ceilings = DATACENTER.ceilings;
  const spots = [
    ['vestibule', 0, -2, ceilings.vestibule], ['hall', 0, 10.5, ceilings.hall], ['UPS room', 15, 6, ceilings.ups],
    ['under a beam', -5, 5.1, 3.7], ['under the hall door lintel', 0, -0.15, 2.4], ['in the UPS door', 12.15, 3.7, 2.3],
  ];
  for (const [name, x, z, top] of spots) {
    let s = spawnState(x, z, 0, L.id, 0);
    let high = 0;
    for (let t = 0; t < 180; t++) {
      s = step(s, t < 3 || (t > 22 && t < 25) ? JUMP : 0, quantizeYaw(0));
      high = Math.max(high, s.y);
      assert.ok(Math.hypot(s.x - x, s.z - z) < 1e-6, `${name}: thrown ${Math.hypot(s.x - x, s.z - z).toFixed(2)} m sideways`);
    }
    assert.ok(high + PLAYER_HEIGHT <= top + 1e-6, `${name}: head at ${(high + PLAYER_HEIGHT).toFixed(2)} through ${top}`);
    assert.ok(s.grounded && Math.abs(s.y) < 1e-6, `${name}: ended at ${s.y}`);
  }
});
