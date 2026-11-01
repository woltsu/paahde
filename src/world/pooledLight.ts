// Fixed light pools avoid pipeline recompilation. A zero-intensity light must also skip its shader work:
// multiplying the final colour by zero still evaluates shadows and the sand's per-light ripple integration.
import * as THREE from 'three/webgpu';
import { If, renderGroup, uniform } from 'three/tsl';

/** Whether a pooled light is lit, as a uniform every material reads afresh each render. It must sit in the shared
 *  render group, as three's own light uniforms do (colour, cone): a uniform in the default object group is uploaded
 *  only when its object is fully refreshed (moved, its material changed, a node material with nodes of its own), so a
 *  still object first drawn with the slot dark kept reading it as dark however the light changed (a parked cart's
 *  benches stayed unlit under their own work lamps while the sand around them, refreshed every frame, took the
 *  light: docs/cart.md). */
const lit = (light: () => THREE.Light | null) => uniform(0).setGroup(renderGroup).onRenderUpdate(() => ((light()?.intensity ?? 0) > 0 ? 1 : 0));

export class PooledSpotLight extends THREE.SpotLight {}

class PooledSpotLightNode extends THREE.SpotLightNode {
  active = lit(() => this.light);

  override setup(builder: THREE.NodeBuilder) {
    // This condition is uniform across the draw: derivatives in the lit branch remain well-defined.
    // Keep the node and shadow map alive while inactive, so switching a lamp never changes shader structure.
    If(this.active.greaterThan(0), () => { super.setup(builder); });
    return null;
  }
}

/** A level's light pool (src/levels/lightPool.ts): a point light at zero intensity still runs its lighting for every lit
 *  pixel, so an idle slot skips it the same way. */
export class PooledPointLight extends THREE.PointLight {}

class PooledPointLightNode extends THREE.PointLightNode {
  active = lit(() => this.light);

  override setup(builder: THREE.NodeBuilder) {
    If(this.active.greaterThan(0), () => { super.setup(builder); });
    return null;
  }
}

/** Register before the first scene render, on both WebGPU and the WebGL2 fallback. */
export function registerPooledLights(renderer: THREE.WebGPURenderer) {
  renderer.library.addLight(PooledSpotLightNode, PooledSpotLight);
  renderer.library.addLight(PooledPointLightNode, PooledPointLight);
}
