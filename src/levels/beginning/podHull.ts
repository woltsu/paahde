// pod.glb's hull as tools/blender/pod.py builds it, in three.js's frame (blender (x, y, z) is three (x, z, -y): the axis
// along z at height AXIS_Y, the nose +z). The beginning's pod (pod.ts) cuts its hatch and the hull's dark core out by
// these and fits its cabin (cabin.ts) inside them. The numbers are pod.py's (NOSE, BARREL, AXIS_Z, HATCH_*, CORE).
import * as THREE from 'three/webgpu';

const PROFILE: [number, number][] = [[-1.86, 0.0], [-1.85, 0.26], [-1.79, 0.5], [-1.66, 0.76], [-1.44, 1.0], [-1.12, 1.15],
  [-0.72, 1.22], [-0.12, 1.25], [0.42, 1.24], [0.68, 1.21]];
export const AXIS_Y = 1.2;
const DEG = Math.PI / 180;
/** The hatch: its middle angle round the axis (pod.py's: from +x towards +y here), its half width, its axial span. */
export const HATCH_A = 196 * DEG, HATCH_HALF = 24 * DEG, HATCH_Y0 = -0.62, HATCH_Y1 = 0.36;
/** Its edges as angles: the top (A0) and the hinge at the bottom (A1). */
export const HATCH_A0 = HATCH_A - HATCH_HALF, HATCH_A1 = HATCH_A + HATCH_HALF;
/** How far under the panels the dark core lies (m). */
export const CORE = 0.045;

/** The hull's radius at pod.py's axial `y` (three's -z). */
export function radiusAt(y: number): number {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [y0, r0] = PROFILE[i], [y1, r1] = PROFILE[i + 1];
    if (y0 <= y && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return y > 0 ? PROFILE[PROFILE.length - 1][1] : 0;
}
/** The point on the hull at angle `a`, axial `y`, `out` off it. */
export function onHull(a: number, y: number, out = 0): THREE.Vector3 {
  const r = radiusAt(y) + out;
  return new THREE.Vector3(Math.cos(a) * r, AXIS_Y + Math.sin(a) * r, -y);
}
/** A frame on the hull at (a, y): +z out of it, +y up round it, +x along the axis towards the nose. */
export function hullFrame(a: number, y: number, out = 0): THREE.Matrix4 {
  const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), up = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), up, n).setPosition(onHull(a, y, out));
}
/** (x, y) round the axis: its angle (0..2π) and radius. */
export function polar(x: number, y: number): { a: number; r: number } {
  return { a: (Math.atan2(y - AXIS_Y, x) + 2 * Math.PI) % (2 * Math.PI), r: Math.hypot(x, y - AXIS_Y) };
}
