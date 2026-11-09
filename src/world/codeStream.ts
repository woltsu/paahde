// The net terminals' default program (src/world/terminalText.ts TerminalProgram): the game's own code streaming past, as
// this page loaded it: one of the scripts in the browser's resource timing (the build's minified chunks; in dev, Vite's
// transformed modules), fetched again from the HTTP cache, or this module's own functions if that fails. Bursts of output
// at a few hundred characters a second, pauses with the cursor blinking, now and then a line typed slowly as if by hand.
import type { TerminalProgram, TerminalText } from './terminalText.ts';

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

/** Code to stream, chosen by `seed` among the page's scripts. */
function codeFor(seed: number): Promise<string> {
  const urls = scriptUrls();
  const url = urls[seed % urls.length];
  let p = texts.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => (t.length > 2000 ? sanitize(t) : Promise.reject(new Error('short'))))
      .catch(() => sanitize([scriptUrls, sanitize, codeFor, codeStream].map(String).join('\n')));
    texts.set(url, p);
  }
  return p;
}

/** Tiny seeded LCG in [0, 1): each screen's rhythm its own. */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32);
}

/** The game's code streaming past, `seed` choosing the script, where in it, and the rhythm. */
export function codeStream(seed = 0): TerminalProgram {
  const rand = lcg(seed + 1);
  let code = '';
  let at = 0;
  /** Characters a second now (0: paused), and for how much longer (s). */
  let rate = 0;
  let left = 0.4;
  let owed = 0;
  void codeFor(seed).then((c) => {
    code = c;
    at = Math.floor(lcg(seed + 7)() * c.length);
  });

  /** What the screen does next: a burst of output, a pause, or a slow typed line. */
  const next = () => {
    const r = rand();
    if (rate > 0 && r < 0.5) {
      rate = 0;
      left = 0.3 + rand() * 1.8;
    } else if (r < 0.85) {
      rate = 250 + rand() * 900;
      left = 0.4 + rand() * 2.5;
    } else {
      rate = 9 + rand() * 8; // someone typing
      left = 1 + rand() * 2;
    }
  };

  return {
    update(text: TerminalText, dt: number) {
      if (!code) return;
      left -= dt;
      if (left <= 0) next();
      owed += rate * dt;
      const n = Math.floor(owed);
      owed -= n;
      if (n <= 0) return;
      const end = at + n;
      const chunk = end <= code.length ? code.slice(at, end) : code.slice(at) + code.slice(0, end - code.length);
      at = end % code.length;
      text.write(chunk);
    },
  };
}
