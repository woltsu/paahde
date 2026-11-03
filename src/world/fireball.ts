// Volumetric fireballs (src/world/blasts.ts `explode` sets them off and sizes them by the blast's strength). Each is a
// ball of churning gas raymarched in its own proxy sphere: the camera's ray is marched through a noise-displaced
// ball, and at each step a density and a temperature are worked out.
// - Hot gas glows by its temperature (a blackbody ramp: white-yellow, orange, deep red, out), hottest in the core, so
//   as the ball cools its rim goes dark first and the last glow is deep inside, seen through the smoke.
// - Cool gas is soot: lit from the sun's side, by the haze and the moon, and from inside by the fire still burning.
// - The noise boils upward (billows rolling up over the ball), the ball swells fast then slowly, rises, flattens on
//   top, and frays into wisps as it thins (`erode`).
// - A blast on a surface (sand, a wall) is clipped to its plane: a dome on the sand that lifts off as it rises.
// Front-to-back, stopping once nothing behind can show; premultiplied (One, OneMinusSrcAlpha), hazed by distance. The
// march's step count follows the sand detail setting (the heaviest per-pixel work there is besides the sand).
//
// Pool of SLOTS, made once (a material each, all one shader); `fire` takes the oldest when all are burning.
import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, cameraPosition, dot, exp, float, floor, fract, int, length, max, min, mix, mx_fractal_noise_float, mx_noise_float, normalize, positionWorld,
  saturate, screenCoordinate, smoothstep, sqrt, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { graphics, onGraphics } from '../graphics.ts';
import { hazeColor, hazeColorFor, hazeFactor, moonColor, nightLevel, sunColor, sunDirection } from './env.ts';

type N = Node<'vec3'>;
type F = Node<'float'>;
const c3 = (u: unknown) => u as N;
const f1 = (u: unknown) => u as F;

const SLOTS = 8;
/** March steps by sand detail (0 low .. 3 ultra). */
const STEPS = [10, 14, 18, 24];
/** How far round the ball the proxy reaches (× its radius): the noise pushes billows out past 1, and it squashes. */
const BOUND = 1.75;
/** Optical depth per radius at full density: the ball is opaque through its middle, thin at its rim. */
const EXT = 3.2;
/** Glow per radius of hot gas (HDR; bloom spreads it). */
const EMIT = 1.6;
/** How far towards the sun (radii) the one shadow tap looks, and how dark the gas it finds there makes it. */
const SHADOW_AT = 0.35, SHADOW_K = 2.2;

/** What one burns like: set by blasts.ts from its BlastSpec. */
export type FireballLook = {
  /** Radius at its fullest (m). */
  r: number;
  /** Seconds it burns, then seconds its smoke hangs on. */
  fire: number; smoke: number;
  /** Brightness of the fire (1: a blaster's). */
  heat: number;
  /** 0: a clean flash that burns away; 1: thick black smoke left behind. */
  soot: number;
  /** How fast the hot gas rises (m/s, at its fastest). */
  rise: number;
  /** The fire's colour (× the blackbody ramp; white leaves it as it is). */
  tint: THREE.Color;
};

type Slot = {
  mesh: THREE.Mesh; age: number; look: FireballLook | null; base: THREE.Vector3;
  centre: { value: THREE.Vector3 }; radius: { value: number }; heat: { value: number }; dens: { value: number };
  erode: { value: number }; boil: { value: number }; squash: { value: number }; flash: { value: number };
  plane: { value: THREE.Vector4 }; tint: { value: THREE.Color }; soot: { value: number }; gain: { value: number };
};

const steps = uniform(STEPS[graphics.sandDetail] ?? 18, 'int');
onGraphics((g, k) => {
  if (k === 'sandDetail') steps.value = STEPS[g.sandDetail] ?? 18;
});

const ball = new THREE.IcosahedronGeometry(1.06, 2); // a little over 1: its flat faces still hold the unit sphere
const _c = new THREE.Vector3();

/** Blackbody-ish ramp, T 0..1: nothing, deep red, orange, white-yellow (HDR). */
function blackbody(T: F): N {
  const red = vec3(0.55, 0.045, 0.006), orange = vec3(2.8, 0.8, 0.13), white = vec3(6, 3.6, 1.4);
  return mix(mix(red, orange, smoothstep(0.18, 0.55, T)), white, smoothstep(0.6, 1, T)).mul(smoothstep(0.04, 0.22, T));
}

function material(s: Omit<Slot, 'mesh' | 'age' | 'look' | 'base'>, seed: number) {
  const m = new THREE.MeshBasicNodeMaterial({
    // No fog (it would tint the whole proxy, not just what's in it) and no environment map (a basic material's colour is
    // multiplied by it: by night it turned the soot a glowing blue-grey). Its colour is what the march works out.
    transparent: true, depthWrite: false, fog: false, reflectivity: 0,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const centre = c3(s.centre), radius = f1(s.radius), heat = f1(s.heat), dens = f1(s.dens), erode = f1(s.erode);
  const boil = f1(s.boil), squash = f1(s.squash), flash = f1(s.flash), soot = f1(s.soot), gain = f1(s.gain);
  const plane = s.plane as unknown as Node<'vec4'>, tint = c3(s.tint);
  const out = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(ro)).toVar();
    // Into and out of the bounding sphere, from the eye on.
    const oc = ro.sub(centre);
    const b = dot(oc, rd);
    const R = radius.mul(BOUND);
    const h = max(b.mul(b).sub(dot(oc, oc).sub(R.mul(R))), 0);
    const sq = sqrt(h);
    const t0 = max(b.negate().sub(sq), 0).toVar();
    const t1 = b.negate().add(sq).toVar();
    // Nothing behind the surface struck (dot(n, p) < w).
    const dn = dot(plane.xyz, rd);
    const tp = plane.w.sub(dot(plane.xyz, ro)).div(dn.add(1e-6));
    If(dn.greaterThan(0), () => {
      t0.assign(max(t0, tp));
    }).Else(() => {
      t1.assign(min(t1, tp));
    });
    const n = float(steps);
    const dt = max(t1.sub(t0), 0).div(n);
    const dq = dt.div(radius); // a step in radii
    // Interleaved gradient noise on the pixel: an even spread of where each pixel's steps fall (no banding, no clumps).
    const jitter = fract(fract(dot(floor(screenCoordinate.xy), vec2(0.06711056, 0.00583715))).mul(52.9829189));
    const trans = float(1).toVar();
    const col = vec3(0).toVar();
    // Lit by: the sun from its side, the sky's haze all round (and the moon at night), the fire within.
    // (The haze stays bright after dark: dimmed by the night, or the smoke glows grey against a dark sky.)
    const ambient = c3(hazeColor).mul(float(1).sub(f1(nightLevel).mul(0.75)).mul(0.3)).add(c3(moonColor).mul(0.08));
    // Soot: warm grey-brown, darker the sootier.
    const albedo = vec3(1, 0.86, 0.72).mul(mix(float(0.4), float(0.09), soot));
    const noiseAt = (p: N) => p.mul(1.6).add(vec3(seed, boil.negate(), seed * 0.7));
    Loop({ start: int(0), end: steps, type: 'int', condition: '<' }, ({ i }) => {
      If(trans.lessThan(0.015), () => {
        Break();
      });
      const t = t0.add(float(i).add(jitter).mul(dt));
      const q = ro.add(rd.mul(t)).sub(centre).div(radius);
      const qs = vec3(q.x, q.y.mul(squash.add(1)), q.z);
      const r = length(qs);
      // Billows rolling up over it: the noise scrolls down through the ball as the gas boils up.
      const nz = mx_fractal_noise_float(noiseAt(qs), 3, 2.03, 0.5);
      const field = float(1).sub(r).add(nz.mul(0.55)).sub(erode);
      const rho = smoothstep(0, 0.28, field).mul(dens);
      If(rho.greaterThan(0.002), () => {
        // Hottest in the core; cooling from the outside in as `heat` falls; the noise breaks it into tongues.
        const T = saturate(heat.mul(1.4).sub(r.mul(0.75)).add(nz.mul(0.5)).add(flash));
        const a = float(1).sub(exp(rho.mul(-EXT).mul(dq)));
        // One tap towards the sun (its broad shape and first octave): billows facing it lit, the rest in their own shade.
        const qs2 = qs.add(c3(sunDirection).mul(SHADOW_AT));
        const f2 = float(1).sub(length(qs2)).add(mx_noise_float(noiseAt(qs2)).mul(0.55)).sub(erode);
        const sunVis = exp(smoothstep(0, 0.28, f2).mul(dens).mul(-SHADOW_K));
        const sunlit = c3(sunColor).mul(sunVis.mul(0.3).add(0.02)).mul(float(1).sub(f1(nightLevel).mul(0.9))); // (sunColor stays on, cool, by night)
        // Deep inside it, less of the sky gets in.
        const sky = ambient.mul(saturate(float(1).sub(field.mul(1.2))).mul(0.6).add(0.4));
        // The fire's glow on the smoke round it, warm and dying with the heat.
        const within = vec3(2.2, 0.7, 0.16).mul(tint).mul(heat.mul(heat)).mul(saturate(float(1.3).sub(r)));
        const smoke = sunlit.add(sky).mul(albedo).add(within.mul(0.35));
        const glow = blackbody(T).mul(tint).mul(gain).mul(flash.mul(2).add(1));
        col.addAssign(trans.mul(smoke.mul(a).add(glow.mul(rho).mul(dq).mul(EMIT))));
        trans.mulAssign(float(1).sub(a));
      });
    });
    const alpha = float(1).sub(trans);
    // The air between: as the scene's haze (fog is off; it would tint the whole proxy, not just what's in it).
    const flat = normalize(vec3(rd.x, min(rd.y, 0), rd.z));
    const hz = hazeFactor(centre);
    return vec4(col.mul(float(1).sub(hz)).add(hazeColorFor(flat).mul(hz).mul(alpha)), alpha);
  })();
  m.colorNode = out.xyz;
  m.opacityNode = out.w;
  return m;
}

class Fireballs {
  readonly root = new THREE.Group();
  private slots: Slot[] = [];
  private camera: THREE.Camera | null = null;

  constructor() {
    this.root.name = 'Fireballs';
    for (let i = 0; i < SLOTS; i++) {
      const u = {
        centre: uniform(new THREE.Vector3()), radius: uniform(1), heat: uniform(0), dens: uniform(0), erode: uniform(0), boil: uniform(0),
        squash: uniform(0), flash: uniform(0), plane: uniform(new THREE.Vector4(0, 1, 0, -1e9)), tint: uniform(new THREE.Color(1, 1, 1)),
        soot: uniform(0.5), gain: uniform(1),
      };
      const mesh = new THREE.Mesh(ball, material(u, i * 13.7 + 3.1));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.slots.push({ mesh, age: 0, look: null, base: new THREE.Vector3(), ...u });
    }
  }

  /** The camera (inside a ball, its back faces are drawn instead). */
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  /**
   * A fireball at (x, y, z) on a surface facing `n` (null: in the air, nothing clipped), looking like `look`. It sits
   * `lift` × its radius off the surface, so on the sand it's a dome.
   */
  fire(x: number, y: number, z: number, n: THREE.Vector3 | null, look: FireballLook, lift = 0.35) {
    let s = this.slots[0];
    for (const o of this.slots) {
      if (!o.look) {
        s = o;
        break;
      }
      if (o.age / (o.look.fire + o.look.smoke) > s.age / (s.look!.fire + s.look!.smoke)) s = o;
    }
    s.age = 0;
    s.look = look;
    s.base.set(x, y, z);
    if (n) {
      s.base.addScaledVector(n, look.r * lift);
      // A hand's breadth below the surface: the dome's foot meets it rather than floating on it.
      s.plane.value.set(n.x, n.y, n.z, n.x * x + n.y * y + n.z * z - 0.15);
    } else s.plane.value.set(0, 1, 0, -1e9);
    s.tint.value.copy(look.tint);
    s.soot.value = look.soot;
    s.gain.value = look.heat;
    s.mesh.visible = true;
    this.step(s, 0);
  }

  update(dt: number) {
    const eye = this.camera?.getWorldPosition(_c);
    for (const s of this.slots) {
      if (!s.look) continue;
      s.age += dt;
      const L = s.look;
      if (s.age >= L.fire + L.smoke) {
        s.look = null;
        s.mesh.visible = false;
        continue;
      }
      this.step(s, dt);
      // Inside it the front faces are behind the eye: draw the back ones (marched from the eye on).
      const inside = !!eye && eye.distanceTo(s.centre.value) < s.radius.value * BOUND * 1.02;
      const side = inside ? THREE.BackSide : THREE.FrontSide;
      if (s.mesh.material instanceof THREE.Material && s.mesh.material.side !== side) s.mesh.material.side = side;
    }
  }

  /** Where slot `s` is in its life (its age already advanced). */
  private step(s: Slot, dt: number) {
    const L = s.look!, a = s.age, F = L.fire, S = L.smoke;
    const burnt = Math.min(1, a / F), late = Math.max(0, (a - F) / S);
    // Swells in a blink, then slowly as the smoke spreads.
    const r = L.r * (0.18 + 0.82 * (1 - Math.exp(-a / (F * 0.2)))) * (1 + 0.45 * late);
    s.radius.value = r;
    s.flash.value = Math.max(0, 1 - a / 0.07);
    s.heat.value = 1.05 * Math.pow(Math.max(0, 1 - a / F), 0.6);
    // Thick while it burns; a cleaner one burns away, a sooty one leaves a cloud that thins out.
    const smokeK = 0.25 + 0.75 * L.soot;
    const thin = a < F * 0.5 ? 1 : a < F ? 1 + (smokeK - 1) * ((a - F * 0.5) / (F * 0.5)) : smokeK * Math.pow(1 - late, 1.5);
    s.dens.value = thin;
    s.erode.value = 0.08 + 0.5 * late * late + 0.1 * burnt;
    s.boil.value = a * (0.9 + 1.5 / Math.sqrt(L.r)) + a * a * 0.05;
    s.squash.value = 0.3 * Math.min(1, a / (F + S * 0.5));
    // Rising faster once the fire has caught; on the slot's own base, not the plane (the plane stays on the surface).
    s.base.y += dt * L.rise * Math.min(1, burnt * 1.5) * (1 - 0.5 * late);
    s.centre.value.copy(s.base);
    s.mesh.position.copy(s.base);
    s.mesh.scale.setScalar(r * BOUND);
  }
}

export const fireballs = new Fireballs();
