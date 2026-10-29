// Space through the pod bay's window (docs/levels/tutorial.md "The window"): one camera-centred dome, its shader the
// whole of it (TSL, no textures), so space never ends at any angle and nothing in it can come through the walls. Drawn
// after every opaque thing (depth-tested, never writing depth), so only the pixels the window shows are shaded, and the
// depth buffer stays at 1 there, as under the desert's sky (post tells sky from ground by it).
// In it, by view direction only (everything is infinitely far): round stars of many brightnesses and colours, the
// Milky Way's faint band with its dust lanes, a far dim nebula; the sun, a hard white disc with its glare; and the
// planet below, an analytic sphere (a ray against it per pixel: a perfectly round, sharp limb at any size) with a desert
// surface in 3D noise (dune seas, pale pans, dark rock and canyons, dust drifting over it), turning slowly, lit by the sun
// with a soft terminator, and a thin hot atmosphere: haze towards its limb and a glow just past it, brightest sunward.
// Basic (unlit) material: it lights nothing but itself; the bay's weak orange fill light by the window stands in for it.
import * as THREE from 'three/webgpu';
import {
  Fn, abs, cameraPosition, clamp, color, cos, dot, exp, float, floor, fract, fwidth, length, max, mix, mx_fractal_noise_float,
  mx_noise_float, normalize, positionWorld, sin, smoothstep, sqrt, step, time, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const v3 = (v: THREE.Vector3) => vec3(v.x, v.y, v.z);

/** Where the planet is (its centre's direction from the bay) and how big it looks (angular radius): low out of the
 *  window (east, +x) and a little to the left, its limb a gentle curve across the lower half of the view. */
const PLANET_DIR = new THREE.Vector3(1, -0.6, -0.2).normalize();
const PLANET_ANGLE = THREE.MathUtils.degToRad(34);
/** The sun: off to the right of the planet, lighting it from the side (the night on its left), seen slantwise through
 *  the glass from the window's left end. */
const SUN_DIR = new THREE.Vector3(0.3, 0.3, 0.9).normalize();
const SUN_ANGLE = THREE.MathUtils.degToRad(0.7);
/** The planet's spin axis (tilted) and how fast it turns (rad/s: a slow drift you see if you stay). */
const AXIS = new THREE.Vector3(0.25, 1, 0.3).normalize();
const SPIN = 0.0035;
/** Milky Way: the great circle round this pole, brightest towards the core. */
const GALAXY_POLE = new THREE.Vector3(0.2, 0.55, -0.81).normalize();
const GALAXY_CORE = new THREE.Vector3(0.85, 0.45, 0.1);
GALAXY_CORE.addScaledVector(GALAXY_POLE, -GALAXY_CORE.dot(GALAXY_POLE)).normalize();

/** A float-only hash of a 3D cell (Dave Hoskins' hash33): three values in 0..1. */
function hash33(p: V3): V3 {
  const q = fract(p.mul(vec3(0.1031, 0.103, 0.0973))) as V3;
  const r = q.add(dot(q, q.yxz.add(33.33))) as V3;
  return fract(r.xxy.add(r.yxx).mul(r.zyx)) as V3;
}

/** A layer of round stars, `n` cells per unit of direction, `p` of the cells holding one; `pix`: a pixel's angle. */
function stars(dir: V3, pix: F, n: number, p: F | number, gain: number, salt: number): V3 {
  const cell = floor(dir.mul(n)) as V3;
  const h = hash33(cell.add(salt));
  const g = hash33(cell.add(salt + 71.3));
  const spot = normalize(cell.add(h.mul(0.8).add(0.1)).div(n)) as V3;
  // Only a star that lands in its own cell (else it is cut at the cell's edge).
  const own = step(length(floor(spot.mul(n)).sub(cell)), 0.5);
  const on = step(float(1).sub(p), g.x).mul(own);
  const bright = g.y.pow(5).mul(0.9).add(0.1);
  // Round points about a pixel and a half across, the bright ones a little wider (bloom does the rest).
  const r = length(dir.sub(spot)).div(pix.mul(bright.mul(0.6).add(0.55)));
  const point = exp(r.mul(r).negate());
  // Colour: red-orange giants through white to blue-white.
  const tint = mix(mix(vec3(1.0, 0.72, 0.5), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.45, g.z)), vec3(0.72, 0.82, 1.0), smoothstep(0.6, 1.0, g.z));
  return tint.mul(point.mul(on).mul(bright).mul(gain)) as V3;
}

/** The far sky: black, the Milky Way and a dim nebula, stars. */
function sky(dir: V3, pix: F): V3 {
  const lat = dot(dir, v3(GALAXY_POLE));
  const core = exp(length(dir.sub(v3(GALAXY_CORE))).pow(2).mul(-1.6));
  const wobble = mx_noise_float(dir.mul(3).add(4.1)).mul(0.05);
  const bx = lat.add(wobble).div(mix(float(0.1), float(0.22), core));
  const band = exp(bx.mul(bx).negate());
  const clump = mx_fractal_noise_float(dir.mul(4.5), 4, 2, 0.5).mul(0.5).add(0.55).max(0);
  const lane = smoothstep(0.1, 0.55, mx_fractal_noise_float(dir.mul(9).add(2.7), 3, 2, 0.5)).mul(exp(lat.div(0.05).pow(2).negate()));
  const glow = band.mul(clump.mul(clump)).mul(float(1).sub(lane.mul(0.8))).mul(core.mul(1.5).add(0.35));
  const milky = mix(vec3(0.75, 0.8, 0.95), vec3(1.0, 0.86, 0.7), core).mul(glow.mul(0.022));
  // A wide, very faint rust-violet nebula off to one side: space is not quite flat black.
  const neb = smoothstep(0.15, 0.9, mx_fractal_noise_float(dir.mul(1.6).add(9.1), 3, 2, 0.5)).mul(0.012);
  const nebula = vec3(0.9, 0.35, 0.45).mul(neb);
  const s = stars(dir, pix, 70, band.mul(0.22).add(0.06), 0.35, 0)
    .add(stars(dir, pix, 26, 0.12, 0.8, 13.7))
    .add(stars(dir, pix, 9, 0.2, 2.2, 41.9));
  return vec3(0.0012, 0.0014, 0.0022).add(milky).add(nebula).add(s) as V3;
}

// The planet's own frame: its tilted axis is y (spun() turns a world direction into it).
const EX = new THREE.Vector3(1, 0, 0).addScaledVector(AXIS, -AXIS.x).normalize();
const EZ = new THREE.Vector3().crossVectors(EX, AXIS);
const toPlanet = (v: THREE.Vector3) => new THREE.Vector3(v.dot(EX), v.dot(AXIS), v.dot(EZ)).normalize();

/** A few impact craters (direction in the planet's frame, angular radius): scattered round the face seen first from
 *  the window, and some round the far side for later. */
const CRATERS: { dir: THREE.Vector3; r: number }[] = (() => {
  const face = toPlanet(PLANET_DIR.clone().negate()).add(new THREE.Vector3(0, 0.45, 0)).normalize();
  const out: { dir: THREE.Vector3; r: number }[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const near = i < 5;
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const dir = near ? face.clone().addScaledVector(v, 0.75).normalize() : v;
    out.push({ dir, r: 0.035 + rnd() * rnd() * 0.09 });
  }
  return out;
})();

/** The desert's colours (docs/look.md's palette: sand mid-tone #c46a24, lit sand #e8902e, rust shadows; the rock and
 *  dry pans of src/world/sandMaterial.ts), linear, a little under the ground's own: seen from orbit in full sun. */
const SAND_RED = vec3(0.5, 0.15, 0.03), SAND_GOLD = vec3(0.72, 0.28, 0.05);
const ROCK_DARK = vec3(0.1, 0.035, 0.015), ROCK_LIGHT = vec3(0.3, 0.11, 0.04);
const SALT = vec3(0.72, 0.5, 0.3), SILT = vec3(0.5, 0.3, 0.17);

/** 1 while a feature `freq` cycles per unit is several pixels across, 0 once it would alias (`fw`: a pixel's size on
 *  the unit sphere): fine detail fades out smoothly instead of shimmering. */
const keep = (freq: number, fw: F): F => float(1).sub(smoothstep(0.12, 0.35, fw.mul(freq)));

/** The planet's surface colour at `n` (a point on the unit sphere in its own turning frame); `fw`: a pixel's footprint. */
function ground(n: V3, fw: F): V3 {
  // Large, coherent regions: a domain-warped low-frequency field (a few octaves only, all far above a pixel here).
  const warp = vec3(mx_noise_float(n.mul(1.1).add(3.1)), mx_noise_float(n.mul(1.1).add(7.4)), mx_noise_float(n.mul(1.1).add(1.7)));
  const q = n.add(warp.mul(0.35)) as V3;
  const h = mx_fractal_noise_float(q.mul(1.4), 3, 2.0, 0.5);
  // Sand seas where it is low and smooth, rock plateaus where it rises, a soft scarp between.
  const plateau = smoothstep(0.0, 0.07, h);
  const tone = mx_noise_float(q.mul(2.3).add(5.5)).mul(0.5).add(0.5);
  const sand = mix(SAND_RED, SAND_GOLD, smoothstep(0.2, 0.8, tone)) as V3;
  // Dune streaks: faint long bands across the wind (along the latitude, wavering), only where they are big enough.
  const phase = n.y.mul(170).add(mx_noise_float(q.mul(2.5)).mul(7)).add(mx_noise_float(q.mul(9)).mul(1.2));
  const crest = sin(phase).mul(0.5).add(0.5).pow(3);
  const dunes = crest.mul(keep(170 / 6.28, fw)).mul(float(1).sub(plateau)).mul(mx_noise_float(q.mul(2.2).add(8.8)).mul(0.5).add(0.6).min(1));
  // Sand's own mid-scale variation (drifts of redder and paler sand), faded by the footprint.
  const drift = mx_fractal_noise_float(q.mul(9).add(3.7), 2, 2.1, 0.5).mul(keep(18, fw));
  const seas = sand.mul(float(0.8).add(dunes.mul(0.35)).add(drift.mul(0.4))) as V3;
  // Eroded rock: broken mid-scale texture (ridged), faded by the footprint.
  const ridges = smoothstep(0.82, 0.97, float(1).sub(abs(mx_fractal_noise_float(q.mul(11).add(2.2), 3, 2.1, 0.5)))).mul(keep(40, fw));
  const rockT = mx_noise_float(q.mul(5).add(2.2)).mul(0.5).add(0.5).mul(keep(5, fw));
  const rock0 = mix(ROCK_LIGHT, ROCK_DARK, smoothstep(0.1, 0.4, h).mul(0.5).add(rockT.mul(0.3))) as V3;
  const rock = mix(rock0, ROCK_LIGHT.mul(1.35), ridges.mul(0.55)) as V3;
  let c: V3 = mix(seas, rock, plateau) as V3;
  // The scarp: a darker rim where the plateaus break off into the sand.
  c = c.mul(float(1).sub(smoothstep(0.0, 0.05, h).mul(float(1).sub(smoothstep(0.05, 0.12, h))).mul(0.25))) as V3;
  // Branching dry canyons and riverbeds: ridged, warped noise (main valleys, then tributaries only near them), cut into
  // the plateaus and running out into the sand; their width never under a pixel.
  const r1 = float(1).sub(abs(mx_noise_float(q.mul(3.2).add(9.1))));
  const w1 = fw.mul(3.2 * 2).max(mx_noise_float(q.mul(6)).mul(0.012).add(0.032));
  const main = smoothstep(float(1).sub(w1), float(1).sub(w1.mul(0.15)), r1);
  const r2 = float(1).sub(abs(mx_noise_float(q.mul(8).add(4.4))));
  const w2 = fw.mul(8 * 2).max(0.03);
  const trib = smoothstep(float(1).sub(w2), float(1).sub(w2.mul(0.3)), r2).mul(smoothstep(0.88, 0.96, r1)).mul(keep(8, fw));
  const canyon = main.max(trib.mul(0.6)).mul(smoothstep(0.06, 0.2, h));
  // A valley: lit walls a touch paler along its edge, its floor dark.
  c = mix(c, ROCK_LIGHT.mul(1.3), smoothstep(0.0, 0.4, canyon).mul(float(1).sub(smoothstep(0.4, 0.8, canyon))).mul(0.3)) as V3;
  c = mix(c, ROCK_DARK.mul(0.6), smoothstep(0.35, 1.0, canyon).mul(0.65)) as V3;
  // Pale salt flats in a few low basins of the seas.
  const flat = smoothstep(0.55, 0.7, mx_noise_float(q.mul(2.6).add(12.3)).mul(0.5).add(0.5)).mul(float(1).sub(smoothstep(-0.3, -0.15, h)));
  c = mix(c, mix(SILT, SALT, smoothstep(0.62, 0.72, mx_noise_float(q.mul(2.6).add(12.3)).mul(0.5).add(0.5))) as V3, flat.mul(0.7)) as V3;
  // Impact craters: a dark floor, a bright rim, faint ejecta round them.
  for (const k of CRATERS) {
    const d = length(n.sub(v3(k.dir))).div(k.r);
    const aa = fw.div(k.r).max(0.02);
    const floor_ = float(1).sub(smoothstep(float(0.75).sub(aa), float(0.75).add(aa), d));
    const rim = exp(d.sub(0.95).div(aa.max(0.08)).pow(2).negate());
    const ejecta = float(1).sub(smoothstep(1.0, 2.4, d)).mul(float(1).sub(floor_));
    c = mix(c, ROCK_DARK.mul(0.8), floor_.mul(0.5)) as V3;
    c = mix(c, ROCK_LIGHT.mul(1.6), rim.mul(0.35).add(ejecta.mul(0.1))) as V3;
  }
  // A pale polar haze.
  c = mix(c, SALT.mul(0.9), smoothstep(0.82, 0.97, abs(n.y)).mul(0.35)) as V3;
  return c;
}

/** Turns a world direction into the planet's own frame (its tilted axis is y), spun by `angle` about that axis. */
function spun(n: V3, angle: F | number): V3 {
  const x = dot(n, v3(EX)), y = dot(n, v3(AXIS)), z = dot(n, v3(EZ));
  const c = cos(angle), s = sin(angle);
  return vec3(x.mul(c).sub(z.mul(s)), y, x.mul(s).add(z.mul(c))) as V3;
}

/** The planet over `bg` for view direction `dir`. */
function planetOver(dir: V3, pix: F, bg: V3): V3 {
  const C = v3(PLANET_DIR), L = v3(SUN_DIR);
  const rad = Math.sin(PLANET_ANGLE);
  const b = dot(dir, C);
  const h2 = max(float(1).sub(b.mul(b)), 0);
  const h = sqrt(h2); // the ray's closest approach to the centre (the centre at distance 1)
  const front = step(0, b);
  // A sharp limb, antialiased over one pixel.
  const cover = clamp(float(rad).sub(h).div(pix).add(0.5), 0, 1).mul(front);
  // Where the ray meets the sphere and the surface normal there.
  const t = b.sub(sqrt(max(float(rad * rad).sub(h2), 0)));
  const N = normalize(dir.mul(t).sub(C)) as V3;
  const ndl = dot(N, L);
  const mu = max(dot(N, dir.negate()), 0); // 1 facing us, 0 at the limb
  const spin = time.mul(SPIN);
  const Np = spun(N, spin);
  // A pixel's footprint on the unit sphere (grows to the limb): fine detail fades out by it, never shimmers.
  const fw = max(length(fwidth(Np)).mul(0.5), 1e-5) as F;
  const surf = ground(Np, fw);
  // Wispy dust storms and bands, drifting a little faster than the ground turns: stretched along the latitude.
  const dn = spun(N, spin.mul(1.3).add(0.6));
  const dwarp = mx_noise_float(dn.mul(2).add(vec3(time.mul(0.003), 0, 0))).mul(0.6);
  const wisp = mx_fractal_noise_float(vec3(dn.x.mul(3), dn.y.mul(14).add(dwarp), dn.z.mul(3)), 3, 2, 0.55).mul(0.5).add(0.5);
  const dust = smoothstep(0.6, 0.85, wisp).mul(keep(14, fw).mul(0.5).add(0.5));
  let albedo: V3 = mix(surf, vec3(0.7, 0.36, 0.14), dust.mul(0.2)) as V3;
  // Contrast falls off softly to the limb: the more air we look through, the more it is one warm haze.
  albedo = mix(albedo, vec3(0.6, 0.27, 0.08), float(1).sub(mu).pow(2.5).mul(0.6)) as V3;
  // Sunlight with a soft terminator, a reddish twilight band along it, the night side black.
  const day = smoothstep(-0.06, 0.22, ndl);
  const twilight = exp(ndl.sub(0.03).div(0.09).pow(2).negate());
  const tint = mix(vec3(1, 1, 1), vec3(1.0, 0.5, 0.3), twilight.mul(0.8));
  const lit = albedo.mul(tint).mul(day.mul(max(ndl, 0).mul(1.1).add(0.3))).add(albedo.mul(0.004));
  const dusk = vec3(0.5, 0.12, 0.04).mul(exp(ndl.div(0.04).pow(2).negate()).mul(0.06));
  // The atmosphere seen through: haze thickening to the limb, lit sunward.
  const airLit = smoothstep(-0.25, 0.4, ndl);
  const haze = color(0xffb36b).mul(float(1).sub(mu).pow(4).mul(airLit).mul(0.7));
  const disc = lit.add(dusk).add(haze);
  // Past the limb: a thin glowing shell falling off with height, lit where the sun is on that side, brighter with the sun
  // behind (forward scatter).
  const alt = max(h.sub(rad), 0).div(rad);
  const Nc = normalize(dir.mul(b).sub(C));
  const sideLit = smoothstep(-0.3, 0.35, dot(Nc, L));
  const forward = max(dot(dir, L), 0).pow(6).mul(1.5).add(1);
  const shell = exp(alt.div(0.012).negate()).mul(0.9).add(exp(alt.div(0.05).negate()).mul(0.12));
  const air = color(0xffa860).mul(shell.mul(sideLit).mul(forward).mul(front).mul(float(1).sub(cover)));
  return mix(bg, disc, cover).add(air) as V3;
}

/** The sun: a hard white disc, a tight glare and a wide faint halo. */
function sun(dir: V3, pix: F): V3 {
  const a = length(dir.sub(v3(SUN_DIR)));
  const disc = clamp(float(SUN_ANGLE).sub(a).div(pix).add(0.5), 0, 1);
  const glare = exp(a.div(0.02).negate()).mul(1.2).add(exp(a.div(0.12).negate()).mul(0.06));
  return vec3(1.0, 0.95, 0.86).mul(disc.mul(40).add(glare)) as V3;
}

/** The dome: a big camera-centred sphere drawn last among the opaque things, behind everything. */
export function spaceDome(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition)) as V3;
    // One pixel's angle (fwidth is |dx| + |dy|, about two pixels' worth; guarded: it can be 0 on helper lanes).
    const pix = max(length(fwidth(dir)).mul(0.5), 1e-5) as F;
    // The sun shows where the planet isn't (planetOver covers it).
    return planetOver(dir, pix, sky(dir, pix).add(sun(dir, pix)) as V3);
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after the opaque rooms: their depth leaves only the window's pixels to shade
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  mesh.name = 'space';
  return mesh;
}
