// The datacenter's materials (docs/levels/datacenter.md "Materials"): one node material per kind, procedural from the
// level frame (merged boxes are not transformed, so positionLocal is the level's) and, on the instanced racks, from the
// rack's own frame (positionGeometry / normalGeometry). No downloaded textures: the bake maps (bake.ts) carry contact AO
// and the far light. Every fine pattern fades to its average with its screen-space size (fwidth), or it shimmers.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, color, distance, float, floor, fract, fwidth, hash, instanceIndex, length, max, min, mix,
  mx_fractal_noise_float, mx_noise_float, normalGeometry, normalLocal, positionGeometry, positionLocal, positionWorld, select, smoothstep,
  step, texture, time, uniform, vec2, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { LevelMat } from '../../../shared/levels/datacenter.ts';
import type { BakeMaps } from './bake.ts';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Tunables (the bench, a power cut later): the far light's strength, the LEDs and the strips. */
export const dcLook = {
  bakeScale: uniform(0.55),
  ledPower: uniform(1),
  strip: uniform(3.5),
};

/** A face's 2D coordinates from its axis-aligned normal: no triplanar needed. */
/** A colour as a vec3 node (the typings keep 'color' and 'vec3' apart). */
const col = (hex: number) => color(hex) as unknown as V3;

const faceUV = (p: V3, n: V3): V2 => select(abs(n.y).greaterThan(0.5), p.xz, select(abs(n.x).greaterThan(0.5), p.zy, p.xy)) as V2;

/** Staggered round holes of `r` at `pitch` (m): 1 in a hole; the open fraction where they go sub-pixel. (A plain
 *  function, not an Fn: the numbers must stay numbers to compute the open fraction.) */
const holePattern = (p: V2, pitch: number, r: number): F => {
  const q = p.div(pitch);
  const row = floor(q.y);
  const c = vec2(fract(q.x.add(row.mod(2).mul(0.5))), fract(q.y)).sub(0.5).mul(pitch);
  const d = length(c), aa = fwidth(d);
  const hole = float(1).sub(smoothstep(float(r).sub(aa), float(r).add(aa), d));
  const open = (Math.PI * r * r) / (pitch * pitch);
  return mix(hole, float(open), smoothstep(pitch * 0.25, pitch * 0.6, fwidth(p.x)));
};

/** Thin dark lines every `pitch` along `c` (louvres, rungs, bezels), faded out where they'd shimmer. */
const lines = (c: F, pitch: number, width: number): F => {
  const f = fract(c.div(pitch));
  const e = min(f, f.oneMinus()).mul(pitch);
  const line = float(1).sub(smoothstep(width, float(width).add(fwidth(e)), e));
  return mix(line, float((2 * width) / pitch), smoothstep(pitch * 0.2, pitch * 0.5, fwidth(c)));
};

export function makeMaterials(maps: BakeMaps): Record<LevelMat, THREE.MeshStandardNodeMaterial> {
  const bakeUV = (p: V2) => p.sub(vec2(maps.min.x, maps.min.y)).div(vec2(maps.size.x, maps.size.y));
  const bakeAt = (p: V2) => texture(maps.bake, bakeUV(p));
  // The far field: lit by the bake beyond the pool's reach, cross-faded by the surface's own distance from the camera.
  const farLight = smoothstep(5, 9, distance(positionWorld, cameraPosition)).mul(dcLook.bakeScale);
  const std = (hex: number, rough: number, metal = 0) => {
    const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: metal });
    m.fog = false;
    return m;
  };
  const concrete = (p: V2, base: number, alt: number) => {
    const stain = mx_fractal_noise_float(vec3(p.mul(0.35), 0), 3, 2, 0.5).mul(0.5).add(0.5);
    return { stain, albedo: mix(color(base), color(alt), stain) as V3 };
  };

  // --- Floor: sealed slab, stains, grit, 0.6 m tile seams, perforated tiles in the cold aisles.
  const floorM = std(0x6a6a67, 0.45);
  {
    const p = positionLocal.xz;
    const { stain, albedo: slab } = concrete(p, 0x5e5f5d, 0x74746f);
    const grit = mx_noise_float(vec3(p.mul(9), 1)).mul(0.5).add(0.5);
    const f = fract(p.div(0.6));
    const edge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(0.6);
    const seam = float(1).sub(smoothstep(0.003, float(0.003).add(fwidth(edge)), edge));
    const bake = bakeAt(p);
    const perf = texture(maps.tiles, p.sub(vec2(maps.min.x, maps.min.y)).div(vec2(maps.tileSize.x, maps.tileSize.y))).r;
    const holes = holePattern(p, 0.025, 0.007).mul(perf);
    const albedo = slab.mul(grit.mul(0.08).add(0.92)).mul(seam.mul(0.5).oneMinus()).mul(holes.mul(0.7).oneMinus());
    floorM.colorNode = albedo.mul(bake.r);
    floorM.roughnessNode = mix(float(0.28), float(0.6), stain).add(seam.mul(0.3)).add(holes.mul(0.3));
    floorM.emissiveNode = albedo.mul(bake.b).mul(farLight);
  }

  // --- Walls: painted block, mortar joints, a darker dado band, contact shade at the floor and the ceiling.
  const wallM = std(0xa7a9a8, 0.85);
  {
    const q = faceUV(positionLocal, normalLocal).div(vec2(0.4, 0.2));
    const course = floor(q.y);
    const bx = q.x.add(course.mod(2).mul(0.5));
    const b = vec2(fract(bx), fract(q.y));
    const jx = smoothstep(0.02, float(0.02).add(fwidth(b.x)), min(b.x, b.x.oneMinus()));
    const jy = smoothstep(0.04, float(0.04).add(fwidth(b.y)), min(b.y, b.y.oneMinus()));
    const joint = float(1).sub(jx.mul(jy)).mul(float(1).sub(smoothstep(0.02, 0.05, fwidth(q.y))));
    const tint = mx_noise_float(vec3(floor(bx), course, 3)).mul(0.04);
    const y = positionLocal.y;
    const ceilH = attribute('ceilH', 'float') as unknown as F;
    const dado = step(y, 1.2);
    const ao = smoothstep(0, 0.5, y).mul(0.45).add(0.55).mul(smoothstep(ceilH, ceilH.sub(0.6), y).mul(0.3).add(0.7));
    const albedo = (mix(color(0xa7a9a8), color(0x5d6266), dado) as V3).add(tint).mul(joint.mul(0.25).oneMinus()).mul(ao);
    wallM.colorNode = albedo;
    // The far light up the wall from the floor in front of it, fading by a few metres up.
    const far = bakeAt(positionLocal.xz.add(normalLocal.xz.mul(0.3))).b.mul(smoothstep(4, 0, y).mul(0.6).add(0.2));
    wallM.emissiveNode = albedo.mul(far).mul(farLight);
  }

  // --- Pillars: cast concrete, the floor's noise.
  const pillarM = std(0x8f918f, 0.8);
  {
    const p = faceUV(positionLocal, normalLocal);
    const { albedo } = concrete(p, 0x868886, 0x9a9c99);
    const ao = smoothstep(0, 0.5, positionLocal.y).mul(0.4).add(0.6);
    pillarM.colorNode = albedo.mul(ao);
    pillarM.emissiveNode = albedo.mul(bakeAt(positionLocal.xz).b).mul(farLight).mul(0.5);
  }

  // --- Ceiling and beams: dark, board-form streaks along x, darker where the walls and beams meet it.
  const ceilingM = std(0x26282b, 0.95);
  {
    const p = positionLocal;
    const streak = mx_noise_float(vec3(p.x.mul(0.15), p.z.mul(3), 5)).mul(0.08);
    ceilingM.colorNode = color(0x26282b).add(streak).mul(bakeAt(p.xz).g);
  }

  // --- Galvanised steel (frames, rods), trays with ladder rungs, cable bundles.
  const steelM = std(0x9a9fa3, 0.45, 0.8);
  steelM.colorNode = color(0x9a9fa3).mul(mx_noise_float(vec3(positionLocal.mul(1.7))).mul(0.08).add(0.95));
  const trayM = std(0x9a9fa3, 0.5, 0.8);
  trayM.colorNode = color(0x9a9fa3).mul(lines(positionLocal.x, 0.3, 0.02).mul(0.55).oneMinus())
    .mul(select(normalLocal.y.lessThan(-0.5), float(0.45), float(1)));
  const cableM = std(0x15171a, 0.7);
  cableM.colorNode = col(0x15171a).add(col(0xe8c020).mul(step(0.55, mx_noise_float(vec3(positionLocal.x.mul(0.1), positionLocal.z.mul(5), 2)))).mul(0.5));

  // --- Equipment (cooling units, UPS, batteries): off-white with louvres, a dark panel with two LEDs.
  const equipM = std(0xd6d8d4, 0.6);
  {
    const p = positionLocal;
    const louvre = lines(p.y, 0.025, 0.003).mul(step(0.3, p.y)).mul(step(p.y, 1.6));
    const ao = smoothstep(0, 0.3, p.y).mul(0.4).add(0.6);
    equipM.colorNode = color(0xd6d8d4).mul(louvre.mul(0.6).oneMinus()).mul(ao);
    const blink = step(fract(time.mul(0.7)), 0.85);
    const led = select(abs(normalLocal.y).lessThan(0.5), smoothstep(0.015, 0.008, length(fract(faceUV(p, normalLocal).mul(2.1)).sub(vec2(0.5, 0.86)))), float(0));
    equipM.emissiveNode = color(0x39ff6a).mul(led).mul(blink).mul(dcLook.ledPower).mul(4);
  }

  // --- The exit door, floor paint, hazard bands.
  const doorM = std(0x4a5258, 0.5, 0.3);
  doorM.colorNode = color(0x4a5258).mul(lines(positionLocal.y, 0.55, 0.004).mul(0.4).oneMinus());
  const paintM = std(0xe8c020, 0.5);
  paintM.polygonOffset = true;
  paintM.polygonOffsetFactor = -1;
  paintM.polygonOffsetUnits = -4;
  const hazardM = std(0xe8c020, 0.5);
  hazardM.polygonOffset = true;
  hazardM.polygonOffsetFactor = -1;
  hazardM.polygonOffsetUnits = -4;
  hazardM.colorNode = mix(color(0x1a1a1a), color(0xe8c020), step(0.5, fract(positionLocal.x.add(positionLocal.z).div(0.2))));

  // --- Light: strips (emissive underside, one in eight tired and flickering), downlight discs, emergency lamps.
  const stripM = std(0x3a3d41, 0.6, 0.3);
  {
    const seed = hash(floor(positionLocal.z.mul(4)).add(select(positionLocal.x.greaterThan(0), float(37), float(0))));
    const tired = step(0.875, seed);
    const flicker = mix(float(1), float(0.2), step(0.97, hash(floor(time.mul(7)).add(seed.mul(100)))));
    const bright = mix(float(1), float(0.6).mul(flicker), tired);
    const under = step(normalLocal.y, -0.5);
    stripM.emissiveNode = color(0xeef3ff).mul(under).mul(bright).mul(dcLook.strip);
  }
  const downM = std(0x3a3d41, 0.6, 0.3);
  downM.emissiveNode = color(0xeef3ff).mul(step(normalLocal.y, -0.5)).mul(4);
  const emergM = std(0x553322, 0.6);
  emergM.emissiveNode = color(0xff7a1a).mul(3);

  // --- Racks (instanced: the rack's own frame, front = +z): powder coat, a perforated, glass or blank door, 1U bezels and
  // status LEDs behind it, a perforated back with a few link lights. hash(instanceIndex) picks the door and how full.
  const rackM = std(0x1d1f23, 0.45);
  {
    const pg = positionGeometry, ng = normalGeometry;
    const inst = instanceIndex.toFloat();
    const v = hash(inst.add(0.5));
    const fill = hash(inst.add(7.5)).mul(0.6).add(0.3);
    const front = ng.z.greaterThan(0.5), back = ng.z.lessThan(-0.5);
    const face = vec2(pg.x, pg.y);
    const inner = step(abs(pg.x), 0.27).mul(step(0.03, pg.y)).mul(step(pg.y, 1.97));
    const handle = step(0.2, pg.x).mul(step(pg.x, 0.215)).mul(step(0.9, pg.y)).mul(step(pg.y, 1.08));
    const perforated = v.lessThan(0.75), glass = v.greaterThanEqual(0.75).and(v.lessThan(0.9));
    const holes = holePattern(face, 0.008, 0.0014);
    // How much of the inside shows: the holes, the smoked glass at half, nothing through a blank door.
    const see = select(perforated, holes, select(glass, float(0.5), float(0))).mul(inner);
    // Inside: near-black with 1U bezels.
    const U = 0.04445;
    const yy = pg.y.sub(0.1);
    const u = floor(yy.div(U));
    const bezel = lines(yy, U, 0.0012);
    const inside = col(0x0b0c0e).add(col(0x1a1c20).mul(bezel));
    const coat = mix(color(0x1b1d21), color(0x24272c), hash(inst.add(3.5))) as V3;
    const contact = smoothstep(0, 0.3, pg.y).mul(0.4).add(0.6);
    const orange = mx_noise_float(vec3(positionLocal.mul(300))).mul(0.08);
    const doorColor = mix(coat, inside, see).add(color(0x5a5f66).mul(handle));
    rackM.colorNode = select(front, doorColor, select(back, mix(coat.mul(0.7), inside, holes.mul(inner)), coat)).mul(contact);
    rackM.roughnessNode = select(front.and(glass), float(0.1), float(0.45).add(orange));
    // LEDs: a filled 1U row has a steady power LED and a blinking activity one.
    const s = hash(inst.mul(64).add(u));
    const filled = step(s, fill).mul(step(u, 41)).mul(step(0, u));
    const ledAt = (x: number) => {
      const cell = vec2(pg.x.sub(x), fract(yy.div(U)).sub(0.5).mul(U));
      const r = 0.0015, aa = max(fwidth(pg.x), fwidth(yy));
      const dot = float(1).sub(smoothstep(float(r).sub(aa), float(r).add(aa), length(cell)));
      // far away (or at a grazing angle) the dot is sub-pixel: a dim average glow in its own column, so the rows
      // still flicker without smearing across the door
      const column = float(1).sub(smoothstep(0.004, 0.012, abs(pg.x.sub(x))));
      return mix(dot, column.mul(0.03), smoothstep(0.002, 0.006, aa));
    };
    const rate = mix(float(0.7), float(9), hash(s.add(13)));
    const on = step(fract(time.mul(rate).add(s.mul(17))), mix(float(0.3), float(0.95), hash(s.add(3))));
    const pick = hash(s.add(5));
    const tint = select(pick.lessThan(0.82), color(0x39ff6a), select(pick.lessThan(0.95), color(0xffb020), color(0x3a8bff))) as unknown as V3;
    const net = v.greaterThanEqual(0.9);
    // A blank network rack: amber lights on a patch strip at the top, seen through no holes (they're on the door).
    const netRow = step(1.7, pg.y).mul(step(pg.y, 1.85));
    const frontLed = tint.mul(ledAt(-0.21).add(ledAt(-0.19).mul(on))).mul(filled).mul(max(see, float(0.25)).mul(inner));
    const netLed = color(0xffb020).mul(ledAt(-0.2 + 0.05).mul(on)).mul(netRow).mul(inner);
    const backLed = color(0x39ff6a).mul(ledAt(0.18).mul(on)).mul(filled).mul(step(0.7, s)).mul(holes).mul(inner);
    const led = select(front, select(net, netLed, frontLed), select(back, backLed, vec3(0)));
    rackM.emissiveNode = led.mul(dcLook.ledPower).mul(6);
  }

  return {
    floor: floorM, wall: wallM, pillar: pillarM, ceiling: ceilingM, steel: steelM, tray: trayM, cable: cableM,
    equipment: equipM, door: doorM, strip: stripM, downlight: downM, emergency: emergM, paint: paintM, hazard: hazardM, rack: rackM,
  };
}
