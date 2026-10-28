// The planet through the pod bay's window (docs/levels/tutorial.md "The window"): a big disc far behind the glass, its
// shader the whole of it (TSL, no textures): an orange world with no clouds, banded dust and dark dry seas turning slowly,
// darker towards its limb, a thin hot rim of atmosphere; stars round it. Basic (unlit) materials: it lights nothing but
// itself, and the bay's weak orange fill light by the window stands in for its glow.
import * as THREE from 'three/webgpu';
import { Fn, float, hash, length, mix, mx_fractal_noise_float, mx_noise_float, smoothstep, sqrt, step, time, uv, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The disc: `r` m across from `at`, facing -x (the window is in the bay's east wall). */
export function planet(at: THREE.Vector3, r: number): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial();
  m.fog = false;
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2); // -1..1 over the disc's square
    const d = length(p);
    const disc = float(1).sub(smoothstep(0.985, 1.0, d));
    // On the sphere: its depth towards us, and where on its surface (longitude turning with time).
    const nz = sqrt(float(1).sub(d.mul(d)).max(0));
    const lon = p.x.div(nz.add(0.15)).add(time.mul(0.004));
    const lat = p.y;
    const q = vec3(lon.mul(1.6), lat.mul(2.2), 0);
    const bands = mx_noise_float(vec3(lat.mul(9), lon.mul(0.6), 3)).mul(0.5).add(0.5);
    const seas = smoothstep(0.08, 0.32, mx_fractal_noise_float(q, 4, 2, 0.5)) as F;
    const sand = mix(vec3(0.85, 0.3, 0.07), vec3(0.95, 0.48, 0.15), bands) as V3;
    const dry = vec3(0.32, 0.1, 0.03) as V3;
    const ground = mix(dry, sand, seas) as V3;
    // Lit from the upper right, darker to the limb; the night side faint.
    const lit = smoothstep(-0.35, 0.6, p.x.mul(0.6).add(p.y.mul(0.3)).add(nz.mul(0.55))) as F;
    const limb = nz.pow(0.55) as F;
    const surface = ground.mul(lit.mul(0.9).add(0.05)).mul(limb).mul(1.05);
    // The atmosphere: a thin hot rim just past the edge and over it.
    const rim = smoothstep(0.9, 1.0, d).mul(float(1).sub(smoothstep(1.0, 1.06, d))).mul(lit.add(0.2));
    const glow = vec3(1.0, 0.55, 0.22).mul(rim).mul(2.2) as V3;
    // Stars where the planet isn't (never under it).
    const cell = p.mul(90).floor();
    const star = step(0.996, hash(cell.x.add(cell.y.mul(173)))).mul(hash(cell.x.mul(7).add(cell.y)).mul(0.8).add(0.2));
    const sky = vec3(star, star, star.mul(1.1)).mul(smoothstep(1.0, 1.1, d)) as V3;
    return surface.mul(disc).add(glow).add(sky);
  })();
  // Twice the disc's size, so its rim and the stars round it fit.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4), m);
  mesh.position.copy(at);
  mesh.rotation.y = -Math.PI / 2; // facing -x
  mesh.name = 'planet';
  return mesh;
}

/** Black space behind it (a far wall the window looks out on), stars only. */
export function space(at: THREE.Vector3, size: number): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial();
  m.fog = false;
  m.colorNode = Fn(() => {
    const cell = uv().mul(size * 1.5).floor();
    const s = step(0.997, hash(cell.x.add(cell.y.mul(311)))).mul(hash(cell.y.mul(13).add(cell.x)).mul(0.7).add(0.3));
    return vec3(s, s, s.mul(1.1));
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  mesh.position.copy(at);
  mesh.rotation.y = -Math.PI / 2;
  mesh.name = 'space';
  return mesh;
}
