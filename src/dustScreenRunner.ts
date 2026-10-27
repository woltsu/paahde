// A dust screen's picture: sand dust blown up through a slowly turning flow field on the dark, with the cards of its
// script (DustScript) fading in over it a letter at a time, and a loading bar if it has one. The loading cover's
// prologue (src/prologue.ts) and the black between dying and waking up (src/deathDust.ts) are scripts for it.
// Plain canvas 2D that knows nothing of the page: it runs in a worker (src/dustScreenWorker.ts, src/dustScreen.ts)
// because the main thread may be busy building the world while this is up. Where WebGPU is, the dust is drawn on a
// canvas underneath by src/dustScreenGpu.ts and this one only lays the text and the bar over it (`dust(false)`).

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** One line of a card, its letters starting to come in `at` s after the screen went up. `prose` is wrapped and set
 *  in the warm white, left-aligned in a block centred on the screen; `title` is big spaced gold capitals and
 *  `caption` small spaced capitals, each centred. */
export type DustLine = { text: string; style: 'prose' | 'title' | 'caption'; at: number };
/** Lines on screen together, stacked about the middle of it (a blank line between prose paragraphs), from their
 *  first `at` until they fade out at `out` (s; never if left out). */
export type DustCard = { lines: DustLine[]; out?: number };
/** What a dust screen shows (plain data: it goes to the worker). `bar`: a loading bar near the bottom (`progress`);
 *  `dustIn`: how long (s) the dust takes to come up from the dark. */
export type DustScript = { cards: DustCard[]; bar?: boolean; dustIn?: number };

const FONT = 'Neuropol, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const INK = '236, 228, 210'; // the prologue's warm white (rgb, for alpha)
const GOLD = '217, 178, 106';
/** Dust colours: whites, pale golds, yellows and ochres; the fine haze and the far layer are dim, the near one bright. */
const LAYERS = [
  { share: 0.3, speed: 15, width: 0.4, colors: ['rgba(196,164,112,.5)', 'rgba(222,200,160,.45)', 'rgba(168,132,80,.55)', 'rgba(240,228,204,.4)'] },
  { share: 0.39, speed: 11, width: 0.45, colors: ['rgba(122,92,48,.55)', 'rgba(150,118,62,.5)', 'rgba(104,80,46,.6)', 'rgba(170,150,120,.4)'] },
  { share: 0.23, speed: 16, width: 0.65, colors: ['rgba(214,170,84,.6)', 'rgba(232,196,110,.55)', 'rgba(190,138,62,.6)', 'rgba(240,226,196,.45)'] },
  { share: 0.08, speed: 26, width: 0.9, colors: ['rgba(246,214,128,.75)', 'rgba(255,240,206,.7)', 'rgba(228,180,92,.75)', 'rgba(255,250,236,.65)'] },
];
const MAX_PIXELS = 4.2e6; // the visible canvas's backing store, at most (about 2560x1600)
const TRAIL_PIXELS = 2.2e6; // the dust's own canvas: soft anyway, so cheaper
const FADE = 0.1; // how much of the dust's trails fades per frame (at 60 fps)

const CHAR_S = 0.022; // the letters' stagger
const LETTER_S = 0.9; // one letter's fade in
const OUT_S = 1.6; // a card's fade out

export function createDustScreen(g: Ctx, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement, script: DustScript) {
  let w = 1;
  let h = 1;
  let dpr = 1;
  let trail = makeCanvas(1, 1);
  let tg = trail.getContext('2d') as Ctx;
  let ts = 1; // trail pixels per css px
  let bg: CanvasGradient | null = null;
  let vignette: CanvasGradient | null = null;

  let ownDust = true; // drawing the backdrop and the dust here, not just the text over another canvas
  let last = { w: 1, h: 1, dpr: 1 };
  let clock = 0;
  let target = 0; // loading progress asked for, and the eased value drawn
  let shown = 0;
  let rand = 11;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);

  // Particles: position, previous position, layer, and the stroke bucket (layer x colour) they're drawn in.
  let n = 0;
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let ox = new Float32Array(0);
  let oy = new Float32Array(0);
  let layer = new Uint8Array(0);
  let twinkle = new Float32Array(0); // a phase; the near layer's grains glint now and then
  let pace = new Float32Array(0); // each grain's own speed, so they don't move as one sheet
  let buckets: Int32Array[] = [];

  // Text laid out for the current size: each row's letters with their x from the row's start, and where it goes.
  type Line = { s: string; xs: number[] };
  type Row = Line & { x: number; y: number; px: number; rgb: string; scale: number; at: number; k0: number };
  let size = 20;
  let big = 40;
  let lineH = 32;
  let cards: { rows: Row[]; at: number; out: number; bed: { x: number; top: number; bottom: number } | null }[] = [];

  function spawn(i: number, anywhere: boolean) {
    px[i] = rnd() * w;
    py[i] = anywhere ? rnd() * h : h + rnd() * 40;
    ox[i] = px[i];
    oy[i] = py[i];
  }

  /** A line's letters placed in the current font, `spacing` px apart past their own widths, and its width. */
  function line(s: string, spacing: number): Line & { width: number } {
    const xs: number[] = [];
    for (let k = 0; k < s.length; k++) xs.push(g.measureText(s.slice(0, k)).width + k * spacing);
    return { s, xs, width: g.measureText(s).width + (s.length - 1) * spacing };
  }

  function layout() {
    size = Math.round(Math.max(12, Math.min(16, w / 64)));
    big = Math.round(size * 1.8);
    lineH = Math.round(size * 1.95);
    const spacing = size * 0.05;
    const max = Math.min(w * 0.86, size * 36);
    cards = script.cards.map((card) => {
      // each line's rows (a paragraph wrapped; a title or caption in capitals, spaced wide) and the height it takes
      const items = card.lines.map((l) => {
        const px = l.style === 'title' ? big : size;
        g.font = `${px}px ${FONT}`;
        if (l.style !== 'prose') {
          const spread = g.measureText('M').width * (l.style === 'title' ? 0.6 : 0.25);
          return { l, px, rows: [line(l.text.toUpperCase(), spread)], h: l.style === 'title' ? big * 1.4 : lineH };
        }
        const width = (t: string) => g.measureText(t).width + (t.length - 1) * spacing;
        const rows: (Line & { width: number })[] = [];
        let text = '';
        for (const word of l.text.split(' ')) {
          if (text && width(`${text} ${word}`) > max) {
            rows.push(line(text, spacing));
            text = word;
          } else text = text ? `${text} ${word}` : word;
        }
        rows.push(line(text, spacing));
        return { l, px, rows, h: rows.length * lineH };
      });
      const gap = (i: number) => (i > 0 && items[i].l.style === 'prose' && items[i - 1].l.style === 'prose' ? lineH : 0);
      const height = items.reduce((s, it, i) => s + gap(i) + it.h, 0);
      const longest = Math.max(0, ...items.filter((it) => it.l.style === 'prose').flatMap((it) => it.rows.map((r) => r.width)));
      const blockX = Math.round((w - longest) / 2);
      const rows: Row[] = [];
      let bed: { x: number; top: number; bottom: number } | null = null;
      let y = Math.round(h * 0.47 - height / 2);
      items.forEach((it, i) => {
        y += gap(i);
        const prose = it.l.style === 'prose';
        if (prose) bed = { x: blockX, top: bed?.top ?? y, bottom: y + it.h };
        let k0 = 0;
        it.rows.forEach((r, j) => {
          const x = prose ? blockX : Math.round((w - r.width) / 2);
          const ry = prose ? y + j * lineH + lineH / 2 : y + it.h / 2;
          rows.push({ ...r, x, y: ry, px: it.px, rgb: it.l.style === 'title' ? GOLD : INK, scale: it.l.style === 'caption' ? 0.7 : 1, at: it.l.at, k0 });
          k0 += r.s.length + 1;
        });
        y += it.h;
      });
      return { rows, bed, at: Math.min(...card.lines.map((l) => l.at)), out: card.out ?? Infinity };
    });
  }

  function resize(cw: number, ch: number, deviceRatio: number) {
    last = { w: cw, h: ch, dpr: deviceRatio };
    w = Math.max(1, cw);
    h = Math.max(1, ch);
    dpr = Math.min(deviceRatio, 2, Math.sqrt(MAX_PIXELS / (w * h)));
    g.canvas.width = Math.round(w * dpr);
    g.canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    if (!ownDust) {
      n = 0;
      buckets = [];
      trail = makeCanvas(1, 1);
      tg = trail.getContext('2d') as Ctx;
      return;
    }
    ts = Math.min(1, Math.sqrt(TRAIL_PIXELS / (w * h)));
    trail = makeCanvas(Math.round(w * ts), Math.round(h * ts));
    tg = trail.getContext('2d') as Ctx;
    tg.setTransform(ts, 0, 0, ts, 0, 0);
    tg.lineCap = 'round';

    const r = Math.hypot(w, h) / 2;
    bg = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, r);
    bg.addColorStop(0, '#15100b');
    bg.addColorStop(1, '#050403');
    vignette = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.7)');

    n = Math.round(Math.min(16000, Math.max(3500, (w * h) / 105)));
    px = new Float32Array(n);
    py = new Float32Array(n);
    ox = new Float32Array(n);
    oy = new Float32Array(n);
    layer = new Uint8Array(n);
    twinkle = new Float32Array(n);
    pace = new Float32Array(n);
    const lists: number[][] = LAYERS.flatMap((l) => l.colors.map(() => []));
    for (let i = 0; i < n; i++) {
      let r = rnd();
      let L = 0;
      while (L < LAYERS.length - 1 && r >= LAYERS[L].share) r -= LAYERS[L++].share;
      layer[i] = L;
      twinkle[i] = rnd() * 1000;
      pace[i] = 0.55 + rnd() * rnd() * 1.4;
      lists[L * 4 + Math.floor(rnd() * 4)].push(i);
      spawn(i, true);
    }
    buckets = lists.map((l) => Int32Array.from(l));
  }

  /** The wind at (x, y): a domain-warped field of sines that drifts in time, so eddies form, wander and let go,
   *  on top of a steady wind up the screen. Sets the heading and a gust factor. */
  let heading = 0;
  let gust = 1;
  function wind(x: number, y: number, t: number) {
    const k = 1 / (Math.min(w, h) * 0.33);
    const u = x * k;
    const v = y * k;
    const qx = u + 0.9 * Math.sin(v * 1.7 + t * 0.11);
    const qy = v + 0.9 * Math.sin(u * 1.3 - t * 0.09);
    heading = Math.sin(qx * 1.9 + t * 0.05) * Math.cos(qy * 2.3 - t * 0.07) * 2.6 + Math.sin((qx + qy) * 0.8 + t * 0.13) * 0.9;
    const s = Math.sin(-u * 0.3 - v * 0.6 - t * 0.35);
    gust = 0.45 + s * s * 1.1;
  }

  function step(dt: number) {
    for (let i = 0; i < n; i++) {
      const x = px[i];
      const y = py[i];
      ox[i] = x;
      oy[i] = y;
      const L = LAYERS[layer[i]];
      wind(x, y, clock + layer[i] * 7);
      const sp = L.speed * gust * pace[i] * dt;
      // (and a little Brownian jitter)
      px[i] = x + (Math.cos(heading) * 0.85 - 0.08 + (rnd() - 0.5) * 0.5) * sp;
      py[i] = y + (Math.sin(heading) * 0.85 - 0.65 + (rnd() - 0.5) * 0.5) * sp;
      const nx = px[i];
      const ny = py[i];
      if (ny < -20 || nx < -20 || nx > w + 20 || ny > h + 60 || rnd() < 0.003) spawn(i, rnd() < 0.5);
    }
  }

  function dust() {
    tg.globalCompositeOperation = 'destination-out';
    tg.fillStyle = `rgba(0,0,0,${FADE})`;
    tg.fillRect(0, 0, w, h);
    tg.globalCompositeOperation = 'source-over';
    for (let b = 0; b < buckets.length; b++) {
      const L = LAYERS[Math.floor(b / 4)];
      const list = buckets[b];
      tg.strokeStyle = L.colors[b % 4];
      tg.lineWidth = L.width;
      tg.beginPath();
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        if (ox[i] === px[i] && oy[i] === py[i]) continue;
        tg.moveTo(ox[i], oy[i]);
        tg.lineTo(px[i], py[i]);
      }
      tg.stroke();
    }
    // a near grain catching the light
    tg.fillStyle = 'rgba(255,248,226,.9)';
    for (const i of buckets[buckets.length - 1]) {
      if (Math.sin(twinkle[i] + clock * 3.1) * Math.sin(twinkle[i] * 1.7 + clock * 1.3) > 0.97) tg.fillRect(px[i] - 0.75, py[i] - 0.75, 1.5, 1.5);
    }
  }

  const ramp = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  /** One laid-out line from `x`, each letter fading in (and rising a touch) `CHAR_S` after the one before it from `t0`. */
  function letters({ s, xs }: Line, x: number, y: number, t0: number, k0: number, rgb: string, scale: number) {
    for (let k = 0; k < s.length; k++) {
      if (s[k] === ' ') continue;
      const a = ramp((clock - t0 - (k0 + k) * CHAR_S) / LETTER_S) * scale;
      if (a <= 0.003) continue;
      g.fillStyle = `rgba(${rgb},${a})`;
      g.fillText(s[k], x + xs[k], y + (1 - a / scale) * 5);
    }
  }

  function text() {
    g.textBaseline = 'middle';
    for (const c of cards) {
      const out = 1 - ramp((clock - c.out) / OUT_S);
      if (out <= 0 || clock <= c.at) continue;
      if (c.bed) {
        // a soft dark bed so the dust doesn't eat the paragraphs
        const { x, top, bottom } = c.bed;
        const rx = Math.min(w * 0.6, (w - 2 * x) * 0.75 + 80);
        const ry = (bottom - top) * 0.75 + 60;
        g.save();
        g.translate(w / 2, (top + bottom) / 2);
        g.scale(rx, ry);
        const bed = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        bed.addColorStop(0, `rgba(6,5,4,${0.6 * out * ramp(clock - c.at)})`);
        bed.addColorStop(1, 'rgba(6,5,4,0)');
        g.fillStyle = bed;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
      for (const r of c.rows) {
        g.font = `${r.px}px ${FONT}`;
        letters(r, r.x, r.y, r.at, r.k0, r.rgb, r.scale * out);
      }
    }
  }

  function draw() {
    g.globalAlpha = 1;
    if (ownDust) {
      g.fillStyle = bg!;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = ramp(clock / Math.min(1.5, script.dustIn ?? 1.5));
      g.drawImage(trail, 0, 0, w, h);
      g.globalAlpha = 1;
      g.fillStyle = vignette!;
      g.fillRect(0, 0, w, h);
    } else g.clearRect(0, 0, w, h);
    text();
    if (!script.bar) return;
    // the loading bar near the bottom: a dim track, filled in gold from the left
    const tw = Math.round(Math.min(360, w * 0.5));
    const tx = Math.round(w / 2 - tw / 2);
    const ty = Math.round(h - 48);
    const a = ramp(clock / 0.6);
    g.fillStyle = `rgba(${INK},${0.12 * a})`;
    g.fillRect(tx, ty, tw, 3);
    g.fillStyle = `rgba(${GOLD},${0.85 * a})`;
    g.fillRect(tx, ty, tw * shown, 3);
  }

  return {
    resize,
    relayout: layout,
    /** Whether to draw the dust here (the default), or leave it to a canvas underneath (src/dustScreenGpu.ts). */
    dust(on: boolean) {
      ownDust = on;
      resize(last.w, last.h, last.dpr);
    },
    progress: (p: number) => (target = Math.max(target, p)),
    frame(dt: number) {
      dt = Math.min(0.05, dt);
      clock += dt;
      shown += (target - shown) * Math.min(1, dt * 4);
      if (ownDust) {
        step(dt);
        dust();
      }
      draw();
    },
  };
}
