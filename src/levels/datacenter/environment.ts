// What the datacenter sets while it is the stage (docs/levels/datacenter.md "Environment profile"): a low, cool
// concrete environment for metal to reflect (like the desert's, no cube renders), its post profile and its ambient.
import * as THREE from 'three/webgpu';
import { Fn, float, mix, normalWorld, smoothstep, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { PostProfile } from '../../post.ts';

const ceilingC = uniform(new THREE.Color(0xc8d4e0).multiplyScalar(0.45)); // strips seen from below
const rackC = uniform(new THREE.Color(0x20242a).multiplyScalar(0.25)); // the horizon: dark racks
const floorC = uniform(new THREE.Color(0x4a4a48).multiplyScalar(0.25));

export const datacenterEnvironment = Fn((builder: THREE.NodeBuilder) => {
  const ctx = builder.context as { getUV?: () => Node<'vec3'>; getTextureLevel?: () => Node<'float'> };
  const dir = ctx.getUV?.() ?? normalWorld;
  const blur = ctx.getTextureLevel?.() ?? float(1);
  const y = mix(dir.y, float(0), blur.mul(0.35));
  return mix(mix(floorC, rackC, smoothstep(-0.4, 0, y)), ceilingC, smoothstep(0.25, 0.8, y));
})();

/** No haze, sun or glare; bloom tight (strips and near LEDs); the eye a little open; a cool, slightly flat grade. */
export const DATACENTER_POST: PostProfile = {
  heatHaze: 0,
  sunGlare: false,
  bloom: { strength: 0.6, radius: 0.3 },
  exposure: 1.15,
  grade: { balance: new THREE.Color(0.96, 1.0, 1.05), lift: new THREE.Color(0.004, 0.006, 0.009), saturation: 0.92, contrast: 1.05 },
  ao: 1,
};

export const DATACENTER_ENV = {
  /** The only constant fill: cool from above, dim grey from the floor. */
  ambient: { sky: 0x9aa6b4, ground: 0x3a3c40, intensity: 0.35 },
  background: 0x050607,
  handShade: 0.8,
};
