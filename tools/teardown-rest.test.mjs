// A machine being taken apart keeps resting on the ground: a wire with an end off hangs on its own weight, and it neither
// pokes through the floor (src/teardown/rope.ts floor) nor lifts the machine onto itself when its rest is worked out again
// (src/teardown/junk.ts lowestOffset leaves the wires out).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group, TubeGeometry, CatmullRomCurve3, Vector3 } from 'three/webgpu';
import { buildJunk, lowestOffset } from '../src/teardown/junk.ts';
import { Rope } from '../src/teardown/rope.ts';

test('a hanging wire does not lift the machine it hangs from', async () => {
  const load = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => ({ scene: new Group() });
  try {
    for (const kind of ['control_cabinet', 'pump_housing', 'robot_arm']) {
      const j = buildJunk(kind, 7919, 2);
      const before = lowestOffset(j.root);
      const wires = j.steps.filter((s) => s.kind === 'wire');
      assert.ok(wires.length > 0, `${kind} has no wire`);
      // every wire's tube dropped a metre below the machine, as a loose one swinging would
      for (const s of wires) {
        const tube = s.obj.children.find((c) => c.isMesh && c.geometry.type === 'TubeGeometry');
        tube.geometry = new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0, -1, 0), new Vector3(0.1, -2, 0)]), 8, 0.03, 5);
      }
      assert.ok(Math.abs(lowestOffset(j.root) - before) < 1e-6, `${kind} rests on its hanging wire`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    GLTFLoader.prototype.loadAsync = load;
  }
});

test('a cable with an end off lies on the floor, not through it', () => {
  const curve = new CatmullRomCurve3([new Vector3(0, 0.4, 0), new Vector3(0.3, 0.45, 0), new Vector3(0.6, 0.4, 0)]);
  const rope = new Rope(curve, { geometry: null }, { geometry: null }, 0.03);
  const floor = { up: new Vector3(0, 1, 0), at: 0.03 };
  for (let i = 0; i < 240; i++) rope.step(1 / 60, rope.rest[0], null, new Vector3(0, -7, 0), 1.5, floor);
  const low = Math.min(...rope.pts.map((p) => p.y));
  assert.ok(low >= 0.03 - 1e-9, `a particle under the floor: ${low}`);
  assert.ok(low < 0.05, 'the loose end never reached the floor');
});
