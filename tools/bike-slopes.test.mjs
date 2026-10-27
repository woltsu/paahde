import test from 'node:test';
import assert from 'node:assert/strict';
import { edits, EDIT_CELL, heightAt, onRock } from '../shared/terrain.ts';
import { DT, FORWARD, spawnState, step, slopeAt } from '../shared/sim.ts';

// A flat stretch of sand to build faces on: the bike (heading 0) rides towards -z.
const g = { gx: 0, gz: 0 };
function flatSpot() {
  for (let x = 8000; x < 9000; x += 7) for (let z = 8000; z < 9000; z += 7) {
    let ok = true;
    for (let d = -5; d <= 60 && ok; d++) for (let w = -4; w <= 4 && ok; w += 2) {
      const s = slopeAt(x + w, z - d, g);
      if (Math.hypot(s.gx, s.gz) > 0.08 || onRock(x + w, z - d)) ok = false;
    }
    if (ok) return { X: x, Z: z };
  }
  throw new Error('no flat sand to test on');
}
const { X, Z } = flatSpot();
const WALL = Z - 20; // the face starts 20 m ahead of the bike

/** Raise a face of `deg` degrees up to `rise` m high (a plateau behind it), ride at it full throttle for 8 s. */
function ride(deg, rise, bike) {
  const tan = Math.tan((deg * Math.PI) / 180);
  const cells = [];
  for (let ix = Math.floor((X - 8) / EDIT_CELL); ix <= (X + 8) / EDIT_CELL; ix++)
    for (let iz = Math.floor((WALL - 40) / EDIT_CELL); iz <= WALL / EDIT_CELL + 1; iz++) {
      edits.setMm(ix, iz, Math.round(Math.min(rise, Math.max(0, (WALL - iz * EDIT_CELL) * tan)) * 1000));
      cells.push([ix, iz]);
    }
  const base = heightAt(X, Z);
  let s = { ...spawnState(X, Z), riding: true, bike, heading: 0 };
  let top = 0;
  for (let t = 0; t < 8 / DT; t++) {
    s = step(s, FORWARD, 0);
    top = Math.max(top, s.y - base);
  }
  for (const [ix, iz] of cells) edits.setMm(ix, iz, 0);
  return { top, end: s.y - base };
}

test('the bike rides up hills and dune faces', () => {
  for (const deg of [15, 25, 32]) {
    const r = ride(deg, 8, 1);
    assert.ok(r.top > 7.9, `${deg}° hill: got ${r.top.toFixed(2)} m up`);
  }
});

test('the bike slides back down a face too steep for its tyres', () => {
  for (const deg of [40, 50]) {
    const r = ride(deg, 8, 1);
    assert.ok(r.top < 6 && r.end < 1, `${deg}° face: up ${r.top.toFixed(2)} m, ended ${r.end.toFixed(2)} m`);
  }
});

test('a near-vertical sand wall stops even the best bike', () => {
  for (const deg of [70, 85]) {
    const r = ride(deg, 8, 4);
    assert.ok(r.top < 1, `${deg}° wall: climbed ${r.top.toFixed(2)} m`);
  }
});

test('a dug lip lower than a step is still driven over', () => {
  const r = ride(85, 0.25, 1);
  assert.ok(r.top > 0.2, `lip: ${r.top.toFixed(2)} m`);
});
