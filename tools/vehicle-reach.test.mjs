import assert from 'node:assert/strict';
import test from 'node:test';
import { setVehicles, vehicleTarget } from '../shared/vehicles.ts';
import { openBoxes } from '../shared/storage.ts';

// Playtest: "Repairing bike did nothing first". The crosshair could pick a bike (the F prompt showed) from a little
// further than its boxes open, so F opened the bag alone; a step closer, the same F worked.
test('a bike the crosshair picks out is one whose box F opens', () => {
  for (const up of [false, true]) {
    for (const heading of [0, 0.8, Math.PI / 2]) {
      setVehicles([{ id: 1, kind: 'motorcycle', x: 0, y: 0, z: 0, heading, up, parts: [] }]);
      let seen = 0;
      for (let d = 1.5; d < 6; d += 0.05) {
        for (let a = 0; a < Math.PI * 2; a += 0.2) {
          const s = { x: Math.sin(a) * d, y: 0, z: Math.cos(a) * d, riding: false };
          for (let pitch = -1.2; pitch < 0.2; pitch += 0.1) {
            const t = vehicleTarget(s, Math.atan2(s.x, s.z), pitch);
            if (!t) continue;
            seen++;
            assert.ok(openBoxes(s).includes('veh1'), `aimed at from ${d.toFixed(2)} m (up ${up}) but its box is out of reach`);
          }
        }
      }
      assert.ok(seen > 0);
    }
  }
  setVehicles([]);
});
