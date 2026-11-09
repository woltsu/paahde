// The net terminal (docs/terminals.md; tools/blender/terminal.py, public/models/terminal_console.glb, terminal.glb): an
// old terminal, CRT and keyboard, in two kinds (TERMINALS), whose screen shows a grid of text (src/world/terminalText.ts
// TerminalText) written by a program: by default the game's own code streaming past (src/world/codeStream.ts), or any
// `program` given it. Reusable two ways:
//   new NetTerminal({ kind, program, seed, tint, face, lit }) — the whole terminal: add `.object` where it stands (origin
//     on the floor at the footprint's centre, screen facing +Z), call `.update(dt, eye)` every frame; `.program` swaps
//     what writes its screen, `.text` is the screen's text;
//   new TerminalScreen({ w, h, program, cols, rows, ... }) — only the glass (a bulged plane facing +Z), for any other
//     model's screen.
// Client-only dressing: it never touches the sim. Programs run and the screen uploads only within RANGE of the eye.
// Each terminal's update offers it as the source of the terminals' quiet loop (src/world/terminalSound.ts).
import * as THREE from 'three/webgpu';
import type { LightsNode } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { abs, color, exp, float, fwidth, max, sin, smoothstep, texture, time, uv, vec2 } from 'three/tsl';
import { glowsHot } from '../post.ts';
import { glbMaterial } from './glbMaterial.ts';
import { codeStream } from './codeStream.ts';
import { dropTerminalSound, offerTerminalSound } from './terminalSound.ts';
import { asProgram, type ProgramLike, type TerminalProgram, TerminalText } from './terminalText.ts';

/** The kinds of terminal (tools/blender/terminal.py): the model, its object, the screen's opening (centre height, the
 *  tube's face, size: the script's C_SCREEN_* / SCREEN_*), the text grid on it, and the footprint (m, x by z). */
export const TERMINALS = {
  /** A 1970s video terminal in shiny dark metal, keyboard deck and monitor one body, a black hood round a big screen. */
  console: { url: './models/terminal_console.glb', node: 'terminal_console', screen: { y: 0.37, z: 0.07, w: 0.42, h: 0.315 }, cols: 80, rows: 24, scale: 1, footprint: [0.63, 0.94] },
  /** A small beige deep CRT on a plinth with a cream keyboard. */
  compact: { url: './models/terminal.glb', node: 'terminal', screen: { y: 0.27, z: 0.073, w: 0.3, h: 0.225 }, cols: 56, rows: 21, scale: 2, footprint: [0.46, 0.68] },
} as const;
export type TerminalKind = keyof typeof TERMINALS;

/** Phosphors (white the default). */
export const TINTS = { white: 0xf0f3f8, green: 0x6dff9c, amber: 0xffb347 } as const;
export type Tint = keyof typeof TINTS;

/** The screens' faces (credits: public/credits.txt), each loaded once; until it is in (or if it fails), a system
 *  monospace fitted to the cell. Both are pixel fonts, drawn at a whole number of canvas px to each of their pixels (a
 *  screen's `scale`), a glyph to a cell and centred in it (vt100's face is proportional; a terminal's grid is not), on
 *  whole pixels: nothing smears.
 *  - vt220 (the default): "Glass TTY VT220" by Viacheslav Slavinsky (public/fonts/glasstty/, public domain): 20 of its
 *    pixels to the em, every glyph half an em, its dots rounded like a glowing tube's;
 *  - vt100: "VT100 Regular" by Karl Stange (public/fonts/vt100/, CC BY 3.0): 16 to the em, its widest glyph half an em.
 *  `px` its size, `cell` a cell's width (its widest glyph), `above`/`below` its ink round the baseline: in its own
 *  pixels (canvas px at scale 1). A cell's height follows from the screen's shape. */
export const FACES = {
  vt220: { url: './fonts/glasstty/glass-tty-vt220.woff2', family: 'NetTerminalVT220', px: 20, cell: 10, above: 14, below: 3 },
  vt100: { url: './fonts/vt100/vt100-regular.otf.woff2', family: 'NetTerminalVT100', px: 16, cell: 8, above: 9, below: 3 },
} as const;
export type Face = keyof typeof FACES;
const FALLBACK = 'ui-monospace, Menlo, Consolas, monospace';
const fontLoads = new Map<Face, Promise<boolean>>();

function loadFont(face: Face): Promise<boolean> {
  let p = fontLoads.get(face);
  if (!p) {
    const { family, url } = FACES[face];
    p = typeof FontFace === 'undefined'
      ? Promise.resolve(false)
      : new FontFace(family, `url(${url})`).load().then(
          (f) => (document.fonts.add(f), true),
          (err) => (console.warn(`netTerminal: failed to load the ${face} font`, err), false),
        );
    fontLoads.set(face, p);
  }
  return p;
}

/** Beyond this (m) a screen holds its last frame. */
const RANGE = 16;
/** How much of the phosphor's light goes to the bloom (src/post.ts glowsHot): a soft halo round the text and the glass. */
const SCREEN_BLOOM = 0.35;
const MARGIN = 16;
/** Texture uploads per second, at most. */
const FPS = 15;

// ------------------------------------------------------------------------------------------------ the screen

export type TerminalScreenOptions = {
  w: number;
  h: number;
  /** what writes the text (default: the game's code streaming past, src/world/codeStream.ts, chosen by `seed`) */
  program?: ProgramLike;
  seed?: number;
  tint?: Tint;
  /** the typeface (default vt220) */
  face?: Face;
  /** forward bulge at the centre (m) */
  bulge?: number;
  /** the text grid (default 56 x 21): fewer is bigger and easier to read */
  cols?: number;
  rows?: number;
  /** canvas px to each of the face's pixels (default 2): crisper close up, a bigger canvas to upload */
  scale?: number;
};

/** A CRT's glass showing a `TerminalText` (src/world/terminalText.ts) that its program writes, each frame it is awake
 *  (within RANGE of the eye). Text in a canvas, phosphor, scanlines, barrel and glow in TSL; it redraws (at most FPS a
 *  second) only when the text changed or the cursor blinked. */
export class TerminalScreen {
  readonly mesh: THREE.Mesh;
  /** What it shows: write to it from a program (`program`), or from outside at any time. */
  readonly text: TerminalText;
  private prog: TerminalProgram;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly face: (typeof FACES)[Face];
  private readonly scale: number;
  private readonly cellW: number;
  private readonly cellH: number;
  /** Laying out in the face (its pixel grid), not yet: a system monospace fitted to the cell. */
  private pixelFont = false;
  private clock = 0;
  private drawnAt = -1;
  /** The text's version as last drawn (-1: redraw), and the cursor's blink phase then (0: shown). */
  private drawn = -1;
  private blink = 0;
  private readonly here = new THREE.Vector3();

  constructor(o: TerminalScreenOptions) {
    this.text = new TerminalText(o.cols ?? 56, o.rows ?? 21);
    this.prog = asProgram(o.program ?? codeStream(o.seed ?? 0));
    this.prog.start?.(this.text);
    const face = o.face ?? 'vt220';
    this.face = FACES[face];
    this.scale = Math.max(1, Math.round(o.scale ?? 2));
    this.cellW = this.face.cell * this.scale;
    // Cells as tall as the screen's shape asks (a cell's on-glass aspect kept), the canvas the grid plus its margin.
    const { cols, rows } = this.text;
    this.cellH = Math.round((this.cellW * (o.h / rows)) / (o.w / cols));
    this.canvas.width = cols * this.cellW + 2 * MARGIN;
    this.canvas.height = rows * this.cellH + 2 * MARGIN;
    this.g = this.canvas.getContext('2d')!;
    this.g.textBaseline = 'alphabetic';
    this.g.textAlign = 'left';
    this.fitFont(FALLBACK);
    void loadFont(face).then((ok) => {
      if (!ok) return;
      this.g.font = `${this.face.px * this.scale}px ${this.face.family}, ${FALLBACK}`;
      this.pixelFont = true;
      this.drawn = -1;
    });
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace; // a mask: the phosphor colours it
    // Mipmapped: a fine grid seen from across the room doesn't sparkle.
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
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
    this.mesh = new THREE.Mesh(geo, crtMaterial(this.tex, TINTS[o.tint ?? 'white'], this.canvas.width, this.canvas.height));
    this.mesh.name = 'terminalScreen';
  }

  /** What writes the text. Setting it clears the screen (cursor home and shown) and starts the new one. */
  get program(): TerminalProgram {
    return this.prog;
  }

  set program(p: ProgramLike) {
    this.prog = asProgram(p);
    this.text.clear();
    this.text.showCursor(true);
    this.prog.start?.(this.text);
  }

  /** The fallback: the largest size of `family` whose widest glyphs fit a cell (and the face's height over the baseline). */
  private fitFont(family: string) {
    const g = this.g;
    g.font = `100px ${family}`;
    const wide = Math.max(1, g.measureText('M').width, g.measureText('W').width, g.measureText('@').width);
    const size = Math.floor((100 * this.cellW) / wide);
    g.font = `${Math.min(size, Math.floor(this.face.above * this.scale * 1.25))}px ${family}`;
  }

  /** Every frame; `eye` the camera's world position (beyond RANGE of it the program sleeps and the screen holds). */
  update(dt: number, eye: THREE.Vector3) {
    if (this.mesh.getWorldPosition(this.here).distanceTo(eye) > RANGE) return;
    this.clock += dt;
    this.prog.update(this.text, dt);
    const c = this.text.cursor;
    const blink = c.visible && c.blink ? Math.floor(this.clock * 2.5) % 2 : 0;
    if ((this.text.version !== this.drawn || blink !== this.blink) && this.clock - this.drawnAt >= 1 / FPS) {
      this.blink = blink;
      this.draw();
    }
  }

  private readonly advances = new Map<string, number>();

  /** A glyph's width in the current face (measured once each). */
  private advance(ch: string): number {
    const key = this.pixelFont ? ch : `~${ch}`;
    let w = this.advances.get(key);
    if (w === undefined) this.advances.set(key, (w = this.g.measureText(ch).width));
    return w;
  }

  private draw() {
    const g = this.g, t = this.text;
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.fillStyle = '#fff';
    // A glyph to a cell, centred in it (a proportional face's too), on whole pixels of its own grid.
    const k = this.scale;
    const above = this.face.above * k, below = this.face.below * k;
    const top = MARGIN + (this.cellH - (above + below)) / 2;
    const base = (r: number) => Math.round((top + r * this.cellH + above) / k) * k;
    for (let r = 0; r < t.rows; r++) {
      const y = base(r);
      for (let i = 0; i < t.cols; i++) {
        const ch = t.char(i, r);
        if (ch === ' ') continue;
        const x = MARGIN + i * this.cellW + (this.cellW - this.advance(ch)) / 2;
        g.fillText(ch, this.pixelFont ? Math.round(x / k) * k : x, y);
      }
    }
    const c = t.cursor;
    if (c.visible && !this.blink) {
      const col = Math.min(c.col, t.cols - 1); // a full line holds it in the last column
      g.fillRect(MARGIN + col * this.cellW + k, base(c.row) - above, this.cellW - 2 * k, above + k);
    }
    this.tex.needsUpdate = true;
    this.drawnAt = this.clock;
    this.drawn = t.version;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** The tube: the canvas as a mask lit in the phosphor's colour, a soft halo round the glyphs, scanlines (faded out
 *  where they would shimmer, far off), a slight barrel, dark rounded corners, a faint flicker; the glass's own dim glow
 *  in the phosphor's colour. All that is the glass's emission; the glass itself is black and glossy (a dielectric, the
 *  sun's highlight and the sky's reflection on its bulge, from the scene or the `lightsNode` given it), with a soft
 *  glare up in its top left, as of a window across the room, faint enough to read through. */
function crtMaterial(tex: THREE.Texture, tint: number, pxW: number, pxH: number): THREE.MeshStandardNodeMaterial {
  const p = uv().sub(0.5);
  const q = p.mul(float(1).add(p.dot(p).mul(0.18)));
  const st = q.add(0.5);
  const inside = float(1).sub(smoothstep(0.44, 0.5, abs(q.x))).mul(float(1).sub(smoothstep(0.42, 0.5, abs(q.y))));
  const px = vec2(1.6 / pxW, 1.6 / pxH);
  const tap = (dx: number, dy: number) => texture(tex, st.add(px.mul(vec2(dx, dy)))).r;
  const glyph = tap(0, 0);
  const halo = tap(1, 1).add(tap(-1, -1)).add(tap(1, -1)).add(tap(-1, 1)).mul(0.25);
  const lines = st.y.mul(pxH / 2);
  const fade = float(1).sub(smoothstep(0.35, 0.7, fwidth(lines)));
  const scan = float(1).sub(sin(lines.mul(Math.PI)).mul(sin(lines.mul(Math.PI))).mul(0.35).mul(fade));
  const flicker = float(0.96).add(sin(time.mul(53)).mul(0.02)).add(sin(time.mul(7.3)).mul(0.02));
  const light = max(glyph, halo.mul(0.45)).mul(scan).mul(flicker).mul(inside).mul(2.2);
  const glow = color(tint).mul(light.add(inside.mul(0.6).add(0.15).mul(0.045)));
  // The glare: a soft ellipse leaning a little, high on the left, and the glass a touch lighter toward its top.
  const gp = p.sub(vec2(-0.2, 0.25));
  const ga = 0.45;
  const gx = gp.x.mul(Math.cos(ga)).add(gp.y.mul(Math.sin(ga)));
  const gy = gp.y.mul(Math.cos(ga)).sub(gp.x.mul(Math.sin(ga)));
  const glare = exp(gx.mul(gx).div(0.045).add(gy.mul(gy).div(0.008)).negate()).mul(0.045).add(smoothstep(0.0, 0.5, p.y).mul(0.01));
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.08, metalness: 0 });
  m.emissiveNode = glow.add(glare);
  glowsHot(m, glow.mul(SCREEN_BLOOM)); // the phosphor blooms, whatever the threshold
  m.name = 'codeScreen';
  return m;
}

// ------------------------------------------------------------------------------------------------ the terminal

const models = new Map<TerminalKind, Promise<THREE.Object3D | null>>();
const converted = new Map<LightsNode | null, Map<string, THREE.Material>>();

function terminalModel(kind: TerminalKind): Promise<THREE.Object3D | null> {
  let p = models.get(kind);
  if (!p) {
    const { url, node } = TERMINALS[kind];
    p = new GLTFLoader().loadAsync(url).then(
      (gltf) => gltf.scene.getObjectByName(node) ?? null,
      (err) => (console.warn(`netTerminal: failed to load ${url}`, err), null),
    );
    models.set(kind, p);
  }
  return p;
}

export type NetTerminalOptions = {
  /** which terminal (default the console) */
  kind?: TerminalKind;
  seed?: number;
  tint?: Tint;
  /** what writes the screen's text (default: the game's code streaming past, chosen by `seed`); docs/terminals.md */
  program?: ProgramLike;
  /** the screen's typeface (default vt220) */
  face?: Face;
  /** indoor lights (src/world/glbMaterial.ts), on the body and the glass; none: the scene's */
  lit?: LightsNode | null;
};

/** An old terminal streaming code on its screen; see the top of this file. */
export class NetTerminal {
  readonly object = new THREE.Group();
  readonly screen: TerminalScreen;

  constructor(o: NetTerminalOptions = {}) {
    this.object.name = 'netTerminal';
    const kind = o.kind ?? 'console';
    const { screen: S, cols, rows, scale } = TERMINALS[kind];
    this.screen = new TerminalScreen({ w: S.w, h: S.h, program: o.program, seed: o.seed, tint: o.tint, face: o.face, cols, rows, scale });
    this.screen.mesh.position.set(0, S.y, S.z);
    this.object.add(this.screen.mesh);
    const lit = o.lit ?? null;
    if (lit) (this.screen.mesh.material as THREE.MeshStandardNodeMaterial).lightsNode = lit;
    terminalModel(kind).then((src) => {
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

  /** Its screen's text (src/world/terminalText.ts): write to it from anywhere. */
  get text(): TerminalText {
    return this.screen.text;
  }

  /** What writes its screen's text; setting one clears the screen and starts it (docs/terminals.md). */
  get program(): TerminalProgram {
    return this.screen.program;
  }

  set program(p: ProgramLike) {
    this.screen.program = p;
  }

  private readonly here = new THREE.Vector3();

  /** Every frame; `eye` the camera's (the audio listener's) world position. */
  update(dt: number, eye: THREE.Vector3) {
    this.screen.update(dt, eye);
    offerTerminalSound(this, this.screen.mesh.getWorldPosition(this.here), eye);
  }

  dispose() {
    dropTerminalSound(this);
    this.object.removeFromParent();
    this.screen.dispose();
  }
}
