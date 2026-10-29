// The last pod in the beginning's bay (docs/levels/tutorial.md beat 8): pod.glb's Pod at full size, lying across the bay
// with its hatch towards you, and the two things it does, read off the player's gates (set by the server, never in the
// sim). While you carry the relay and it isn't in, a ghost of it breathes in the open junction box beside the hatch: that
// is where it goes. Once it is in (GATE.powered) the relay seats, the box's cover swings shut, the pod wakes (its lamp
// green, a chirp), the seal lets go with a hiss and the hatch swings down on its lower hinge until it lies open as a ramp,
// the cabin's lights flickering on behind it (cabin.ts, its pooled light); F then gets in (src/levels/beginning/index.ts, server/tutorial.ts: not before POD_OPEN_MS).
// Seen already done (a reconnect, a late load), it is simply so.
//
// pod.glb has its hatch modelled blown open (tools/blender/pod.py: the desert's crashed pod) and merged into the hull, so
// the hatch's triangles are found here by the transform pod.py hangs it open with, cut out into their own meshes shut, and
// swung on the same hinge. The constants below are pod.py's (HATCH_A, HATCH_HALF_A, HATCH_Y, AXIS_Z, NOSE, BARREL).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CABINET, GATE, POD, POD_OPEN_MS } from '../../../shared/levels/beginning.ts';
import { CABINET_LEVEL, CABINET_SEED, RELAY_INDEX } from '../../../shared/levels/beginningCabinet.ts';
import { machineParts } from '../../../shared/machine.ts';
import { loadPart } from '../../teardown/junk.ts';
import { Cabin } from './cabin.ts';
import { HATCH_A, HATCH_A0, HATCH_A1, HATCH_HALF, HATCH_Y0, HATCH_Y1, hullFrame, onHull, polar, radiusAt } from './podHull.ts';

/** How far pod.py swings the hatch open (rad, about +z through its lower hinge). */
const OPEN = 1.75;
/** The hatch's hinge line (through this point, along z). */
const HINGE = onHull(HATCH_A + HATCH_HALF, 0);

/** Is (x, y, z), swung back shut, on the hatch (its skin, its inner face, its wheel boss)? */
function onHatch(x: number, y: number, z: number): boolean {
  const c = Math.cos(-OPEN), s = Math.sin(-OPEN), dx = x - HINGE.x, dy = y - HINGE.y;
  const ux = HINGE.x + dx * c - dy * s, uy = HINGE.y + dx * s + dy * c;
  const ay = -z, { a, r } = polar(ux, uy), R = radiusAt(ay);
  return a > HATCH_A - HATCH_HALF - 0.06 && a < HATCH_A + HATCH_HALF + 0.06 && ay > HATCH_Y0 - 0.02 && ay < HATCH_Y1 + 0.02
    && r > R - 0.16 && r < R + 0.04;
}

/** Cut the hatch out of the pod's meshes, shut: a group on its hinge (rotation.z 0 shut, OPEN as modelled). */
function cutHatch(pod: THREE.Object3D): THREE.Group {
  const hinge = new THREE.Group();
  hinge.position.set(HINGE.x, HINGE.y, 0);
  const inner = new THREE.Group();
  inner.position.set(-HINGE.x, -HINGE.y, 0);
  hinge.add(inner);
  const shut = new THREE.Matrix4().makeTranslation(HINGE.x, HINGE.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(-OPEN)).multiply(new THREE.Matrix4().makeTranslation(-HINGE.x, -HINGE.y, 0));
  const meshes: THREE.Mesh[] = [];
  pod.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const g = m.geometry, index = g.index, pos = g.attributes.position;
    if (!index) continue;
    const on = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) on[i] = onHatch(pos.getX(i), pos.getY(i), pos.getZ(i)) ? 1 : 0;
    const keep: number[] = [], cut: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
      (on[a] && on[b] && on[c] ? cut : keep).push(a, b, c);
    }
    if (!cut.length) continue;
    const hg = g.clone();
    hg.setIndex(cut);
    hg.applyMatrix4(shut);
    g.setIndex(keep);
    const hm = new THREE.Mesh(hg, m.material);
    hm.castShadow = hm.receiveShadow = true;
    m.updateMatrix();
    hm.applyMatrix4(m.matrix);
    inner.add(hm);
  }
  return hinge;
}

/** In the way of the cabin (a triangle, three points): inside the hull round the hatch (the dark core, pod.py's own token
 *  cabin), or anything over the opening itself (hull panels that ran over its edges, the token cabin's face). */
function inTheWay(p: THREE.Vector3[]): boolean {
  const D = Math.PI / 180, pol = p.map((v) => ({ ...polar(v.x, v.y), ay: -v.z }));
  if (pol.every(({ a, r, ay }) => ay > -0.75 && ay < 0.45 && a > 150 * D && a < 242 * D && r > 0.02 && r < radiusAt(ay) - 0.03)) return true;
  const c = p[0].clone().add(p[1]).add(p[2]).divideScalar(3), cp = polar(c.x, c.y), cy = -c.z;
  if (!pol.every(({ r, ay }) => r < radiusAt(ay) + 0.035)) return false;
  if (cp.a > HATCH_A0 && cp.a < HATCH_A1 && cy > HATCH_Y0 && cy < HATCH_Y1) return true;
  // (A hull panel's triangle reaching into the opening from past its edge: its whole quad goes, cabin.ts backs the gap.)
  if (pol.some(({ a }) => a > HATCH_A0 + 0.05 && a < HATCH_A1 - 0.05)
    && pol.every(({ a, ay }) => a > HATCH_A0 - 0.15 && a < HATCH_A1 + 0.15 && ay > HATCH_Y0 - 0.02 && ay < HATCH_Y1 + 0.02)) return true;
  // (A face of the token cabin reaching in from the opening's edge: it dips under the hull.)
  return cp.r < radiusAt(cy) - 0.03 && pol.every(({ a, ay }) => a > 160 * D && a < 232 * D && ay > HATCH_Y0 - 0.06 && ay < HATCH_Y1 + 0.06);
}

/** Drop the triangles `test` says are in the way from the pod's meshes. */
function cutAway(pod: THREE.Object3D, test: (p: THREE.Vector3[]) => boolean) {
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  pod.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.index) return;
    const g = m.geometry, index = g.index!, pos = g.attributes.position;
    const keep: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const i = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      i.forEach((k, j) => v[j].fromBufferAttribute(pos, k));
      if (!test(v)) keep.push(...i);
    }
    if (keep.length < index.count) g.setIndex(keep);
  });
}

// ---- the timeline after the relay goes in (s): POD_OPEN_MS covers it ---------------------------------------------------

const SEAT_S = 0.25;
const COVER = [0.4, 1.0] as const;
const WAKE_S = 1.15;
const HATCH = [1.55, 3.05] as const;
const DONE_S = POD_OPEN_MS / 1000;
/** The cabin's lights flicker on once the hatch is down: (seconds after it lands, how lit) steps, then on. */
const FLICKER: readonly [number, number][] = [[0, 0], [0.06, 0.8], [0.12, 0.05], [0.24, 0.55], [0.3, 0], [0.42, 1]];
const LIT_END = HATCH[1] + 0.45;
/** From the cover shutting its light already holds a pool slot, unseen (so it comes on at once, not eased in, and the
 *  cabin's materials are made while it is lit: Cabin.show). */
const LIGHT_HELD = 0.002;
/** The junction box's cover hanging open (rad about its bottom hinge: out and down, the socket open to the eye). */
const COVER_OPEN = 1.95;

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
const easeInOut = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

/** What the pod sounds like as it opens (src/levels/beginning/sound.ts). */
export type PodSounds = { click(): void; clunk(): void; wake(): void; hiss(): void; thud(): void };

/** A soft round glow (the ghost's halo). */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function additive(color: number, map: THREE.Texture | null): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ color, map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  m.fog = false;
  return m;
}

export class Pod {
  readonly group = new THREE.Group();
  /** The hatch on its hinge, once loaded. */
  private hatch: THREE.Group | null = null;
  private cover = new THREE.Group();
  private relay = new THREE.Group();
  private ghost = new THREE.Group();
  private ghostMat = additive(0x6fdcff, null);
  private halo: THREE.Mesh;
  private lamp = new THREE.MeshBasicNodeMaterial({ color: 0x3a0c08 });
  private cabin = new Cabin();
  /** How lit the cabin is (0..1): its pooled light's weight (index.ts). */
  light = 0;
  /** Seconds since the relay went in (-1: not yet; past DONE_S: open). */
  private since = -1;
  private sounds: PodSounds;

  constructor(sounds: PodSounds) {
    this.sounds = sounds;
    this.group.position.set(POD.x, 0.05, POD.z); // (the hull's underside on the floor)
    this.group.rotation.y = POD.yaw;

    // The junction box on the hull beside the hatch, between its frame and the service ring: a socket, its cover
    // propped open, a lamp. The relay goes in it.
    const box = new THREE.Group();
    box.matrixAutoUpdate = false;
    box.matrix.copy(hullFrame(HATCH_A, 0.53));
    const frame = new THREE.MeshStandardNodeMaterial({ color: 0x3a3f46, roughness: 0.55, metalness: 0.5 });
    const back = new THREE.MeshStandardNodeMaterial({ color: 0x121417, roughness: 0.8, metalness: 0.2 });
    const paint = new THREE.MeshStandardNodeMaterial({ color: 0xd9d6cf, roughness: 0.6, metalness: 0.15 });
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, to: THREE.Object3D = box) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      to.add(mesh);
      return mesh;
    };
    part(0.22, 0.3, 0.012, 0, 0, 0.004, back);
    for (const s of [-1, 1]) {
      part(0.02, 0.32, 0.1, s * 0.12, 0, 0.05, frame);
      part(0.26, 0.02, 0.1, 0, s * 0.16, 0.05, frame);
    }
    const lamp = part(0.035, 0.012, 0.02, 0.07, 0.16, 0.105, this.lamp);
    lamp.castShadow = false;
    this.cover.position.set(0, -0.165, 0.1);
    this.cover.rotation.x = COVER_OPEN;
    part(0.25, 0.31, 0.012, 0, 0.155, 0.006, paint, this.cover);
    part(0.06, 0.025, 0.02, 0, 0.27, 0.02, frame, this.cover); // its latch
    box.add(this.cover);
    // The relay seated, and its ghost (while you carry it and it isn't in), each scaled into the socket once loaded.
    this.relay.visible = this.ghost.visible = false;
    box.add(this.relay, this.ghost);
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.36), additive(0x6fdcff, glowTexture()));
    this.halo.position.z = 0.012;
    this.halo.visible = false;
    box.add(this.halo);
    this.group.add(box);

    // The cabin behind the hatch (cabin.ts), its lights out till the hatch is down.
    this.group.add(this.cabin.group);

    const tier = machineParts(CABINET.kind, CABINET_SEED, CABINET_LEVEL)[RELAY_INDEX].tier;
    loadPart('relay', tier).then((model) => {
      // Up (the part's +y) out of the socket; as big as the socket takes.
      model.rotation.x = Math.PI / 2;
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(Math.min(0.17 / size.x, 0.24 / size.y, 0.08 / size.z));
      model.position.z = 0.01;
      const ghost = model.clone(true);
      ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = this.ghostMat;
        m.castShadow = false;
        m.renderOrder = 2;
      });
      this.relay.add(model);
      this.ghost.add(ghost);
    }).catch((e) => console.warn('beginning: the relay failed to load', e));

    new GLTFLoader().load('./models/pod.glb', (gltf) => {
      const pod = gltf.scene.getObjectByName('Pod');
      if (!pod) return;
      pod.removeFromParent();
      pod.position.set(0, 0, 0);
      pod.rotation.set(0, 0, 0);
      pod.traverse((o) => { o.castShadow = o.receiveShadow = true; });
      this.hatch = cutHatch(pod);
      cutAway(pod, inTheWay); // (the core over the opening and the model's token cabin: cabin.ts is there)
      pod.add(this.hatch);
      this.group.add(pod);
      this.pose();
    }, undefined, (e) => console.warn('beginning: the pod failed to load', e));
  }

  /** Its hatch lies open: F gets in. */
  get open() {
    return this.since >= DONE_S;
  }

  /** Every frame: `gates` the player's, `carrying` the relay in their bag, `fresh` (not the first frame since entering):
   *  a relay going in now is seen happen, else it is simply in. */
  update(dt: number, time: number, gates: number, carrying: boolean, fresh: boolean, lightOn: boolean) {
    const powered = (gates & GATE.powered) !== 0;
    if (!powered) this.since = -1;
    else if (this.since < 0) this.since = fresh ? 0 : LIT_END;
    else if (this.since < LIT_END) {
      const was = this.since, now = (this.since = Math.min(LIT_END, this.since + dt));
      const at = (t: number) => was < t && now >= t;
      if (at(SEAT_S)) this.sounds.click();
      if (at(COVER[1])) this.sounds.clunk();
      if (at(WAKE_S)) this.sounds.wake();
      if (at(HATCH[0] - 0.08)) this.sounds.hiss();
      if (at(HATCH[1])) this.sounds.thud();
    }
    if (lightOn) this.cabin.show();
    // The ghost: breathing slowly, the halo with it.
    const ghost = carrying && !powered;
    this.ghost.visible = this.halo.visible = ghost;
    if (ghost) {
      const b = 0.5 + 0.5 * Math.sin(time * 2.6);
      this.ghostMat.opacity = 0.16 + 0.26 * b;
      (this.halo.material as THREE.MeshBasicNodeMaterial).opacity = 0.05 + 0.1 * b;
    }
    this.pose();
  }

  /** Everything where `since` puts it. */
  private pose() {
    const t = this.since, on = t >= 0;
    this.relay.visible = on;
    this.relay.position.z = on ? 0.12 * (1 - smooth(t / SEAT_S)) : 0;
    this.cover.rotation.x = on ? COVER_OPEN * (1 - easeInOut((t - COVER[0]) / (COVER[1] - COVER[0]))) : COVER_OPEN;
    this.lamp.color.setHex(on && t >= WAKE_S ? 0x7dffa8 : 0x3a0c08);
    const swing = on ? easeInOut((t - HATCH[0]) / (HATCH[1] - HATCH[0])) : 0;
    if (this.hatch) this.hatch.rotation.z = OPEN * swing;
    let lit = on && t >= COVER[0] ? LIGHT_HELD : 0;
    if (on && t >= HATCH[1]) for (const [after, level] of FLICKER) if (t - HATCH[1] >= after) lit = Math.max(level, LIGHT_HELD);
    this.light = lit;
    this.cabin.setLit(lit);
  }
}
