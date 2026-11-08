// The net terminal (public/models/terminal.glb, tools/blender/terminal.py): an old beige mainframe terminal, CRT and
// keyboard, whose screen streams code. The code is the game's own, as this page loaded it: one of the scripts in the
// browser's resource timing (the build's minified chunks; in dev, Vite's transformed modules), fetched again from the
// HTTP cache, or this module's own functions if that fails. Reusable two ways:
//   new NetTerminal({ seed, tint, lit }) — the whole terminal: add `.object` where it stands (origin on the floor at the
//     footprint's centre, screen facing +Z), call `.update(dt, eye)` every frame;
//   new CodeScreen({ w, h, seed, tint }) — only the glass (a bulged plane facing +Z), for any other model's screen.
// Client-only dressing: it never touches the sim. Nothing streams or uploads beyond RANGE of the eye.
import * as THREE from 'three/webgpu';
import type { LightsNode } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { abs, color, float, fwidth, max, sin, smoothstep, texture, time, uv, vec2 } from 'three/tsl';
import { glbMaterial } from './glbMaterial.ts';

/** The bezel's opening in terminal.glb (tools/blender/terminal.py SCREEN_*): centre height, the tube's face, size. */
export const TERMINAL_SCREEN = { y: 0.27, z: 0.073, w: 0.3, h: 0.225 };

/** Phosphors. */
export const TINTS = { green: 0x6dff9c, amber: 0xffb347, white: 0xd8e8ff } as const;
export type Tint = keyof typeof TINTS;

/** Beyond this (m) a screen holds its last frame. */
const RANGE = 24;
const COLS = 56;
const ROWS = 21;
const PX_W = 640;
const PX_H = 480;
const MARGIN = 16;
/** Texture uploads per second, at most. */
const FPS = 20;

// ------------------------------------------------------------------------------------------------ the code

const texts = new Map<string, Promise<string>>();

/** The page's own scripts, same origin (the build's chunks, or Vite's modules in dev), this module's first. */
function scriptUrls(): string[] {
  const urls = new Set<string>([import.meta.url]);
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name, location.href);
    if (u.origin === location.origin && /\.(m?js|ts)$/.test(u.pathname)) urls.add(u.href);
  }
  return [...urls];
}

/** Printable ASCII only (a terminal of its day had nothing else): tabs to spaces, anything else a dot. */
function sanitize(s: string): string {
  return s.replace(/\t/g, '  ').replace(/\r/g, '').replace(/[^\x20-\x7e\n]/g, '.');
}

/** Code for a screen to stream, chosen by `seed` among the page's scripts. */
function codeFor(seed: number): Promise<string> {
  const urls = scriptUrls();
  const url = urls[seed % urls.length];
  let p = texts.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => (t.length > 2000 ? sanitize(t) : Promise.reject(new Error('short'))))
      .catch(() => sanitize([scriptUrls, sanitize, codeFor, CodeScreen].map(String).join('\n')));
    texts.set(url, p);
  }
  return p;
}

/** Tiny seeded LCG in [0, 1): each screen's rhythm its own. */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32);
}

// ------------------------------------------------------------------------------------------------ the screen

export type CodeScreenOptions = { w: number; h: number; seed?: number; tint?: Tint; /** forward bulge at the centre (m) */ bulge?: number };

/** A CRT's glass streaming code: bursts of output at a few hundred characters a second, pauses with the cursor
 *  blinking, now and then a line typed slowly as if by hand. Text in a canvas, phosphor, scanlines, barrel and glow in TSL. */
export class CodeScreen {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly rand: () => number;
  private readonly cellW = (PX_W - 2 * MARGIN) / COLS;
  private readonly cellH = (PX_H - 2 * MARGIN) / ROWS;
  private code = '';
  private at = 0;
  private lines: string[] = [''];
  /** Characters a second now (0: paused), and for how much longer (s). */
  private rate = 0;
  private left = 0.4;
  private owed = 0;
  private clock = 0;
  private drawnAt = -1;
  private dirty = true;
  /** The cursor's phase as last drawn (0: shown). */
  private blink = 0;
  private readonly here = new THREE.Vector3();

  constructor(o: CodeScreenOptions) {
    const seed = o.seed ?? 0;
    this.rand = lcg(seed + 1);
    this.canvas.width = PX_W;
    this.canvas.height = PX_H;
    this.g = this.canvas.getContext('2d')!;
    const g = this.g;
    g.font = '18px ui-monospace, Menlo, Consolas, monospace';
    const size = Math.floor((18 * this.cellW) / Math.max(1, g.measureText('M').width));
    g.font = `${Math.min(size, Math.floor(this.cellH * 0.9))}px ui-monospace, Menlo, Consolas, monospace`;
    g.textBaseline = 'top';
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace; // a mask: the phosphor colours it
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.draw();

    const geo = new THREE.PlaneGeometry(o.w, o.h, 12, 9);
    const pos = geo.attributes.position;
    const bulge = o.bulge ?? 0.01;
    for (let i = 0; i < pos.count; i++) {
      const u = (2 * pos.getX(i)) / o.w;
      const v = (2 * pos.getY(i)) / o.h;
      pos.setZ(i, bulge * (1 - 0.6 * u * u) * (1 - 0.6 * v * v));
    }
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, crtMaterial(this.tex, TINTS[o.tint ?? 'green']));
    this.mesh.name = 'codeScreen';
    codeFor(seed).then((c) => {
      this.code = c;
      this.at = Math.floor(lcg(seed + 7)() * c.length);
    });
  }

  /** Every frame; `eye` the camera's world position (nothing happens beyond RANGE of it). */
  update(dt: number, eye: THREE.Vector3) {
    if (this.mesh.getWorldPosition(this.here).distanceTo(eye) > RANGE || !this.code) return;
    this.clock += dt;
    this.left -= dt;
    if (this.left <= 0) this.nextSpell();
    this.owed += this.rate * dt;
    let n = Math.floor(this.owed);
    this.owed -= n;
    if (n > 0) this.dirty = true;
    while (n-- > 0) this.put(this.code[this.at++ % this.code.length]);
    const blink = Math.floor(this.clock * 2.5) % 2;
    if ((this.dirty || blink !== this.blink) && this.clock - this.drawnAt >= 1 / FPS) {
      this.blink = blink;
      this.draw();
    }
  }

  /** Pick what the screen does next: a burst of output, a pause, or a slow typed line. */
  private nextSpell() {
    const r = this.rand();
    if (this.rate > 0 && r < 0.5) {
      this.rate = 0;
      this.left = 0.3 + this.rand() * 1.8;
    } else if (r < 0.85) {
      this.rate = 250 + this.rand() * 900;
      this.left = 0.4 + this.rand() * 2.5;
    } else {
      this.rate = 9 + this.rand() * 8; // someone typing
      this.left = 1 + this.rand() * 2;
    }
  }

  private put(ch: string) {
    const last = this.lines.length - 1;
    if (ch === '\n') this.lines.push('');
    else if (this.lines[last].length >= COLS) this.lines.push(ch);
    else this.lines[last] += ch;
    if (this.lines.length > ROWS) this.lines.splice(0, this.lines.length - ROWS);
  }

  private draw() {
    const g = this.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, PX_W, PX_H);
    g.fillStyle = '#fff';
    this.lines.forEach((line, r) => g.fillText(line, MARGIN, MARGIN + r * this.cellH));
    if (!this.blink) {
      const r = this.lines.length - 1;
      g.fillRect(MARGIN + this.lines[r].length * this.cellW, MARGIN + r * this.cellH + 2, this.cellW - 2, this.cellH - 4);
    }
    this.tex.needsUpdate = true;
    this.drawnAt = this.clock;
    this.dirty = false;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** The tube: the canvas as a mask lit in the phosphor's colour, a soft halo round the glyphs, scanlines (faded out
 *  where they would shimmer, far off), a slight barrel, dark rounded corners, a faint flicker; the glass's own dim green. */
function crtMaterial(tex: THREE.Texture, tint: number): THREE.MeshBasicNodeMaterial {
  const p = uv().sub(0.5);
  const q = p.mul(float(1).add(p.dot(p).mul(0.18)));
  const st = q.add(0.5);
  const inside = float(1).sub(smoothstep(0.44, 0.5, abs(q.x))).mul(float(1).sub(smoothstep(0.42, 0.5, abs(q.y))));
  const px = vec2(1.6 / PX_W, 1.6 / PX_H);
  const tap = (dx: number, dy: number) => texture(tex, st.add(px.mul(vec2(dx, dy)))).r;
  const glyph = tap(0, 0);
  const halo = tap(1, 1).add(tap(-1, -1)).add(tap(1, -1)).add(tap(-1, 1)).mul(0.25);
  const lines = st.y.mul(PX_H / 2);
  const fade = float(1).sub(smoothstep(0.35, 0.7, fwidth(lines)));
  const scan = float(1).sub(sin(lines.mul(Math.PI)).mul(sin(lines.mul(Math.PI))).mul(0.35).mul(fade));
  const flicker = float(0.96).add(sin(time.mul(53)).mul(0.02)).add(sin(time.mul(7.3)).mul(0.02));
  const light = max(glyph, halo.mul(0.45)).mul(scan).mul(flicker).mul(inside).mul(2.2);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(tint).mul(light).add(color(0x0b1a12).mul(inside.mul(0.6).add(0.15)));
  m.name = 'codeScreen';
  return m;
}

// ------------------------------------------------------------------------------------------------ the terminal

let model: Promise<THREE.Object3D | null> | null = null;
const converted = new Map<LightsNode | null, Map<string, THREE.Material>>();

function terminalModel(): Promise<THREE.Object3D | null> {
  return (model ??= new GLTFLoader().loadAsync('./models/terminal.glb').then(
    (gltf) => gltf.scene.getObjectByName('terminal') ?? null,
    (err) => (console.warn('netTerminal: failed to load terminal.glb', err), null),
  ));
}

export type NetTerminalOptions = { seed?: number; tint?: Tint; /** indoor lights (src/world/glbMaterial.ts); none: the scene's */ lit?: LightsNode | null };

/** An old terminal streaming code on its screen; see the top of this file. */
export class NetTerminal {
  readonly object = new THREE.Group();
  readonly screen: CodeScreen;

  constructor(o: NetTerminalOptions = {}) {
    this.object.name = 'netTerminal';
    const S = TERMINAL_SCREEN;
    this.screen = new CodeScreen({ w: S.w, h: S.h, seed: o.seed, tint: o.tint });
    this.screen.mesh.position.set(0, S.y, S.z);
    this.object.add(this.screen.mesh);
    const lit = o.lit ?? null;
    terminalModel().then((src) => {
      if (!src) return;
      const body = src.clone();
      let mats = converted.get(lit);
      if (!mats) converted.set(lit, (mats = new Map()));
      body.traverse((c) => {
        if (!(c as THREE.Mesh).isMesh) return;
        const mesh = c as THREE.Mesh;
        const one = (m: THREE.Material) => {
          let n = mats.get(m.name);
          if (!n) mats.set(m.name, (n = glbMaterial(m, lit)));
          return n;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
        mesh.castShadow = mesh.receiveShadow = true;
      });
      this.object.add(body);
    });
  }

  update(dt: number, eye: THREE.Vector3) {
    this.screen.update(dt, eye);
  }

  dispose() {
    this.object.removeFromParent();
    this.screen.dispose();
  }
}
