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

/** Control characters (but newline and carriage return) drawn as nothing: a space. */
const CONTROL = /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/;

/** A terminal's screen as text: `cols` x `rows` cells, each one character (a space when empty), and a cursor. Two ways to
 *  write, mixable:
 *  - like a teletype: `write` at the cursor, wrapping at the right edge, '\n' to the next line, '\r' to its start,
 *    scrolling up off the bottom (a log, a shell, streamed output);
 *  - like a screen: `print` at a cell (clipped, no wrap or scroll, the cursor stays), `setLine`, `setLines` for a whole
 *    frame, `clear` (a status board, a menu, anything redrawn).
 *  `version` changes with every change, so the screen redraws only when there is something new. */
export class TerminalText {
  readonly cols: number;
  readonly rows: number;
  /** Where the next `write` goes; `col` may equal `cols` after the last column is written (the wrap waits for the next
   *  character, as on a real terminal); it is drawn in the last column then. */
  readonly cursor = { col: 0, row: 0, visible: true, blink: true };
  /** Bumped by every change (the cursor's too). */
  version = 0;
  private readonly cells: string[][];

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
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

  /** Blank every cell; the cursor home. */
  clear() {
    for (const r of this.cells) r.fill(' ');
    this.cursor.col = this.cursor.row = 0;
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

  /** Everything up `n` rows, blank rows in at the bottom; the cursor stays. */
  scroll(n = 1) {
    for (let i = 0; i < n; i++) {
      const top = this.cells.shift()!;
      top.fill(' ');
      this.cells.push(top);
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
