// The beginning's set pieces and dressing (docs/levels/tutorial.md "Set pieces"), client-only and read off the player's
// gates (they never touch the sim, the cart's solid is the sim's: CART): the station's screens, the cleaning cart crossing
// the hall, the fallen rack, the blast door coming down, the pod in its cradle, the window on the planet, and the things
// to find (a child's drawing of rain on a locker,
// the water-drop plaque, the rack rows' city labels). Words on them are TEXT's (shared/text.ts TEXT.tutorial).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLAST, CART, FALLEN, GAP, POD, SCREENS, WINDOW, cartX } from '../../../shared/levels/beginning.ts';
import { TEXT } from '../../../shared/text.ts';
import { boxGeometry } from '../boxLevel.ts';
import { planet, space } from './planet.ts';

/** A word or two in light on dark (a screen, a label): a canvas texture on a basic material, bright enough to read. */
function sign(text: string, w: number, h: number, color: string, bg: string, glow = 1.6): { mesh: THREE.Mesh; set: (t: string) => void } {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const set = (t: string) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = color;
    g.font = `${Math.round(c.height * 0.42)}px Neuropol, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, c.width / 2, c.height / 2, c.width * 0.9);
    tex.needsUpdate = true;
  };
  set(text);
  const m = new THREE.MeshBasicNodeMaterial({ map: tex });
  m.color.setScalar(glow);
  m.fog = false;
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(w, h), m), set };
}

/** Which of the station's states its screens show, by the beat you are at. */
export function screenWord(beat: number): string {
  const S = TEXT.tutorial.screens;
  return beat <= 1 ? S.nominal : beat <= 3 ? S.decay : beat <= 5 ? S.attitude : S.entry;
}

export class Props {
  readonly group = new THREE.Group();
  private screens: ((t: string) => void)[] = [];
  private word = '';
  private cart = new THREE.Group();
  /** Seconds the cart has been rolling (its wheels' judder). */
  private cartT = 0;
  private blast: THREE.Mesh;
  /** The blast door's edge (m over the floor), easing to where the gates say. */
  private blastY = 2.6;
  private blastSince = -1;
  /** The pod (pod.glb's Pod), once loaded. */
  pod: THREE.Object3D | null = null;

  constructor(mats: Record<string, THREE.Material>) {
    // The station's screens along the walls.
    for (const s of SCREENS) {
      const { mesh, set } = sign(TEXT.tutorial.screens.nominal, 0.9, 0.32, '#9fe8ff', '#06121a');
      mesh.position.set(s.x - Math.sign(s.x) * 0.01, s.y, s.z);
      mesh.rotation.y = s.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(mesh);
      this.screens.push(set);
    }
    // The rack rows' labels in the collapsed aisle: city names, on the row ends facing the walk.
    TEXT.tutorial.cities.forEach((city, i) => {
      const { mesh } = sign(city, 0.55, 0.12, '#1b1d21', '#e8e4d8', 1);
      const side = i % 2 ? 1 : -1, z = i < 4 ? 44.6 : GAP.z1 + 0.6;
      mesh.position.set(side * 2.2, 1.75 - Math.floor((i % 4) / 2) * 0.3, z - 0.01);
      mesh.rotation.y = Math.PI; // facing -z, towards you walking in
      this.group.add(mesh);
    });
    // Things to find: the drawing of rain taped to a locker, the water-drop plaque in the control room.
    const drawing = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardNodeMaterial({ map: rainDrawing(), roughness: 0.9 }));
    drawing.position.set(-1.35, 1.35, 0.46);
    this.group.add(drawing);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardNodeMaterial({ map: dropPlaque(), roughness: 0.4, metalness: 0.6 }));
    plaque.position.set(1.8, 1.7, 71.99);
    plaque.rotation.y = Math.PI;
    this.group.add(plaque);

    // The cleaning cart: an off-white box on castors with a bin on its back, a blinking amber light.
    const body = new THREE.Mesh(boxGeometry([{ b: [-0.45, 0.45, 0.12, 0.85, -0.3, 0.3], zone: 'hall' }], { hall: 4.2 }), mats.equipment);
    const bin = new THREE.Mesh(boxGeometry([{ b: [-0.4, -0.05, 0.85, 1.05, -0.25, 0.25], zone: 'hall' }], { hall: 4.2 }), mats.steel);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mats.emergency);
    lamp.position.set(0.35, 0.92, 0);
    this.cart.add(body, bin, lamp);
    this.cart.position.set(CART.x0, 0, CART.z);
    this.group.add(this.cart);

    // The rack fallen across the collapsed aisle (its solid: shared/levels/beginning.ts FALLEN): a rack on its side, its
    // door towards you, stretched to the box you climb over. The rack material reads the rack's own frame, so the
    // geometry stays the racks' and the mesh's matrix lays it down: scaled, on its side (its height along x), turned.
    const rack = new THREE.BoxGeometry(0.6, 2.0, 1.2).translate(0, 1, 0);
    const fallen = new THREE.Mesh(rack, mats.rack);
    const w = 2 * FALLEN.x, d = FALLEN.z1 - FALLEN.z0;
    fallen.matrixAutoUpdate = false;
    fallen.matrix.makeTranslation(w / 2, FALLEN.h / 2, (FALLEN.z0 + FALLEN.z1) / 2)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(FALLEN.h / 0.6, w / 2.0, d / 1.2));
    fallen.castShadow = fallen.receiveShadow = true;
    this.group.add(fallen);

    // The blast door: a slab in a slot over the corridor's end, its edge coming down to BLAST.y0, then to the floor.
    this.blast = new THREE.Mesh(boxGeometry([{ b: [-1.2, 1.2, 0, 2.6, BLAST.z0, BLAST.z1], zone: 'bay' }], { bay: 2.6 }), mats.door);
    this.blast.position.y = this.blastY;
    this.group.add(this.blast);
    const stripes = new THREE.Mesh(boxGeometry([{ b: [-1.2, 1.2, 0, 0.12, BLAST.z0 - 0.005, BLAST.z1 + 0.005], zone: 'bay' }], { bay: 2.6 }), mats.hazard);
    this.blast.add(stripes);

    // The window: a thin pane, space and the planet far behind it.
    const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x9fb4c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12 });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.z1 - WINDOW.z0, WINDOW.y1 - WINDOW.y0), glass);
    pane.position.set(WINDOW.x + 0.15, (WINDOW.y0 + WINDOW.y1) / 2, (WINDOW.z0 + WINDOW.z1) / 2);
    pane.rotation.y = -Math.PI / 2;
    this.group.add(pane);
    this.group.add(space(new THREE.Vector3(WINDOW.x + 120, 2, 99), 320));
    this.group.add(planet(new THREE.Vector3(WINDOW.x + 90, -26, 140), 50));

    // The last pod, upright in its cradle, its hatch towards you.
    new GLTFLoader().load('./models/pod.glb', (gltf) => {
      const pod = gltf.scene.getObjectByName('Pod');
      if (!pod) return;
      pod.removeFromParent();
      pod.position.set(0, 0, 0);
      pod.rotation.set(0, 0, 0);
      pod.updateMatrixWorld(true);
      // Fit it into its cradle's box (shared/levels/beginning.ts: what you bump into).
      const box = new THREE.Box3().setFromObject(pod), size = box.getSize(new THREE.Vector3());
      const holder = new THREE.Group();
      const k = Math.min(2.4 / Math.max(size.x, 0.01), 3.4 / Math.max(size.z, 0.01), 2.3 / Math.max(size.y, 0.01));
      holder.scale.setScalar(k);
      const c = box.getCenter(new THREE.Vector3());
      pod.position.set(-c.x, -box.min.y, -c.z);
      holder.add(pod);
      holder.position.set(POD.x, 0, POD.z + 0.2);
      holder.rotation.y = POD.yaw;
      pod.traverse((o) => { o.castShadow = o.receiveShadow = true; });
      this.group.add(holder);
      this.pod = holder;
    }, undefined, (e) => console.warn('beginning: the pod failed to load', e));
  }

  /** Every frame: the screens' word, the cart (where `gates` put it), the blast door (`blastDown`: its bit; `shut`: down
   *  behind you). */
  update(dt: number, beat: number, gates: number, blastDown: boolean, shut: boolean, fresh: boolean) {
    const w = screenWord(beat);
    if (w !== this.word) {
      this.word = w;
      for (const set of this.screens) set(w);
    }
    // The cart: where the sim has it (its solid), smoothed between ticks; it judders while it rolls.
    const x = cartX(gates), was = this.cart.position.x;
    const moving = Math.abs(x - was) > 1e-4;
    this.cart.position.x = moving && Math.abs(x - was) < 0.5 ? was + (x - was) * Math.min(1, dt * 30) : x;
    if (moving) this.cartT += dt;
    this.cart.position.y = moving ? Math.abs(Math.sin(this.cartT * 9)) * 0.004 : 0;
    // The blast door: from the moment you came in, down to its edge over ~2 s (it is solid there from the start: the
    // drawing comes down to meet it); shut to the floor once you are past.
    const target = shut ? 0 : blastDown ? BLAST.y0 : 2.6;
    if (blastDown && this.blastSince < 0) this.blastSince = fresh ? 0 : 99;
    if (this.blastSince >= 0) this.blastSince += dt;
    const speed = shut ? 2 : 0.75;
    if (this.blastSince > 99) this.blastY = target;
    else this.blastY += Math.max(-speed * dt, Math.min(speed * dt, target - this.blastY));
    this.blast.position.y = this.blastY;
  }

  /** The blast door's edge now (its sound). */
  get blastMoving() {
    return this.blastSince >= 0 && Math.abs(this.blastY - BLAST.y0) > 0.01 && this.blastY > 0.01;
  }
}

/** A child's drawing of rain: crayon clouds, blue strokes, a stick figure with an umbrella. */
function rainDrawing(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe8d6';
  g.fillRect(0, 0, 192, 256);
  g.fillStyle = '#7d8590';
  for (const [x, y, r] of [[50, 50, 30], [90, 40, 36], [135, 55, 30]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#3a6fd0';
  g.lineWidth = 4;
  for (let i = 0; i < 26; i++) {
    const x = 20 + ((i * 37) % 160), y = 95 + ((i * 53) % 90);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y + 16); g.stroke();
  }
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 3;
  g.beginPath(); g.arc(96, 205, 9, 0, Math.PI * 2); g.moveTo(96, 214); g.lineTo(96, 240); g.stroke();
  g.strokeStyle = '#d23c2c';
  g.beginPath(); g.arc(110, 190, 26, Math.PI, 0); g.moveTo(110, 190); g.lineTo(110, 222); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The water-drop logo, on brushed steel (the same mark as on the machines out in the desert). */
function dropPlaque(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c9298';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#1d4f86';
  g.beginPath();
  g.moveTo(128, 40);
  g.bezierCurveTo(128, 40, 60, 130, 60, 160);
  g.arc(128, 160, 68, Math.PI, 0, true);
  g.bezierCurveTo(196, 130, 128, 40, 128, 40);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
