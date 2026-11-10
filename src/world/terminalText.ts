// What a terminal's screen shows (docs/terminals.md): a grid of characters with a cursor (`TerminalText`), written by a
// program (`TerminalProgram`) each frame the screen is awake. src/world/netTerminal.ts draws the grid on the CRT; the
// program decides what is on it: the default streams the game's own code (src/world/codeStream.ts), any other is a
// plain object or function handed to the terminal (`program`). No DOM, no three: tested by tools/terminal-text.test.mjs.

/** Writes to a screen's text each frame it is awake (within a few metres of the eye). */
export interface TerminalProgram {
  /** Once, when it is put on a screen (the text cleared, the cursor home and shown). */
  start?(text: TerminalText): void;
  /** Every frame the screen is awake: `dt` seconds since the last. */
  update(text: TerminalText, dt: number): void;
}

/** A program, or just its update. */
export type ProgramLike = TerminalProgram | ((text: TerminalText, dt: number) => void);

export function asProgram(p: ProgramLike): TerminalProgram {
  return typeof p === 'function' ? { update: p } : p;
}

/** What an image on a screen is drawn from: a URL (relative, like './icons/items/well.png'; the screen loads and caches
 *  it) or anything a canvas can draw (an image, a canvas, a bitmap; a program that redraws its own canvas calls
 *  `touch()`). */
export type TerminalImageSource = string | CanvasImageSource;

/** An image on a screen, in cells: its top-left corner at (`col`, `row`), `w` by `h` cells (fractions allowed). */
export type TerminalImage = {
  readonly id: number;
  readonly src: TerminalImageSource;
  col: number;
  row: number;
  w: number;
  h: number;
  /** Smoothed when scaled (photos, renders) or kept blocky (pixel art). */
  smooth: boolean;
};

/** Control characters (but newline and carriage return) drawn as nothing: a space. */
const CONTROL = /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/;

/** A terminal's screen as text: `cols` x `rows` cells, each one character (a space when empty), and a cursor. Two ways to
 *  write, mixable:
 *  - like a teletype: `write` at the cursor, wrapping at the right edge, '\n' to the next line, '\r' to its start,
 *    scrolling up off the bottom (a log, a shell, streamed output);
 *  - like a screen: `print` at a cell (clipped, no wrap or scroll, the cursor stays), `setLine`, `setLines` for a whole
 *    frame, `clear` (a status board, a menu, anything redrawn).
 *  Images (`drawImage`) sit under the text, placed in cells, shown in the phosphor's colour by their brightness (a
 *  monochrome tube); they stay until removed or cleared, and scroll up with the text.
 *  `version` changes with every change, so the screen redraws only when there is something new. */
export class TerminalText {
  readonly cols: number;
  readonly rows: number;
  /** Where the next `write` goes; `col` may equal `cols` after the last column is written (the wrap waits for the next
   *  character, as on a real terminal); it is drawn in the last column then. */
  readonly cursor = { col: 0, row: 0, visible: true, blink: true };
  /** Bumped by every change (the cursor's too). */
  version = 0;
  /** A cell's height over its width on the glass (about 2-2.5 on the terminals): what `imageRows` sizes images by. */
  readonly cellAspect: number;
  private readonly cells: string[][];
  private readonly pics: TerminalImage[] = [];
  private nextId = 1;

  constructor(cols: number, rows: number, cellAspect = 2) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.cellAspect = cellAspect;
    this.cells = Array.from({ length: this.rows }, () => new Array<string>(this.cols).fill(' '));
  }

  /** The character at a cell (a space outside the grid). */
  char(col: number, row: number): string {
    return this.cells[row]?.[col] ?? ' ';
  }

  /** A row as a string, `cols` long. */
  line(row: number): string {
    return this.cells[row]?.join('') ?? '';
  }

  /** Every row, top first. */
  lines(): string[] {
    return this.cells.map((r) => r.join(''));
  }

  /** Teletype: `s` at the cursor, wrapping, '\n' (next line, its start), '\r' (this line's start), scrolling. */
  write(s: string) {
    const c = this.cursor;
    for (const ch of s) {
      if (ch === '\n') {
        c.col = 0;
        this.lineFeed();
      } else if (ch === '\r') c.col = 0;
      else {
        if (c.col >= this.cols) {
          c.col = 0;
          this.lineFeed();
        }
        this.cells[c.row][c.col++] = CONTROL.test(ch) ? ' ' : ch;
      }
    }
    this.version++;
  }

  /** Teletype: `s` then a newline. */
  writeLine(s = '') {
    this.write(`${s}\n`);
  }

  /** Screen: `s` from a cell rightwards, clipped at the edge; no wrap, no scroll, the cursor stays. '\n' starts the
   *  next row at the same column. */
  print(col: number, row: number, s: string) {
    let x = Math.floor(col), y = Math.floor(row);
    for (const ch of s) {
      if (ch === '\n') {
        x = Math.floor(col);
        y++;
        continue;
      }
      if (y >= 0 && y < this.rows && x >= 0 && x < this.cols) this.cells[y][x] = CONTROL.test(ch) || ch === '\r' ? ' ' : ch;
      x++;
    }
    this.version++;
  }

  /** Screen: a whole row (cut or padded to the width). */
  setLine(row: number, s: string) {
    if (row < 0 || row >= this.rows) return;
    this.cells[row].fill(' ');
    this.print(0, row, s.replace(/\n/g, ' '));
  }

  /** Screen: the whole frame, row by row (rows past the last given are blank). */
  setLines(lines: readonly string[]) {
    for (let r = 0; r < this.rows; r++) this.cells[r].fill(' ');
    lines.slice(0, this.rows).forEach((l, r) => this.print(0, r, l.replace(/\n/g, ' ')));
    this.version++;
  }

  /** Blank every cell, no images; the cursor home. */
  clear() {
    for (const r of this.cells) r.fill(' ');
    this.pics.length = 0;
    this.cursor.col = this.cursor.row = 0;
    this.version++;
  }

  /** An image with its top-left corner at cell (`col`, `row`), stretched to `w` by `h` cells (fractions allowed; it may
   *  hang off the edges, clipped there). Under the text, in the phosphor's colour. Returns its id, for `removeImage`. */
  drawImage(src: TerminalImageSource, col: number, row: number, w: number, h: number, o: { smooth?: boolean } = {}): number {
    const id = this.nextId++;
    this.pics.push({ id, src, col, row, w, h, smooth: o.smooth ?? true });
    this.version++;
    return id;
  }

  /** How many rows an image `imgW` x `imgH` (px, or any units) takes at `cols` cells wide, undistorted. */
  imageRows(cols: number, imgW: number, imgH: number): number {
    return (cols * imgH) / imgW / this.cellAspect;
  }

  /** Take an image off (by its id from `drawImage`); false if it is not there. */
  removeImage(id: number): boolean {
    const i = this.pics.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.pics.splice(i, 1);
    this.version++;
    return true;
  }

  /** Take every image off (the text stays). */
  clearImages() {
    if (!this.pics.length) return;
    this.pics.length = 0;
    this.version++;
  }

  /** The images, in the order drawn (later on top). */
  images(): readonly TerminalImage[] {
    return this.pics;
  }

  /** Something the screen shows changed without a call here (a canvas a program draws into): redraw. */
  touch() {
    this.version++;
  }

  /** The cursor to a cell (clamped to the grid). */
  moveTo(col: number, row: number) {
    this.cursor.col = Math.min(this.cols - 1, Math.max(0, Math.floor(col)));
    this.cursor.row = Math.min(this.rows - 1, Math.max(0, Math.floor(row)));
    this.version++;
  }

  /** Show or hide the cursor; `blink` (default true) or steady. */
  showCursor(visible: boolean, blink = true) {
    this.cursor.visible = visible;
    this.cursor.blink = blink;
    this.version++;
  }

  /** Everything up `n` rows, images too (those wholly gone off the top dropped), blank rows in at the bottom; the
   *  cursor stays. */
  scroll(n = 1) {
    for (let i = 0; i < n; i++) {
      const top = this.cells.shift()!;
      top.fill(' ');
      this.cells.push(top);
    }
    for (let i = this.pics.length - 1; i >= 0; i--) {
      const p = this.pics[i];
      p.row -= n;
      if (p.row + p.h <= 0) this.pics.splice(i, 1);
    }
    this.version++;
  }

  private lineFeed() {
    if (this.cursor.row < this.rows - 1) this.cursor.row++;
    else this.scroll();
  }
}

// ------------------------------------------------------------------------------------------------ helpers for programs

/** `s` cut or padded (with `fill`) to `width`; `align` where it sits. */
export function fit(s: string, width: number, align: 'left' | 'right' | 'center' = 'left', fill = ' '): string {
  if (s.length >= width) return s.slice(0, width);
  const pad = width - s.length;
  if (align === 'right') return fill.repeat(pad) + s;
  if (align === 'center') return fill.repeat(Math.floor(pad / 2)) + s + fill.repeat(Math.ceil(pad / 2));
  return s + fill.repeat(pad);
}

/** A text bar `width` cells wide, `frac` (0..1) of it full: `[#####.....]`. */
export function bar(frac: number, width: number, full = '#', empty = '.'): string {
  const inner = Math.max(0, width - 2);
  const n = Math.round(Math.min(1, Math.max(0, frac)) * inner);
  return `[${full.repeat(n)}${empty.repeat(inner - n)}]`;
}

/** Words wrapped to `width` (long words broken), one string per line. */
export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (let word of para.split(/ +/)) {
      while (word.length > width) {
        if (line) out.push(line), (line = '');
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else out.push(line), (line = word);
    }
    out.push(line);
  }
  return out;
}

/** A program that types `s` out at `cps` characters a second (teletype `write`), then stops. */
export function typewriter(s: string, cps = 30): TerminalProgram {
  let at = 0, owed = 0;
  return {
    update(text, dt) {
      if (at >= s.length) return;
      owed += cps * dt;
      const n = Math.floor(owed);
      owed -= n;
      if (n > 0) text.write(s.slice(at, (at += n)));
    },
  };
}
