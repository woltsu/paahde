// The ring hall's overhead carriages (src/levels/beginning/carriages.ts, docs/levels/ring.md "Overhead rails"): they
// keep their distance on each track, all get somewhere, stop and let their loads down, and swing only a little.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Carriages, DRIVE, PER_TRACK, TRACKS } from '../src/levels/beginning/carriages.ts';

test('carriages keep their gap, keep going their way, and their loads swing gently', () => {
  const cs = new Carriages(7);
  assert.equal(cs.list.length, PER_TRACK * TRACKS.length);
  const start = cs.list.map((c) => c.z);
  let minRoom = Infinity, maxSwing = 0, maxDrop = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 900; i++) {
    const before = cs.list.map((c) => c.z);
    cs.step(dt);
    cs.list.forEach((c, k) => {
      minRoom = Math.min(minRoom, cs.room(k));
      maxSwing = Math.max(maxSwing, Math.abs(c.swing));
      maxDrop = Math.max(maxDrop, c.drop);
      // Never backwards, never faster than its top speed.
      const d = (c.z - before[k]) * TRACKS[c.track].dir;
      assert.ok(d >= -1e-9 && d <= c.vmax * dt + 1e-9, `carriage ${k} moved ${d}`);
    });
  }
  assert.ok(minRoom >= DRIVE.gap - 0.1, `closest ${minRoom.toFixed(2)} m`);
  // In 15 minutes, each has gone a good way round (stop and go: well under top speed on average).
  cs.list.forEach((c, k) => assert.ok((c.z - start[k]) * TRACKS[c.track].dir > 500, `carriage ${k} went ${((c.z - start[k]) * TRACKS[c.track].dir).toFixed(0)} m`));
  assert.ok(maxDrop > DRIVE.drop * 0.9, 'loads go down at the stops');
  assert.ok(maxSwing > 0.005 && maxSwing < 0.1, `swing ${maxSwing.toFixed(3)} rad`);
});

test('the same seed moves them the same way', () => {
  const a = new Carriages(3), b = new Carriages(3);
  for (let i = 0; i < 600; i++) a.step(0.05), b.step(0.05);
  assert.deepEqual(a.list, b.list);
});
