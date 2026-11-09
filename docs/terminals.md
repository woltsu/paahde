# Terminals: what their screens show

A net terminal (`src/world/netTerminal.ts`) draws a grid of text on its CRT. What is on the grid is decided by a
**program**: a small object that writes to the screen's text every frame the terminal is awake. The default program
streams the game's own code (`src/world/codeStream.ts`); give a terminal any other to show anything else.

```
program  ──writes──▶  TerminalText (cols × rows of characters + a cursor)  ──drawn by──▶  TerminalScreen (canvas → CRT)
```

The renderer never decides content, and a program never touches three.js, the canvas or the font.

## Writing a program

A program is anything with `update(text, dt)`, optionally `start(text)`. A bare function works too.

```ts
import { NetTerminal } from './world/netTerminal.ts';
import { bar, fit, type TerminalProgram } from './world/terminalText.ts';

function reactorStatus(read: () => number): TerminalProgram {
  let shown = -1;
  return {
    start(text) { text.showCursor(false); },
    update(text, dt) {
      const pct = Math.round(read() * 100);
      if (pct === shown) return;            // nothing new: no redraw, no texture upload
      shown = pct;
      text.setLines([
        fit(' REACTOR ', text.cols, 'center', '='),
        '',
        ` core  ${bar(pct / 100, 30)} ${fit(String(pct), 3, 'right')}%`,
      ]);
    },
  };
}

const t = new NetTerminal({ kind: 'console', program: reactorStatus(() => reactor.heat) });
// later, swap what it shows (clears the screen, starts the new program):
t.program = (text, dt) => text.setLine(0, 'OFFLINE');
// or write from outside at any time, with no program of its own (e.g. on a server message):
t.text.writeLine('connection closed');
```

- `update` runs only while the terminal is within 16 m of the camera (`RANGE`); far away the program sleeps and the
  screen holds its last frame. Programs that must keep time while asleep should read a clock (`net.serverTime()`, the
  world's time), not add up `dt`.
- The screen redraws only when the text changed (`TerminalText.version`) or the cursor blinked, at most 15 times a
  second. Write only when something changed, as above: an unchanged `setLines` every frame still counts as a change.
- Programs are client-only dressing. Anything players must agree on (a door code, a puzzle's state) belongs to the
  server and comes to the program through whatever the game already syncs.

## TerminalText (`src/world/terminalText.ts`)

Two ways to write, freely mixed:

| Style | Calls | Behaviour |
|---|---|---|
| Teletype (logs, shells, streamed output) | `write(s)`, `writeLine(s)` | At the cursor; wraps at the right edge; `\n` next line, `\r` line start; scrolls up off the bottom. After the last column the wrap waits for the next character, as on a real terminal. |
| Screen (boards, menus, anything redrawn) | `print(col, row, s)`, `setLine(row, s)`, `setLines(lines)`, `clear()` | At a cell; clipped at the edges; never wraps or scrolls; the cursor stays put. |

Plus `moveTo(col, row)`, `showCursor(visible, blink = true)`, `scroll(n)`, and reads `char(col, row)`, `line(row)`,
`lines()`, `cols`, `rows`, `cursor`. Control characters are drawn as spaces; any printable character is kept (the VT220
face has box-drawing and other glyphs beyond ASCII).

Helpers: `fit(s, width, align, fill)` (cut or pad), `bar(frac, width)` (`[####....]`), `wrap(s, width)` (word wrap to
lines), `typewriter(s, cps)` (a program that types `s` out and stops), `asProgram(fnOrProgram)`.

## Grid sizes

Set per terminal kind in `TERMINALS` (`netTerminal.ts`): the console is 80 × 24, the compact 56 × 21. A program should
read `text.cols` / `text.rows` rather than assume them.

## Words on screens

Words a player reads on a terminal are player-visible text: they live in `shared/text.ts` (`TEXT`, docs/text.md) like
any other, and the program takes them from there. Only dev-only screens (the lab's `labBoard` in
`src/world/labPlates.ts`, the working example) compose their words in place. The code stream is decoration, not text.

## Testing

`tools/terminal-text.test.mjs` covers the text grid and the helpers; it runs under Node (`node --test`), with no
browser. A program's logic can be tested the same way: make a `new TerminalText(cols, rows)`, call `update` with a `dt`,
and read `text.lines()`.
