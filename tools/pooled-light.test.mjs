import assert from 'node:assert/strict';
import test from 'node:test';
import { PooledPointLight, PooledSpotLight, registerPooledLights } from '../src/world/pooledLight.ts';

// A pooled light's on/off uniform must be in a shared group (three's render group, like the light's own colour and
// cone): a uniform in the default object group is re-uploaded only when its object is fully refreshed, so anything that
// stood still (a parked cart, a building) and was first drawn while the slot was dark never saw the light come on
// (the cart's work lamps lit the sand but not the benches when the page was loaded by day: docs/cart.md).
test('pooled lights switch on for every material, however long it has stood still', () => {
  const nodes = [];
  registerPooledLights({ library: { addLight: (Node, Light) => nodes.push([Node, Light]) } });
  assert.deepEqual(nodes.map(([, L]) => L), [PooledSpotLight, PooledPointLight]);
  for (const [Node, Light] of nodes) {
    const light = new Light(0xffffff, 0);
    const node = new Node(light);
    assert.ok(node.active?.isNode, `${Light.name}: its on/off uniform`);
    assert.equal(node.active.groupNode.shared, true, `${Light.name}: the on/off uniform is in a shared uniform group`);
    assert.equal(node.active.groupNode.name, 'render');
    // It follows the light's intensity each render.
    node.active.update();
    assert.equal(node.active.value, 0);
    light.intensity = 3;
    node.active.update();
    assert.equal(node.active.value, 1);
  }
});
