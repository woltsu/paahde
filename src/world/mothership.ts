// The mothership in the sky (docs/mothership.md): a wheel station ~12,000 km across in a geosynchronous orbit
// (shared/mothership.ts says where it is, from the time of day), so it's in the sky all day and all night, biggest and
// lowest in the south at midnight.
//
// After the classic wheel stations of 1970s–80s space art: a great segmented ring on lattice spokes and fine cables,
// spinning round a central hub column; a saucer and cone under the hub with a lattice antenna, a lattice mast and a big
// ribbed dish on top, golden solar panels on truss arms and tanks clustered round the hub's top. Silvery, plated, a few
// dim portholes, no coloured lights. Its axis leans (shared/mothership.ts), so from the desert the ring is a slanting
// ellipse; the hub turns its panels to the sun.
//
// It has to feel vast through a telescope too, so it has detail at every scale, the way a city does from a plane:
// plating in sections, panels and sub-panels (procedural, each scale fading out once it's under a pixel, so zooming in
// keeps finding more), hundreds of modules, fins and pipe runs on the ring, lattices you can count the bays of, decks of
// pinprick windows that blend into a faint glow from afar, and a few tiny craft drifting between ring and hub for scale.
//
// Drawn in a pass of its own: its little scene (the model, the sunlight it sees, the glow off the desert below it)
// rendered each frame, when it's in view, into a target a little under the screen's resolution to the naked eye (it's
// 40,000 km off, through the air: never razor sharp) and up to full resolution through a scope, with a camera turned
// like the player's but standing at its centre (no parallax). The sky dome (sky.ts) then lays that picture over the
// stars, under the air: stars, sun and moon behind it are covered by it, the sky's glow is in front of it, and a haze
// veil keeps it from looking pasted on; zoomed in, the air between shimmers it a little. So by day it shows pale through
// the sky the way the moon does and by night it's a dim sunlit shape blotting out stars. The depth buffer stays at 1
// there, as for all sky (post.ts tells sky from ground by it), and the ground covers it.
//
// The model is made here in code (prisms, tori, rods, lattices, sphere caps), in units of its size (about 1 end to
// end): +y the spin axis (mast and dish), the ring in the xz plane, +x towards the sun (for the hub).
import * as THREE from 'three/webgpu';
import {
  abs, float, floor, fract, fwidth, length, max, mix, mx_cell_noise_float, mx_noise_float, normalLocal, positionLocal,
  screenUV, smoothstep, step, texture, time, uniform, vec2, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mothershipAt, newMothership } from '../../shared/mothership.ts';
import { nightLevel, sandStorm, sunDirection } from './env.ts';

type N = Node<'vec3'>;
type F = Node<'float'>;

/** How far off the station is drawn in its own pass (any distance does: only its angle shows). */
const DRAW_AT = 1000;
/** Sunlight on it, unfiltered by air (the desert's noon sun is ~3.9); kept low so it doesn't outshine the sky. */
const SPACE_SUN = 2.0;
/** Light that gets through the air to us at its best (the rest is the veil: the sky's glow lies in front of it). */
const VEIL = 0.5;
/** Its picture's resolution, as a share of the screen's, to the naked eye (a touch soft, as through 40,000 km of air);
 *  through a scope it rises with the zoom to full resolution, so the detail is there to see. */
const RES = 0.6;
/** Field of view (degrees) taken as the naked eye's, for the zoom. */
const EYE_FOV = 70;
/** The ring's spin (rad per real second): 1 g at its ~5,000 km radius is a turn in ~142 min of game time (~178 s real). */
const RING_SPIN = (2 * Math.PI) / 178;

const tex = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
/** 1 while the picture is fresh and on screen (else the sky doesn't read it). */
const shipOn = uniform(0);
/** Haze and dust between us and it (0..1), and its reddening low over the horizon. */
const shipClear = uniform(1);
const shipLow = uniform(0);
/** Shimmer of the air (screen UV units): none to the naked eye, a pixel or so through a scope. */
const shimmer = uniform(0);

// Seeing: the picture wobbles a little, in slow cells, as through a long column of moving air.
const wobble = vec2(
  mx_noise_float(vec3(screenUV.mul(vec2(9, 6)), time.mul(1.3))),
  mx_noise_float(vec3(screenUV.mul(vec2(9, 6)).add(17.3), time.mul(1.1))),
).mul(shimmer);
const pic = texture(tex.texture, screenUV.add(wobble));
/** How much of the sky behind (stars, sun, moon) it covers at a pixel: 0..1. */
export const shipCover: F = pic.a.mul(shipOn).mul(shipClear);
/** Its light reaching the ground at a pixel (linear HDR), veiled, reddened and dimmed low over the horizon. */
export const shipLight: N = pic.rgb.mul(mix(vec3(1), vec3(1.0, 0.55, 0.3), shipLow)).mul(shipOn).mul(shipClear).mul(VEIL);

// --- Materials -----------------------------------------------------------------------------------------------------
const P = positionLocal as unknown as N;
const NL = normalLocal as unknown as N;
const cellOf = (q: N): F => mx_cell_noise_float(floor(q));
/** 1 while cells of `q` span more than ~3 pixels, fading to 0 as they shrink under one: no sparkle, detail appears
 *  as you zoom in. */
const shows = (q: N): F => float(1).sub(smoothstep(0.2, 0.55, length(fwidth(q))));
const maxOf = (v: N): F => max(max(v.x, v.y), v.z);

/** Plate seams of cells `k` per unit: thin dark lines on every face (not along the face's own normal axis). */
function seams(k: number): F {
  const q = P.mul(k);
  const w = max(fwidth(q), vec3(0.06));
  const d = abs(fract(q).sub(0.5));
  const line = smoothstep(vec3(0.5).sub(w), vec3(0.5), d).mul(vec3(1).sub(abs(NL)));
  return maxOf(line as N).mul(shows(q));
}

/** Plating: sections, panels and sub-panels, each a slightly different shade with seams between, fading out under a
 *  pixel. `grain`: how strongly it shows. */
function plating(grain = 1): F {
  let tone: F = float(1);
  for (const [k, a] of [[18, 0.1], [70, 0.08], [280, 0.07], [1100, 0.06], [4400, 0.05]] as const) {
    const q = P.mul(k);
    tone = tone.mul(float(1).sub(cellOf(q).mul(a * grain).mul(shows(q))));
  }
  let s: F = float(0);
  for (const [k, a] of [[70, 0.12], [280, 0.22], [1100, 0.26], [4400, 0.22]] as const) s = max(s, seams(k).mul(a * grain));
  return tone.mul(float(1).sub(s));
}

/** Pinprick windows in cells `k` per unit, `density` of them lit, warm (a few cool): dots up close, blending into their
 *  average glow once they're under a pixel. Dim: always on, daylight drowns them, never a light show. */
function windows(q: N, density: number, k: number): N {
  const c = q.mul(k);
  const dot = float(1).sub(smoothstep(0.12, 0.3, length(fract(c).sub(0.5)))).mul(step(1 - density, cellOf(c)));
  // Resolved, a lit window is a bright pinprick; unresolved, only its share of a faint glow.
  const lit = mix(float(density * 0.06), dot.mul(40), shows(c));
  const tint = mix(vec3(1.0, 0.72, 0.45), vec3(0.7, 0.82, 1.0), step(0.88, cellOf(c.mul(0.37))));
  return tint.mul(lit).mul(mix(float(0.03), float(0.5), nightLevel));
}

/** Plated metal of a base colour. `lit`: window density (0 none), in decks across y. */
function metal(r: number, g: number, b: number, opts: { rough?: number; grain?: number; lit?: number } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: opts.rough ?? 0.45, metalness: 0.3, side: THREE.DoubleSide });
  m.colorNode = vec3(r, g, b).mul(plating(opts.grain ?? 1));
  if (opts.lit) {
    // Decks: rows of windows every few thousandths, broken into runs; from afar, their faint average.
    const rows = P.mul(vec3(30, 300, 30));
    const deck = float(1).sub(smoothstep(0.08, 0.2, abs(fract(rows.y).sub(0.5))));
    const run = step(0.35, cellOf(rows));
    m.emissiveNode = windows(P, opts.lit, 600).mul(mix(float(0.15), deck.mul(run), shows(rows)));
  }
  return m;
}

/** Solar panels: dull gold cells in a darker grid, at two scales. */
function solar() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.45, side: THREE.DoubleSide });
  const grid = (k: number, w: number) => {
    const q = P.mul(vec3(0, k, k * 0.7));
    return max(step(1 - w, fract(q.y)), step(1 - w, fract(q.z))).mul(shows(q));
  };
  const cells = vec3(0.36, 0.3, 0.15).mul(cellOf(P.mul(vec3(0, 260, 180))).mul(0.25).add(0.75));
  m.colorNode = mix(mix(cells, vec3(0.2, 0.18, 0.13), grid(1200, 0.15)), vec3(0.55, 0.53, 0.5), grid(120, 0.06));
  return m;
}

/** Engine glow of the little craft: dim, past the bloom threshold only just. */
function glow() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = vec3(0.75, 0.85, 1.0).mul(2.2);
  return m;
}

// --- Geometry helpers ----------------------------------------------------------------------------------------------
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const mtx = new THREE.Matrix4();
const qt = new THREE.Quaternion();

/** Seeded dice (fixed layout). */
let seed = 7;
const rnd = (a = 0, b = 1) => a + (b - a) * ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A prism along y, its middle at y; r2 the top radius. */
const col = (r: number, len: number, y: number, seg = 24, r2 = r, open = false) => new THREE.CylinderGeometry(r2, r, len, seg, 1, open).translate(0, y, 0);
/** A rod from a to b (`sides` faces). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 4) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), sides, 1, true);
  g.applyQuaternion(qt.setFromUnitVectors(UP, d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
/** A box with its local axes x, y, z along the given unit vectors, centred at `at`. */
function boxAt(w: number, h: number, d: number, at: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
  return new THREE.BoxGeometry(w, h, d).applyMatrix4(mtx.makeBasis(x, y, z).setPosition(at));
}
/** A ring (torus of radius r, tube t) facing along `n`, centred at `at`. */
const hoop = (r: number, t: number, at: THREE.Vector3, n: THREE.Vector3) =>
  new THREE.TorusGeometry(r, t, 6, 24).applyQuaternion(qt.setFromUnitVectors(V(0, 0, 1), n)).translate(at.x, at.y, at.z);
/** A lattice from a to b: `sides` longerons round a square (4) or triangle (3) of width w, a ring of struts and a zigzag
 *  of diagonals on every face per bay. */
function truss(out: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, w: number, bay: number, sides = 3) {
  const axis = new THREE.Vector3().subVectors(b, a);
  const len = axis.length();
  axis.normalize();
  const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? UP : V(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  const r = w / (sides === 4 ? Math.SQRT2 : Math.sqrt(3));
  const corner = (i: number, t: number) => {
    const ang = (i / sides) * Math.PI * 2 + Math.PI / 4;
    return a.clone().addScaledVector(axis, t).addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
  };
  const bays = Math.max(1, Math.round(len / bay));
  const thick = w * 0.07, thin = w * 0.035;
  for (let i = 0; i < sides; i++) out.push(rod(corner(i, 0), corner(i, len), thick));
  for (let k = 0; k <= bays; k++) {
    const t = (k / bays) * len;
    for (let i = 0; i < sides; i++) out.push(rod(corner(i, t), corner((i + 1) % sides, t), thin));
    if (k < bays) {
      const t2 = ((k + 1) / bays) * len;
      for (let i = 0; i < sides; i++) out.push(k % 2 ? rod(corner(i, t), corner((i + 1) % sides, t2), thin) : rod(corner((i + 1) % sides, t), corner(i, t2), thin));
    }
  }
}
/** A dish of radius r, its back at the origin, opening along +y: a shallow cap, a rim, ribs behind it and a feed on a
 *  tripod; placed by `m`. */
function dish(skin: THREE.BufferGeometry[], frame: THREE.BufferGeometry[], r: number, m: THREE.Matrix4, ribs = 16) {
  const R = r * 1.6, cap = 0.68;
  const depth = R * (1 - Math.cos(cap));
  const add = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry) => list.push(g.applyMatrix4(m));
  add(skin, new THREE.SphereGeometry(R, 32, 6, 0, Math.PI * 2, Math.PI - cap, cap).translate(0, R, 0));
  add(frame, new THREE.TorusGeometry(r, r * 0.025, 4, 48).rotateX(Math.PI / 2).translate(0, depth, 0));
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const s = (k / 4) * cap, rr = R * Math.sin(s);
      pts.push(V(Math.cos(a) * rr, R - R * Math.cos(s) - r * 0.03, Math.sin(a) * rr));
    }
    for (let k = 0; k < 4; k++) add(frame, rod(pts[k], pts[k + 1], r * 0.012));
  }
  const feed = V(0, depth + r * 0.9, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(frame, rod(V(Math.cos(a) * r * 0.95, depth, Math.sin(a) * r * 0.95), feed, r * 0.012));
  }
  add(frame, new THREE.CylinderGeometry(r * 0.05, r * 0.08, r * 0.18, 10).translate(0, depth + r * 0.85, 0));
}

// --- The station ---------------------------------------------------------------------------------------------------
const RING_R = 0.42;
const TUBE = 0.026;

const KINDS = ['silver', 'grey', 'dark', 'red', 'gold', 'white', 'hab', 'lattice'] as const;
type Parts = Record<(typeof KINDS)[number], THREE.BufferGeometry[]>;
const parts = (): Parts => ({ silver: [], grey: [], dark: [], red: [], gold: [], white: [], hab: [], lattice: [] });

/** A point on the ring tube's surface at ring angle a and tube angle f (0 = outer equator, π/2 = top), with its frame:
 *  n out of the surface, t along the ring, b = n × t. */
function onRing(a: number, f: number, lift = 0) {
  const radial = V(Math.cos(a), 0, Math.sin(a));
  const n = radial.clone().multiplyScalar(Math.cos(f)).addScaledVector(UP, Math.sin(f));
  const t = V(-Math.sin(a), 0, Math.cos(a));
  const at = radial.clone().multiplyScalar(RING_R).addScaledVector(n, TUBE + lift);
  return { at, n, t, b: new THREE.Vector3().crossVectors(n, t) };
}
/** A point on a vertical column of radius r at angle a and height y, with its frame (n outwards, t round, b up). */
function onColumn(r: number, a: number, y: number, lift = 0) {
  const n = V(Math.cos(a), 0, Math.sin(a));
  return { at: V(n.x * (r + lift), y, n.z * (r + lift)), n, t: V(-Math.sin(a), 0, Math.cos(a)), b: UP.clone() };
}

/** A little craft (a shuttle or tug): body, wings, a fin; nose along `fwd`, length `len`. */
function shuttle(p: Parts, at: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3, len: number) {
  const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const u = new THREE.Vector3().crossVectors(fwd, side);
  p.white.push(boxAt(len * 0.25, len * 0.2, len, at, side, u, fwd));
  p.white.push(boxAt(len * 0.8, len * 0.04, len * 0.35, at.clone().addScaledVector(fwd, -len * 0.2), side, u, fwd));
  p.dark.push(boxAt(len * 0.04, len * 0.3, len * 0.25, at.clone().addScaledVector(fwd, -len * 0.35).addScaledVector(u, len * 0.2), side, u, fwd));
}

function buildRing(p: Parts) {
  // The tube, finely tessellated (no facets through a scope), with collars every few degrees, bigger every sixth.
  p.hab.push(new THREE.TorusGeometry(RING_R, TUBE, 20, 384).rotateX(Math.PI / 2));
  for (let i = 0; i < 96; i++) {
    const big = i % 6 === 0;
    p.grey.push(new THREE.TorusGeometry(RING_R, TUBE + (big ? 0.0035 : 0.0016), 12, 2, big ? 0.01 : 0.004).rotateZ((i / 96) * Math.PI * 2).rotateX(Math.PI / 2));
  }
  p.red.push(new THREE.TorusGeometry(RING_R, TUBE + 0.0012, 12, 6, 0.03).rotateZ(2.1).rotateX(Math.PI / 2));
  p.red.push(new THREE.TorusGeometry(RING_R, TUBE + 0.0012, 12, 6, 0.012).rotateZ(5.0).rotateX(Math.PI / 2));
  // Pipe runs along the ring: bundles on top, below and inside.
  for (const f of [0.95, 1.02, -0.95, -1.02, 2.3, -2.3, 2.9]) {
    const r = RING_R + Math.cos(f) * (TUBE + 0.0015);
    p.dark.push(new THREE.TorusGeometry(r, 0.0009, 4, 256).rotateX(Math.PI / 2).translate(0, Math.sin(f) * (TUBE + 0.0015), 0));
  }
  // A walkway rail on the top and bottom, with posts.
  for (const f of [Math.PI / 2, -Math.PI / 2]) {
    p.dark.push(new THREE.TorusGeometry(RING_R, 0.0006, 3, 256).rotateX(Math.PI / 2).translate(0, Math.sin(f) * (TUBE + 0.004), 0));
    for (let i = 0; i < 180; i++) {
      const s = onRing((i / 180) * Math.PI * 2, f);
      p.dark.push(rod(s.at, s.at.clone().addScaledVector(s.n, 0.004), 0.0004, 3));
    }
  }

  // Habitat districts: modules clustered in sectors over the outer and top/bottom faces, some stacked, with smaller
  // boxes and masts on them; lit windows in decks.
  for (let sector = 0; sector < 18; sector++) {
    const a0 = (sector / 18) * Math.PI * 2 + rnd(-0.05, 0.05), span = rnd(0.12, 0.25);
    const n = Math.round(rnd(30, 60));
    for (let i = 0; i < n; i++) {
      const s = onRing(a0 + rnd(0, span), rnd(-1.35, 1.35));
      const w = rnd(0.002, 0.009), h = rnd(0.001, 0.005), d = rnd(0.003, 0.016);
      const at = s.at.clone().addScaledVector(s.n, h / 2);
      p.hab.push(boxAt(w, h, d, at, s.b, s.n, s.t));
      if (rnd() < 0.35) {
        const h2 = rnd(0.001, 0.003);
        p.grey.push(boxAt(w * rnd(0.4, 0.8), h2, d * rnd(0.3, 0.7), at.clone().addScaledVector(s.n, h / 2 + h2 / 2), s.b, s.n, s.t));
      }
      if (rnd() < 0.15) p.lattice.push(rod(at, at.clone().addScaledVector(s.n, rnd(0.004, 0.01)), 0.0003, 3));
    }
  }
  // Scattered greebles everywhere else: hatches, tanks, boxes.
  for (let i = 0; i < 900; i++) {
    const s = onRing(rnd(0, Math.PI * 2), rnd(-Math.PI, Math.PI));
    const w = rnd(0.0008, 0.003), h = rnd(0.0004, 0.0018), d = rnd(0.001, 0.005);
    (rnd() < 0.7 ? p.grey : p.dark).push(boxAt(w, h, d, s.at.clone().addScaledVector(s.n, h / 2), s.b, s.n, s.t));
  }
  // Radiator fins standing in rows on the top in four sectors.
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2 + 0.6;
    for (let i = 0; i < 40; i++) {
      const s = onRing(a0 + i * 0.004, Math.PI / 2);
      p.white.push(boxAt(0.012, 0.007, 0.0004, s.at.clone().addScaledVector(s.n, 0.0035), s.b, s.n, s.t));
    }
  }
  // Docking bays: four big blocks on the outer rim, each with a port, a small crane and a shuttle docked (for scale).
  for (let k = 0; k < 4; k++) {
    const s = onRing((k / 4) * Math.PI * 2 + 0.2, 0);
    p.grey.push(boxAt(0.016, 0.014, 0.05, s.at.clone().addScaledVector(s.n, 0.007), s.b, s.n, s.t));
    const port = s.at.clone().addScaledVector(s.n, 0.014);
    const end = port.clone().addScaledVector(s.n, 0.012);
    p.silver.push(rod(port, end, 0.004, 16));
    p.dark.push(hoop(0.005, 0.0008, end, s.n));
    const base = port.clone().addScaledVector(s.t, 0.018);
    p.lattice.push(rod(base, base.clone().addScaledVector(s.n, 0.01), 0.0007));
    p.lattice.push(rod(base.clone().addScaledVector(s.n, 0.01), base.clone().addScaledVector(s.n, 0.012).addScaledVector(s.t, -0.014), 0.0005));
    shuttle(p, end.clone().addScaledVector(s.n, 0.004), s.n, s.t, 0.006);
  }
  // Flat plates on the rim (the painting's) on short lattices.
  for (const a of [0.5, 2.6, 4.4]) {
    const s = onRing(a, 0);
    p.grey.push(boxAt(0.003, 0.05, 0.08, s.at.clone().addScaledVector(s.n, 0.012), s.n, UP, s.t));
    truss(p.lattice, s.at, s.at.clone().addScaledVector(s.n, 0.011), 0.006, 0.003, 3);
  }

  // Spokes: four lattice spokes, a pressurised shaft running inside each (the lifts), pods at mid-span.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const out = V(Math.cos(a), 0, Math.sin(a));
    const from = out.clone().multiplyScalar(0.09), to = out.clone().multiplyScalar(RING_R - TUBE * 0.6);
    truss(p.lattice, from, to, 0.014, 0.008, 4);
    p.silver.push(rod(from, to, 0.0035, 12));
    for (let k = 1; k < 10; k++) p.grey.push(rod(from.clone().lerp(to, k / 10 - 0.004), from.clone().lerp(to, k / 10 + 0.004), 0.0045, 12));
    const mid = from.clone().lerp(to, 0.55);
    p.hab.push(rod(mid.clone().addScaledVector(out, -0.012), mid.clone().addScaledVector(out, 0.012), 0.008, 16));
  }
  // Cables from the hub's top and bottom out to the ring, the painting's fine rigging.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.05;
    const rim = V(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R);
    p.lattice.push(rod(V(0, 0.19, 0), rim, 0.00022, 3), rod(V(0, -0.16, 0), rim.clone().applyAxisAngle(UP, Math.PI / 20), 0.00022, 3));
  }
  // The bearing drum's turning side: ribs round it.
  for (let i = 0; i < 48; i++) {
    const s = onColumn(0.085, (i / 48) * Math.PI * 2, 0);
    p.grey.push(boxAt(0.003, 0.06, 0.002, s.at, s.n, s.b, s.t));
  }
}

function buildHub(p: Parts) {
  // The column: plated, collared every few hundredths, a red band, the drum, pipes up its sides, modules and ports.
  p.hab.push(col(0.055, 0.48, 0.02, 48));
  for (let y = -0.21; y < 0.26; y += 0.024) p.grey.push(col(0.0575, 0.004, y, 48));
  p.red.push(col(0.0565, 0.012, 0.125, 48));
  p.grey.push(col(0.085, 0.07, 0, 64));
  for (const y of [-0.036, 0.036]) p.dark.push(col(0.09, 0.004, y, 64));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    p.dark.push(col(0.0012, 0.44, 0.02, 4).translate(Math.cos(a) * 0.0585, 0, Math.sin(a) * 0.0585));
  }
  for (let i = 0; i < 420; i++) {
    const y = rnd(-0.21, 0.25);
    const s = onColumn(0.055, rnd(0, Math.PI * 2), y);
    if (Math.abs(y) < 0.04) continue;
    const w = rnd(0.002, 0.008), h = rnd(0.0008, 0.004), d = rnd(0.002, 0.01);
    (rnd() < 0.6 ? p.grey : p.hab).push(boxAt(h, d, w, s.at.clone().addScaledVector(s.n, h / 2), s.n, s.b, s.t));
  }
  // Docking ports sticking out, with end rings, and a few antennas.
  for (let i = 0; i < 8; i++) {
    const s = onColumn(0.055, rnd(0, Math.PI * 2), rnd(-0.19, 0.22));
    if (Math.abs(s.at.y) < 0.05) continue;
    const end = s.at.clone().addScaledVector(s.n, rnd(0.01, 0.022));
    p.silver.push(rod(s.at, end, 0.004, 16));
    p.dark.push(hoop(0.0048, 0.0009, end, s.n));
  }
  for (let i = 0; i < 10; i++) {
    const s = onColumn(0.058, rnd(0, Math.PI * 2), rnd(-0.2, 0.24));
    const tip = s.at.clone().addScaledVector(s.n, rnd(0.008, 0.025)).addScaledVector(UP, rnd(-0.005, 0.005));
    p.lattice.push(rod(s.at, tip, 0.0004, 3));
  }

  // Under the hub: a cone out to the saucer (ribbed, decks of windows round its rim), a cone back in (banded), docking
  // arms with craft, and a lattice antenna with two small dishes.
  p.grey.push(col(0.16, 0.05, -0.245, 64, 0.055));
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    p.dark.push(rod(V(Math.cos(a) * 0.058, -0.221, Math.sin(a) * 0.058), V(Math.cos(a) * 0.16, -0.269, Math.sin(a) * 0.16), 0.0008, 3));
  }
  p.hab.push(col(0.165, 0.022, -0.281, 96));
  for (const y of [-0.271, -0.291]) p.dark.push(col(0.167, 0.002, y, 96));
  p.grey.push(col(0.035, 0.08, -0.332, 64, 0.16));
  for (const y of [-0.31, -0.33, -0.35]) {
    const r = 0.16 + ((y + 0.292) / 0.08) * 0.125;
    p.dark.push(col(r + 0.002, 0.003, y, 64));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const out = V(Math.cos(a), 0, Math.sin(a));
    const from = out.clone().multiplyScalar(0.14).setY(-0.3), to = out.clone().multiplyScalar(0.21).setY(-0.31);
    truss(p.lattice, from, to, 0.008, 0.006, 3);
    p.grey.push(rod(to, to.clone().addScaledVector(out, 0.012), 0.006, 16));
    if (i !== 1) shuttle(p, to.clone().addScaledVector(out, 0.022).setY(-0.314), out, UP, 0.007);
  }
  truss(p.lattice, V(0, -0.37, 0), V(0, -0.52, 0), 0.012, 0.008, 3);
  for (const s of [-1, 1]) {
    p.lattice.push(rod(V(0, -0.49, 0), V(s * 0.035, -0.5, 0), 0.0015));
    dish(p.white, p.lattice, 0.022, new THREE.Matrix4().makeRotationZ(s * 2.2).setPosition(s * 0.04, -0.505, 0), 10);
  }

  // On top: a platform with a rail, tanks round it (one rust red) piped to the column, a narrower collared column, a
  // lattice mast, the big ribbed dish and two smaller ones on booms.
  p.grey.push(col(0.095, 0.016, 0.27, 64));
  p.dark.push(new THREE.TorusGeometry(0.094, 0.0007, 4, 96).rotateX(Math.PI / 2).translate(0, 0.284, 0));
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    p.dark.push(rod(V(Math.cos(a) * 0.094, 0.278, Math.sin(a) * 0.094), V(Math.cos(a) * 0.094, 0.284, Math.sin(a) * 0.094), 0.0004, 3));
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.4, r = 0.062 + (i % 3) * 0.01, s = rnd(0.012, 0.024);
    const c = V(Math.cos(a) * r, 0.278 + s, Math.sin(a) * r);
    (i === 4 ? p.red : p.white).push(new THREE.SphereGeometry(s, 20, 12).translate(c.x, c.y, c.z));
    p.dark.push(col(s * 0.9, 0.002, c.y, 20).translate(c.x, 0, c.z));
    p.dark.push(rod(c, V(Math.cos(a) * 0.036, c.y, Math.sin(a) * 0.036), 0.0008, 4));
  }
  p.white.push(new THREE.CapsuleGeometry(0.014, 0.06, 4, 16).rotateZ(Math.PI / 2).translate(-0.02, 0.31, 0.1));
  p.hab.push(col(0.034, 0.13, 0.34, 48));
  for (let y = 0.29; y < 0.4; y += 0.016) p.grey.push(col(0.036, 0.003, y, 48));
  truss(p.lattice, V(0, 0.4, 0), V(0, 0.58, 0), 0.02, 0.012, 4);
  dish(p.white, p.lattice, 0.11, new THREE.Matrix4().makeRotationZ(-1.0).setPosition(0.03, 0.6, 0), 24);
  p.lattice.push(rod(V(0, 0.585, 0), V(0.03, 0.6, 0), 0.002));
  for (const [y, a] of [[0.47, 2.0], [0.52, 4.2]] as const) {
    const boom = V(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05);
    p.lattice.push(rod(V(0, y, 0), boom, 0.0012));
    dish(p.white, p.lattice, 0.018, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.6, a, 0.9)).setPosition(boom.x, boom.y, boom.z), 10);
  }

  // Solar panels: truss arms each side (along z, square to the sun), four framed panels on each facing the sun (+x),
  // equipment drums at the roots.
  for (const s of [-1, 1]) for (const y of [0.2, 0.3]) {
    truss(p.lattice, V(0, y, s * 0.05), V(0, y, s * 0.36), 0.008, 0.006, 3);
    for (let k = 0; k < 4; k++) {
      const z = s * (0.1 + k * 0.068);
      p.gold.push(new THREE.BoxGeometry(0.0015, 0.075, 0.062).translate(0.006, y, z));
      for (const dy of [-0.0375, 0.0375]) p.dark.push(new THREE.BoxGeometry(0.002, 0.0012, 0.062).translate(0.006, y + dy, z));
      for (const dz of [-0.031, 0.031]) p.dark.push(new THREE.BoxGeometry(0.002, 0.075, 0.0012).translate(0.006, y, z + dz));
    }
    p.white.push(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 20).rotateX(Math.PI / 2).translate(0, y + 0.01, s * 0.07));
    p.grey.push(new THREE.CylinderGeometry(0.013, 0.013, 0.003, 20).rotateX(Math.PI / 2).translate(0, y + 0.01, s * 0.05));
  }
}

function buildStation(): { station: THREE.Group; ring: THREE.Group; craft: THREE.Object3D[] } {
  seed = 7;
  const station = new THREE.Group();
  const ring = new THREE.Group();
  const hub = parts(), wheel = parts();
  buildHub(hub);
  buildRing(wheel);

  const mats: Record<(typeof KINDS)[number], THREE.Material> = {
    silver: metal(0.8, 0.79, 0.76),
    grey: metal(0.56, 0.55, 0.53),
    dark: metal(0.24, 0.24, 0.24, { rough: 0.6, grain: 0.5 }),
    red: metal(0.5, 0.1, 0.07, { rough: 0.6, grain: 0.6 }),
    gold: solar(),
    white: metal(0.86, 0.85, 0.82, { rough: 0.35, grain: 0.6 }),
    hab: metal(0.78, 0.77, 0.74, { lit: 0.22 }),
    lattice: metal(0.45, 0.45, 0.44, { rough: 0.6, grain: 0 }),
  };
  const add = (p: Parts, into: THREE.Object3D) => {
    for (const k of KINDS) {
      if (!p[k].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(p[k].map((g) => (g.index ? g.toNonIndexed() : g))), mats[k]);
      mesh.frustumCulled = false;
      into.add(mesh);
    }
  };
  add(hub, station);
  add(wheel, ring);
  station.add(ring);

  // Craft coming and going (moved each frame), with their engine glow.
  const craft: THREE.Object3D[] = [];
  const glowMat = glow();
  for (let i = 0; i < 7; i++) {
    const big = i < 2, len = big ? 0.009 : 0.005;
    const c = parts();
    shuttle(c, V(0, 0, 0), V(0, 0, 1), UP, len);
    const g = new THREE.Group();
    add(c, g);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(len * 0.18, 8, 6), glowMat);
    flame.position.z = -len * 0.58;
    g.add(flame);
    station.add(g);
    craft.push(g);
  }
  return { station, ring, craft };
}

/** Where craft `i` is at time t (s), in the station's frame: two big transports going out from and back to the
 *  saucer's dock below, the rest tugs on lazy loops between the ring and the hub. */
function craftAt(i: number, t: number, out: THREE.Vector3) {
  if (i < 2) {
    const u = (t / 240 + i * 0.5) % 1; // a 4-minute round trip
    const d = 0.4 + 0.5 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
    return out.set(0.03 * (i ? 1 : -1), -d, 0.02 * Math.sin(u * 6));
  }
  const a = t / (90 + i * 23) + i * 1.7;
  const r = 0.22 + 0.12 * Math.sin(i * 2.3 + t / 70);
  return out.set(Math.cos(a) * r, 0.05 * Math.sin(a * 2 + i) + (i % 2 ? 0.08 : -0.06), Math.sin(a) * r);
}

// --- The pass ------------------------------------------------------------------------------------------------------
export class Mothership {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, DRAW_AT * 0.4, DRAW_AT * 1.6);
  private station: THREE.Group;
  private ring: THREE.Group;
  private craft: THREE.Object3D[];
  private sun = new THREE.DirectionalLight(0xffffff, SPACE_SUN);
  /** Light off the desert below. */
  private shine = new THREE.DirectionalLight(new THREE.Color(1.0, 0.62, 0.36), 0);
  private state = newMothership();
  private size = new THREE.Vector2();
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private basis = new THREE.Matrix4();
  private vx = new THREE.Vector3();
  private vy = new THREE.Vector3();
  private vz = new THREE.Vector3();
  private ahead = new THREE.Vector3();

  constructor() {
    const { station, ring, craft } = buildStation();
    this.station = station;
    this.ring = ring;
    this.craft = craft;
    this.scene.add(station, this.sun, this.sun.target, this.shine, this.shine.target, new THREE.AmbientLight(0x8890a0, 0.04));
  }

  /** Where it is now (time of day) and its picture for this frame, as `camera` sees the sky. */
  update(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, tod: number, unixMs: number) {
    const s = mothershipAt(tod, this.state);
    const scale = DRAW_AT * s.angle;
    this.station.position.set(s.dir.x, s.dir.y, s.dir.z).multiplyScalar(DRAW_AT);
    this.station.scale.setScalar(scale);
    // Attitude: y the spin axis, x the sun's way square to it (the hub turns its panels to the sun).
    const y = this.vy.set(s.axis.x, s.axis.y, s.axis.z);
    const x = this.vx.copy(sunDirection.value).addScaledVector(y, -sunDirection.value.dot(y)).normalize();
    const z = this.vz.crossVectors(x, y);
    this.station.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    const t = (unixMs / 1000) % 1e6;
    this.ring.rotation.y = -(t * RING_SPIN) % (Math.PI * 2);
    // The craft, nose along their way (looked at in the station's own frame: lookAt works in the parent's when the
    // parent has no rotation of its own, so aim through a local target).
    for (let i = 0; i < this.craft.length; i++) {
      const c = this.craft[i];
      craftAt(i, t, c.position);
      craftAt(i, t + 2, this.ahead);
      c.quaternion.setFromRotationMatrix(this.m4.lookAt(this.ahead, c.position, UP));
    }
    this.station.updateMatrixWorld(true);

    // Sunlight (reddened in the shadow's rim) and the desert's glow from below.
    this.sun.position.copy(sunDirection.value).multiplyScalar(DRAW_AT * 2).add(this.station.position);
    this.sun.target.position.copy(this.station.position);
    this.sun.color.setRGB(1, 1 - s.red * 0.6, 1 - s.red * 0.85);
    this.sun.intensity = SPACE_SUN * s.sunlit;
    this.shine.position.set(s.belly.x, s.belly.y, s.belly.z).multiplyScalar(DRAW_AT).add(this.station.position);
    this.shine.target.position.copy(this.station.position);
    this.shine.intensity = 0.25 * s.planetshine;

    // Air between: it fades into the haze down at the horizon, and dust storms hide it.
    shipClear.value = THREE.MathUtils.smoothstep(s.dir.y, -0.01, 0.1) * (1 - 0.75 * sandStorm.value);
    shipLow.value = 1 - THREE.MathUtils.smoothstep(s.dir.y, 0.05, 0.4);

    // Only drawn when some of it is in view.
    const cam = this.camera;
    cam.quaternion.copy(camera.quaternion);
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.zoom = camera.zoom;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.sphere.set(this.station.position, scale * 0.75);
    if (shipClear.value <= 0 || !this.frustum.intersectsSphere(this.sphere)) {
      shipOn.value = 0;
      return;
    }
    // Sharper and shimmering the more it's zoomed (a scope narrows the field of view).
    const zoom = Math.max(1, EYE_FOV / (camera.fov / camera.zoom));
    shimmer.value = zoom > 1.2 ? Math.min(0.0012, 0.0004 * (zoom - 1)) : 0;
    const res = Math.min(1, RES * zoom);
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * res)), h = Math.max(1, Math.round(this.size.y * res));
    if (tex.width !== w || tex.height !== h) tex.setSize(w, h);
    const previous = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(tex);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, alpha);
    shipOn.value = 1;
  }
}
