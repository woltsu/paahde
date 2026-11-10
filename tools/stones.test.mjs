import test from 'node:test';
import assert from 'node:assert/strict';
import { STONE_CELL, STONE_SHAPES, stoneFoot, stonesIn, stoneSolid, stoneProfile } from '../shared/stones.ts';
import { groundAt } from '../shared/terrain.ts';
import { duneFloor, WORLD_SEED } from '../shared/dunes.ts';
import { biomeAt } from '../shared/biomes.ts';
import { rockFoot } from '../shared/rocks.ts';
import { ORIGIN } from '../shared/origin.ts';
import { DT, FORWARD, spawnState, step, STEP_UP } from '../shared/sim.ts';

/** Every stone in the cells round the origin, out to `n` cells (stepped by `stride`). */
function* stonesRound(n, stride = 1) {
  const cx = Math.floor(ORIGIN.x / STONE_CELL), cz = Math.floor(ORIGIN.z / STONE_CELL);
  for (let j = -n; j <= n; j += stride) for (let i = -n; i <= n; i += stride) yield* stonesIn(cx + i, cz + j);
}

/** No other stone with a hitbox within `r` of the line from (x, z0) to (x, z1). */
function laneClear(st, x, z0, z1, r) {
  for (let j = Math.floor((Math.min(z0, z1) - 4) / STONE_CELL); j <= Math.floor((Math.max(z0, z1) + 4) / STONE_CELL); j++)
    for (let i = Math.floor((x - 4) / STONE_CELL); i <= Math.floor((x + 4) / STONE_CELL); i++)
      for (const o of stonesIn(i, j)) {
        if (o === st || !o.hit) continue;
        if (Math.abs(o.x - x) < o.rx + r && o.z > Math.min(z0, z1) - o.rx - r && o.z < Math.max(z0, z1) + o.rx + r) return false;
      }
  return true;
}

/** How far out from the stone's centre (x, z) is, in units of its footprint's rim (< 1 inside). */
function rimDistance(st, x, z) {
  const dx = x - st.x, dz = z - st.z;
  const u = (dx * st.ax + dz * st.az) / st.rx, v = (dz * st.ax - dx * st.az) / st.rz;
  return Math.sqrt(u * u + v * v);
}

/** Walk from `d` m on the +z side of the stone towards -z (facing 0) for `secs`; also the nearest it came (rimDistance). */
function walk(st, d, secs) {
  let s = spawnState(st.x, st.z + d);
  s = { ...s, facing: 0 };
  let nearest = Infinity;
  for (let t = 0; t < secs / DT; t++) {
    s = step(s, FORWARD, 0);
    nearest = Math.min(nearest, rimDistance(st, s.x, s.z));
  }
  return { ...s, nearest };
}

test('layout is the same every time it is made', () => {
  const a = JSON.stringify([...stonesRound(60, 6)]);
  const b = JSON.stringify([...stonesRound(60, 6)]);
  assert.equal(a, b);
  assert.ok(a.length > 2, 'some stones round the origin');
});

/** No rock under or near any corner or the middle of cell (ix, iz). */
function openSand(ix, iz) {
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
    const x = (ix + u) * STONE_CELL, z = (iz + v) * STONE_CELL;
    if (rockFoot(x, z) > 0 || groundAt(x, z).rock > -Infinity) return false;
  }
  return true;
}

test('stones lie by the rocks; open sand and big dunes are bare', () => {
  const cat = {};
  const cx = Math.floor(ORIGIN.x / STONE_CELL), cz = Math.floor(ORIGIN.z / STONE_CELL);
  for (let j = -30; j < 30; j++) for (let i = -30; i < 30; i++) {
    const ix = cx + i * 4, iz = cz + j * 4, x = (ix + 0.5) * STONE_CELL, z = (iz + 0.5) * STONE_CELL;
    const g = groundAt(x, z), depth = g.sand - Math.max(duneFloor(x, z, WORLD_SEED), g.rock);
    const foot = rockFoot(x, z);
    const k = biomeAt(x, z) ?? (foot > 0.5 ? 'rockfoot' : depth > 10 ? 'bigdune' : openSand(ix, iz) ? 'sand' : 'other');
    const c = (cat[k] ??= { n: 0, stones: 0 });
    c.n++;
    c.stones += stonesIn(ix, iz).length;
  }
  const per = (k) => cat[k] ? cat[k].stones / cat[k].n : NaN;
  assert.ok(cat.rockfoot?.n > 10 && per('rockfoot') > 10, `rock feet stony: ${per('rockfoot')}`);
  assert.ok(cat.bigdune?.n > 10 && per('bigdune') < 0.5, `big dunes bare: ${per('bigdune')}`);
  assert.ok(cat.sand?.n > 10 && per('sand') < 0.3, `open sand all but bare: ${per('sand')}`);
  if (cat.canyon?.n > 10) assert.ok(per('canyon') > 3, `canyons stony: ${per('canyon')}`);
});

test('a big boulder is a wall, and you can stand on it', () => {
  const big = [...stonesRound(40)].find((st) => st.wallH > 1.4 && st.rz > 1.2 && laneClear(st, st.x, st.z, st.z + 8, 1));
  assert.ok(big, 'a big boulder with a clear approach');
  // Walked into, it stops you at its rim (and you slide round it): never inside, never up it.
  const s = walk(big, big.rx + 4, 4);
  assert.ok(s.nearest > 1, `kept out of it (nearest ${s.nearest.toFixed(2)} rims)`);
  assert.ok(s.nearest < 1.6, `came up against it (nearest ${s.nearest.toFixed(2)} rims)`);
  assert.ok(s.y < stoneFoot(big) + big.wallH, 'not climbed up it');
  // Dropped onto its top: lands on it.
  let d = { ...spawnState(big.x, big.z), y: stoneFoot(big) + big.h + 2, grounded: false };
  for (let t = 0; t < 2 / DT; t++) d = step(d, 0, 0);
  assert.ok(Math.abs(d.y - (stoneFoot(big) + big.h)) < 0.15, `stands on top (y ${d.y.toFixed(2)}, top ${(stoneFoot(big) + big.h).toFixed(2)})`);
  // Shots stop in it.
  assert.ok(stoneSolid(big.x, stoneFoot(big) + big.h * 0.5, big.z));
  assert.ok(!stoneSolid(big.x, stoneFoot(big) + big.h + 0.3, big.z));
});

test('a low stone is walked over', () => {
  const low = [...stonesRound(40)].find((st) => st.hit && st.wallH < STEP_UP - 0.1 && st.h > 0.15 &&
    laneClear(st, st.x, st.z - 6, st.z + 6, 1));
  assert.ok(low, 'a low stone with a clear lane over it');
  const s = walk(low, 5, 4);
  assert.ok(s.nearest < 0.5, 'went over its middle');
  assert.ok(s.z < low.z - 2, `walked past it (z ${s.z.toFixed(2)} vs ${low.z.toFixed(2)})`);
});

test('profiles: 1 at the centre, 0 at the rim', () => {
  for (const K of STONE_SHAPES) {
    assert.equal(stoneProfile(K.profile, 0), 1);
    assert.equal(stoneProfile(K.profile, 1), 0);
  }
});
