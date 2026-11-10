// The ring hall's net terminals (src/levels/beginning/index.ts, docs/terminals.md): the station's files on its own
// people. Four programs, one a desk: a subject's file (`subjectFile`), a genome streaming past a turning helix
// (`sequencer`), a batch of faces being judged (`census`) and two faces compared (`crossMatch`). The headshots are drawn
// here, low-res and greyscale (`face`, a pure function of a seed: tested under Node), painted into a small canvas per
// picture and shown blocky on the tube. Every word comes from TEXT.tutorial.dossier; the ids, bases and loci are data.
// Client-only dressing: seeded, so a desk shows the same people each visit, but nobody else needs to agree.
import { mulberry32 } from '../../shared/noise.ts';
import { TEXT } from '../../shared/text.ts';
import { bar, fit, type TerminalImageSource, type TerminalProgram, type TerminalText } from './terminalText.ts';

const D = TEXT.tutorial.dossier;

// ------------------------------------------------------------------------------------------------------------ faces

export type Variant = 'human' | 'dwarf' | 'gnome';
export const FACE_W = 24, FACE_H = 30;
/** A headshot: `w` x `h` brightnesses (0 black .. 1 white), row by row from the top, in a few steps (a cheap camera). */
export type Face = { w: number; h: number; px: Float32Array };

const LEVELS = 7;
/** The phosphor glows mid-greys up a lot: pictures go on the tube darker in the middles (a gamma). */
const CONTRAST = 1.8;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A passport-style headshot, lit from the upper left against a plain backdrop. Dwarves come broad and bearded, gnomes
 *  small-headed with big noses and long ears; hair, glasses, skin and clothes vary by `seed`. */
export function face(seed: number, variant: Variant): Face {
  const r = mulberry32(seed * 2654435761);
  const rnd = (a: number, b: number) => a + (b - a) * r();
  const W = FACE_W, H = FACE_H, px = new Float32Array(W * H);
  const dwarf = variant === 'dwarf', gnome = variant === 'gnome';
  const cx = W / 2 + rnd(-0.8, 0.8);
  const rx = gnome ? rnd(4.8, 5.6) : dwarf ? rnd(7, 8) : rnd(5.6, 6.8);
  const ry = gnome ? rnd(6.8, 7.6) : dwarf ? rnd(7.2, 8.2) : rnd(8, 9.2);
  const cy = (gnome ? 14.5 : 13.5) + rnd(-0.5, 0.5);
  const skin = rnd(0.55, 0.92);
  const hair = r() < 0.25 ? rnd(0.7, 0.95) : rnd(0.04, 0.28);
  const style = Math.floor(r() * 4); // 0 bald, 1 short, 2 long, 3 piled up
  const hairline = Math.min(cy - ry * rnd(0.3, 0.58), cy - ry * 0.05 - 2.6);
  const beard = dwarf || r() < 0.12;
  const glasses = r() < 0.18;
  const shirt = rnd(0.08, 0.35), collar = r() < 0.5;
  const bgTop = rnd(0.2, 0.34), bgBot = bgTop * rnd(0.65, 0.85);
  const eyeY = cy - ry * 0.05 + rnd(-0.4, 0.4), eyeDx = rx * rnd(0.36, 0.46);
  const mouthY = cy + ry * rnd(0.48, 0.58), mouthW = rnd(1.4, 2.8) * (dwarf ? 1.2 : 1);
  const noseLen = gnome ? rnd(3.2, 4.5) : rnd(1.6, 2.6), noseW = gnome ? rnd(1.2, 1.8) : rnd(0.6, 1);
  const earW = gnome ? rnd(1.4, 1.9) : rnd(0.9, 1.3), earH = gnome ? rnd(3.5, 4.8) : rnd(1.5, 2);
  const shoulder = rx * 2.1 + (dwarf ? 2.5 : 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x + 0.5, Y = y + 0.5;
      let v = bgTop + ((bgBot - bgTop) * y) / H;
      // Shoulders and clothes, the neck in an open collar.
      const sx = (X - cx) / shoulder, sy = (Y - (H + 3)) / 8.5;
      if (sx * sx + sy * sy < 1) {
        v = shirt * (1 - 0.35 * sx);
        if (collar && Math.abs(X - cx) < (Y - (cy + ry - 0.5)) * 0.45) v = skin * 0.55;
      }
      if (Math.abs(X - cx) < rx * 0.5 && Y > cy && Y < cy + ry + 2.5) v = skin * (0.42 + 0.12 * Math.sign(cx - X));
      // Ears: round, or a gnome's long and pointed, out and up from the side of the head.
      for (const s of [-1, 1]) {
        if (gnome) {
          const u = (X - cx) * s - rx + 0.8, w = Y - (eyeY + 0.5) + u * 0.7;
          if (u > 0 && u < earH && Math.abs(w) < earW * (1 - u / earH)) v = skin * (s < 0 ? 0.8 : 0.55);
        } else {
          const dx = (X - (cx + s * (rx + earW * 0.3))) / earW, dy = (Y - (eyeY + 1)) / earH;
          if (dx * dx + dy * dy < 1) v = skin * (s < 0 ? 0.8 : 0.55);
        }
      }
      // The head, shaded as an ellipsoid.
      const nx = (X - cx) / rx, ny = (Y - cy) / ry, d = nx * nx + ny * ny;
      if (d < 1) {
        const nz = Math.sqrt(1 - d);
        v = skin * (0.4 + 0.7 * Math.max(0, -0.55 * nx - 0.45 * ny + 0.7 * nz));
        for (const s of [-1, 1]) {
          const ex = cx + s * eyeDx;
          if (Math.abs(X - ex) < 1.1 && Math.abs(Y - eyeY) < 0.6) v = 0.04;
          else if (Math.abs(X - ex) < 1.5 && Math.abs(Y - (eyeY - 1.7)) < 0.5) v = Math.min(v, hair * 0.8 + 0.05);
          if (glasses && Math.abs(Math.hypot(X - ex, (Y - eyeY) * 1.2) - 1.9) < 0.42) v = 0.1;
        }
        const tipY = eyeY + noseLen + 0.8;
        if (Y > eyeY + 0.6 && Y < tipY && X > cx && X < cx + noseW + 0.4) v *= 0.7; // its shadow side
        if (Math.abs(Y - tipY) < 0.7 && Math.abs(X - cx) < noseW + 0.3) v = Math.min(1, v * (X < cx ? 1.18 : 0.75));
        if (beard) {
          const by = (Y - cy) / (ry + (dwarf ? 1 : 0.3));
          if ((Y > mouthY - 1.6 || (Math.abs(nx) > 0.78 && Y > eyeY + 1)) && nx * nx + by * by < 1.05) v = hair * (0.85 + 0.2 * r());
        }
        if (Math.abs(Y - mouthY) < 0.5 && Math.abs(X - cx) < mouthW) v = beard ? 0.03 : v * 0.45;
      } else if (beard && dwarf) {
        // A dwarf's beard hangs past the chin over the chest.
        const bx = (X - cx) / (rx * 0.85), by = (Y - (cy + ry * 0.6)) / (ry * 0.75);
        if (Y > cy && bx * bx + by * by < 1) v = hair * (0.85 + 0.2 * r());
      }
      // Hair over the top (and down the sides when long).
      if (style > 0) {
        const tall = style === 3 ? 2.6 : 1.1;
        const hx = (X - cx) / (rx + 1.1), hy = (Y - cy) / (Y < cy ? ry + tall : ry + 1.1);
        const inHair = hx * hx + hy * hy < 1 && (Y < hairline || (Math.abs(nx) > 0.82 && Y < eyeY - 0.5));
        const long = style === 2 && Math.abs(X - cx) > rx * 0.8 && Math.abs(X - cx) < rx + 1.8 && Y > cy - 2 && Y < cy + ry + 3;
        if (inHair || long) v = hair * (0.85 + 0.25 * r());
      }
      v += (r() - 0.5) * 0.035;
      px[y * W + x] = Math.round(clamp01(v) * LEVELS) / LEVELS;
    }
  }
  return { w: W, h: H, px };
}

/** A canvas showing a face, repainted as it scans in; under Node (tests) a stand-in that paints nothing. */
class Picture {
  readonly src: TerminalImageSource;
  private readonly g: CanvasRenderingContext2D | null = null;
  private readonly img: ImageData | null = null;

  constructor(w = FACE_W, h = FACE_H) {
    if (typeof document === 'undefined') {
      this.src = { width: w, height: h } as unknown as TerminalImageSource;
      return;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this.src = c;
    this.g = c.getContext('2d');
    this.img = this.g?.createImageData(w, h) ?? null;
  }

  /** `f` down to row `shown` (black below), a bright scan line at `scan` (a row, or -1 for none). */
  paint(f: Face, shown = f.h, scan = -1) {
    if (!this.g || !this.img) return;
    const d = this.img.data;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const v = y === scan ? 1 : y < shown ? f.px[y * f.w + x] : 0;
        const i = (y * f.w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(v ** CONTRAST * 255);
        d[i + 3] = 255;
      }
    }
    this.g.putImageData(this.img, 0, 0);
  }
}

// ---------------------------------------------------------------------------------------------------------- records

const BASES = 'ACGT';
const PAIR: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** `n` bases of a genome from position `at`: the same for the same seed and position. */
export function bases(seed: number, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += BASES[hash(seed, at + i) & 3];
  return s;
}

/** `s` with roughly one base in `every` swapped (a relative's, an edited copy). */
function mutate(s: string, seed: number, every: number): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += hash(seed, i) % every === 0 ? BASES[(BASES.indexOf(s[i]) + 1 + (hash(i, seed) % 3)) & 3] : s[i];
  return out;
}

type Verdict = keyof typeof D.verdicts;

export type Subject = {
  seed: number;
  id: string;
  name: string;
  variant: Variant;
  home: string;
  role: string;
  compliance: number;
  utility: number;
  verdict: Verdict;
  chr: number;
  locus: string;
  face: Face;
};

/** Someone on file: who, where, what the station makes of them, and their face. */
export function subject(seed: number): Subject {
  const r = mulberry32(seed * 40503 + 7);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const variant: Variant = pick(['human', 'human', 'human', 'dwarf', 'gnome']);
  const compliance = 0.25 + r() * 0.74, utility = r() * r();
  const verdict: Verdict = utility < 0.3 && compliance < 0.7 ? 'surface' : compliance < 0.55 || utility < 0.15 ? 'review' : 'retain';
  const chr = 1 + Math.floor(r() * 22);
  return {
    seed,
    id: `${String(Math.floor(r() * 10000)).padStart(4, '0')}-${String.fromCharCode(65 + Math.floor(r() * 26))}`,
    name: pick(D.names),
    variant,
    home: D.home(1 + Math.floor(r() * 6), 1 + Math.floor(r() * 40)),
    role: pick(D.roles),
    compliance,
    utility,
    verdict,
    chr,
    locus: `${chr}${r() < 0.5 ? 'p' : 'q'}${1 + Math.floor(r() * 3)}${1 + Math.floor(r() * 9)}.${1 + Math.floor(r() * 3)}`,
    face: face(seed, variant),
  };
}

const pct = (v: number) => `${fit(String(Math.round(v * 100)), 3, 'right')}%`;

/** The title row: the review's name on the left, this screen's on the right, ruled across. */
function title(text: TerminalText, what: string) {
  text.print(0, 0, fit('', text.cols, 'left', '='));
  text.print(2, 0, ` ${D.header} `);
  text.print(text.cols - what.length - 4, 0, ` ${what} `);
}

/** Calls `frame` `hz` times a second of awake time (screens redraw at most 15 times a second anyway). */
function ticking(hz: number, frame: (text: TerminalText, t: number) => void, start?: (text: TerminalText) => void): TerminalProgram {
  let t = 0, next = 0;
  return {
    start(text) {
      text.showCursor(false);
      start?.(text);
    },
    update(text, dt) {
      t += Math.min(dt, 0.25);
      if (t < next) return;
      next = t + 1 / hz;
      frame(text, t);
    },
  };
}

// --------------------------------------------------------------------------------------------------------- programs

/** One subject's file: the face scanning in, the fields typing out one by one, the verdict, and a stretch of their
 *  genome rolling past with the flagged bases in lower case. Next subject every ten seconds. */
export function subjectFile(seed: number): TerminalProgram {
  const PER = 10, PIC = 20;
  const pic = new Picture();
  let n = -1, who = subject(seed), shownRows = -1;
  return ticking(12, (text, t) => {
    const k = Math.floor(t / PER), at = t - k * PER;
    if (k !== n) {
      n = k;
      who = subject(seed * 1000 + k);
      text.clearImages();
      text.drawImage(pic.src, 2, 2, PIC, text.imageRows(PIC, FACE_W, FACE_H), { smooth: false });
      shownRows = -1;
    }
    const rows = Math.min(FACE_H, Math.floor(at * 24));
    if (rows !== shownRows) {
      pic.paint(who.face, rows, rows < FACE_H ? rows : -1);
      shownRows = rows;
    }
    text.setLines([]);
    title(text, D.subject);
    const fields: [string, string][] = [
      [D.subject, who.id],
      [D.name, who.name],
      [D.variant, D.variants[who.variant]],
      [D.habitat, who.home],
      [D.role, who.role],
      [D.compliance, `${bar(who.compliance, 22)} ${pct(who.compliance)}`],
      [D.utility, `${bar(who.utility, 22)} ${pct(who.utility)}`],
    ];
    const typed = Math.floor((at - 1.2) / 0.3);
    fields.slice(0, Math.max(0, typed)).forEach(([label, value], i) => text.print(26, 2 + i, `${fit(label, 12)}${value}`));
    if (typed > fields.length && (at < 7 || Math.floor(t * 3) % 2 === 0)) text.print(26, 10, `${fit(D.status, 12)}${D.verdicts[who.verdict]}`);
    text.print(2, 13, `${D.genome}  ${D.chromosome(who.chr)}`);
    if (typed > fields.length) text.print(26, 13, D.deviation(who.locus));
    // The genome, a line every third of a second, flagged bases in lower case.
    const line = Math.floor(t * 3);
    for (let i = 0; i < 6; i++) {
      const at0 = (line + i) * 40;
      const groups = [0, 1, 2, 3].map((g) => {
        let s = bases(who.seed, at0 + g * 10, 10);
        if (hash(who.seed, at0 + g) % 7 === 0) {
          const j = hash(at0, g) % 10;
          s = s.slice(0, j) + s[j].toLowerCase() + s.slice(j + 1);
        }
        return s;
      });
      text.print(2, 15 + i, `${String(1000000 + at0).slice(1)}  ${groups.join(' ')}`);
    }
    text.print(2, 22, `${fit(D.analysing(k + 1, 4096), 24)}${bar(at / PER, 30)}`);
  });
}

/** A genome streaming past beside a turning double helix, the subject's face and a progress bar on the right; a new
 *  subject once it is through. */
export function sequencer(seed: number): TerminalProgram {
  const PIC = 18, RUN = 14, LINES = 21;
  const pic = new Picture();
  let n = -1, who = subject(seed);
  const stream: string[] = [];
  let made = 0;
  const lineAt = (i: number) => {
    if (hash(who.seed, i) % 9 === 0) return `  >> ${hash(i, who.seed) % 2 ? D.deviation(who.locus) : D.edited(subject(who.seed + i).locus)}`;
    const at = i * 30;
    return `${String(10000000 + at).slice(1)}  ${bases(who.seed, at, 10)} ${bases(who.seed, at + 10, 10)} ${bases(who.seed, at + 20, 10)}`;
  };
  return ticking(12, (text, t) => {
    const k = Math.floor(t / RUN), at = t - k * RUN;
    if (k !== n) {
      n = k;
      who = subject(seed * 1000 + k);
      text.clearImages();
      text.drawImage(pic.src, text.cols - PIC - 3, 2, PIC, text.imageRows(PIC, FACE_W, FACE_H), { smooth: false });
      pic.paint(who.face);
    }
    while (made < Math.floor(t * 8)) {
      stream.push(lineAt(made++));
      if (stream.length > LINES) stream.shift();
    }
    text.setLines([]);
    title(text, D.sequencing);
    // The helix: two strands round a column, the pairs between them shown on the near side.
    for (let row = 0; row < LINES; row++) {
      const ph = t * 2.2 + row * 0.55, s = Math.sin(ph), near = Math.cos(ph) > 0;
      const a = 7 + Math.round(s * 4), b = 7 - Math.round(s * 4);
      const base = bases(who.seed, made + row, 1), pair = PAIR[base];
      if (Math.abs(a - b) > 1) for (let x = Math.min(a, b) + 1; x < Math.max(a, b); x++) text.print(x, 2 + row, near ? '-' : ' ');
      text.print(a, 2 + row, near ? base : base.toLowerCase());
      text.print(b, 2 + row, near ? pair : pair.toLowerCase());
    }
    stream.forEach((l, i) => text.print(16, 2 + i, l));
    const x = text.cols - PIC - 3, w = PIC + 2;
    text.print(x, 12, fit(who.id, w));
    text.print(x, 13, fit(who.name, w));
    text.print(x, 14, fit(D.variants[who.variant], w));
    text.print(x, 16, fit(D.sequencing, w));
    text.print(x - 1, 17, bar(at / RUN, w + 1));
    text.print(x, 18, D.chromosome(1 + Math.floor((at / RUN) * 22)));
    text.print(x + w - 4, 18, pct(at / RUN));
  });
}

/** A batch of twelve faces, judged one at a time: a scan line sweeps the one being assessed, then its verdict goes under
 *  it. A new batch once all are done. */
export function census(seed: number): TerminalProgram {
  const COLS = 6, BANDS = 2, TILE = 13, PIC = 9, STEP = 1.6, ROW0 = 2, BAND = 8;
  const N = COLS * BANDS, PER = N * STEP + 2.5;
  const pics = Array.from({ length: N }, () => new Picture());
  let n = -1, batch: Subject[] = [], scanned = -1;
  return ticking(12, (text, t) => {
    const k = Math.floor(t / PER), at = t - k * PER;
    if (k !== n) {
      n = k;
      batch = Array.from({ length: N }, (_, i) => subject(seed * 100000 + k * N + i));
      text.clearImages();
      batch.forEach((s, i) => {
        pics[i].paint(s.face);
        const col = 1 + (i % COLS) * TILE + 2, row = ROW0 + Math.floor(i / COLS) * BAND;
        text.drawImage(pics[i].src, col, row, PIC, text.imageRows(PIC, FACE_W, FACE_H), { smooth: false });
      });
      scanned = -1;
    }
    const cur = Math.min(N, Math.floor(at / STEP));
    if (scanned >= 0 && scanned < N && scanned !== cur) pics[scanned].paint(batch[scanned].face); // the sweep off it
    scanned = cur;
    if (cur < N) pics[cur].paint(batch[cur].face, FACE_H, Math.floor(((at % STEP) / STEP) * FACE_H * 2) % FACE_H);
    text.setLines([]);
    title(text, D.census);
    batch.forEach((s, i) => {
      const col = 1 + (i % COLS) * TILE, row = ROW0 + Math.floor(i / COLS) * BAND + 5;
      text.print(col, row, i === cur ? `[${fit(s.id, TILE - 3, 'center')}]` : ` ${fit(s.id, TILE - 3, 'center')}`);
      if (i < cur) text.print(col + 1, row + 1, fit(D.marks[s.verdict], TILE - 3, 'center'));
    });
    const now = batch[Math.min(cur, N - 1)];
    const done = batch.slice(0, cur);
    if (cur < N) text.print(2, 19, `${fit(D.assessing, 12)}${fit(now.id, 9)}${fit(now.name, 18)}${D.variants[now.variant]}`);
    text.print(2, 20, `${fit('', 12)}${fit(D.compliance, 12)}${bar(cur < N ? Math.min(1, ((at % STEP) / STEP) * 1.4) * now.compliance : 0, 24)}`);
    text.print(2, 22, `${fit(D.batch(4100 + k), 16)}${fit(D.assessed(cur, N), 18)}${D.verdicts.surface}  ${done.filter((s) => s.verdict === 'surface').length}`);
  });
}

/** Two faces compared: one on file, the other flicking through the records until one locks; their genomes aligned
 *  (`|` alike, `:` not), how alike, and what they are to each other. The last few results logged below. */
export function crossMatch(seed: number): TerminalProgram {
  const PIC = 18, SEARCH = 3, HOLD = 5, PER = SEARCH + HOLD;
  const left = new Picture(), right = new Picture();
  const log: string[] = [];
  let n = -1, a = subject(seed), b = a, flick = -1, kin: keyof typeof D.kin = 'none', like = 0;
  return ticking(12, (text, t) => {
    const k = Math.floor(t / PER), at = t - k * PER, locked = at >= SEARCH;
    if (k !== n) {
      if (n >= 0) log.unshift(`${fit(a.id, 9)}${fit(b.id, 9)}${fit(D.kin[kin], 14)}${pct(like)}`), log.splice(5);
      n = k;
      const r = mulberry32(seed * 7717 + k);
      a = subject(seed * 1000 + k);
      const roll = r();
      kin = roll < 0.5 ? 'none' : roll < 0.72 ? 'sibling' : roll < 0.9 ? 'parent' : 'duplicate';
      like = kin === 'duplicate' ? 0.99 + r() * 0.01 : kin === 'none' ? 0.12 + r() * 0.2 : 0.45 + r() * 0.15;
      // A duplicate has the same face; kin look alike, so they come from a nearby face seed of the same make.
      const bs = subject(seed * 1000 + k + 500);
      b = kin === 'duplicate' ? { ...a, id: bs.id, name: bs.name } : kin === 'none' ? bs : { ...bs, variant: a.variant, face: face(a.seed + 1, a.variant) };
      text.clearImages();
      const h = text.imageRows(PIC, FACE_W, FACE_H);
      text.drawImage(left.src, 4, 2, PIC, h, { smooth: false });
      text.drawImage(right.src, text.cols - PIC - 4, 2, PIC, h, { smooth: false });
      left.paint(a.face);
      flick = -1;
    }
    const f = locked ? -2 : Math.floor(at * 9);
    if (f !== flick) {
      flick = f;
      right.paint(locked ? b.face : face(seed * 31 + k * 97 + f, (['human', 'dwarf', 'gnome'] as const)[f % 3]));
    }
    text.setLines([]);
    title(text, D.crossMatch);
    const rx = text.cols - PIC - 4;
    text.print(4, 12, `${fit(a.id, 9)}${D.variants[a.variant]}`);
    text.print(4, 13, a.name);
    text.print(rx, 12, locked ? `${fit(b.id, 9)}${D.variants[b.variant]}` : bases(f, 0, 6));
    text.print(rx, 13, locked ? b.name : D.searching);
    // Three stretches of the two genomes, aligned.
    const W = 28, mx = 25;
    for (let i = 0; i < 3; i++) {
      const sa = bases(a.seed, i * 997, W);
      const sb = locked && kin === 'none' ? bases(b.seed, i * 997, W) : locked ? mutate(sa, b.seed + i, Math.max(2, Math.round(1 / Math.max(0.01, 1 - like)))) : bases(f * 3 + i, 0, W);
      const marks = [...sa].map((c, j) => (c === sb[j] ? '|' : ':')).join('');
      const y = 3 + i * 3;
      text.print(mx, y, `A ${sa}`);
      text.print(mx, y + 1, `  ${locked || Math.floor(t * 9) % 2 ? marks : ''}`);
      text.print(mx, y + 2, `B ${sb}`);
    }
    if (locked) {
      text.print(mx, 12, `${fit(D.match, 8)}${bar(Math.min(1, (at - SEARCH) * 1.5) * like, 16)} ${pct(Math.min(1, (at - SEARCH) * 1.5) * like)}`);
      if (at > SEARCH + 0.8) text.print(mx + 8, 13, D.kin[kin]);
    }
    text.print(4, 15, fit('', text.cols - 8, 'left', '-'));
    log.forEach((l, i) => text.print(4, 16 + i, l));
  });
}

/** The ring hall's desks' programs, in desk order. */
export const DOSSIER_PROGRAMS = [subjectFile, sequencer, census, crossMatch];
