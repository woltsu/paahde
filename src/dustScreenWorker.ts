// Draws a dust screen off the main thread (src/dustScreen.ts has the page side): the dust on the GPU
// (src/dustScreenGpu.ts) where it can, under the text and bar on the 2D canvas, or all of it in 2D where it can't.
import { createGpuDust, type GpuDust } from './dustScreenGpu';
import { createDustScreen, type DustScript } from './dustScreenRunner';

type Init = { t: 'init'; canvas: OffscreenCanvas; dust?: OffscreenCanvas; w: number; h: number; dpr: number; script: DustScript; font: string };
type In = Init | { t: 'size'; w: number; h: number; dpr: number } | { t: 'progress'; p: number } | { t: 'stop' };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; close(): void; fonts?: FontFaceSet };

/** How long the title font may take before the screen starts without it. */
const FONT_WAIT_MS = 2000;

let run: ReturnType<typeof createDustScreen> | null = null;
let gpu: GpuDust | null = null;
let size = { w: 1, h: 1, dpr: 1 };
let progress = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** A worker doesn't see the page's @font-face, so it loads the title font itself. Its canvases keep whatever a font
 *  string first resolved to (the fallback for good, if that was before the font was in, relayout or not), so nothing
 *  is laid out or drawn until it is in (or failed, or is taking too long). */
function loadFont(url: string): Promise<unknown> {
  if (!ctx.fonts || typeof FontFace === 'undefined') return Promise.resolve();
  const font = new FontFace('Neuropol', `url(${url})`);
  ctx.fonts.add(font);
  return Promise.race([font.load().catch(() => {}), new Promise((done) => setTimeout(done, FONT_WAIT_MS))]);
}

function start(m: Init) {
  const r = (run = createDustScreen(m.canvas.getContext('2d')!, (w, h) => new OffscreenCanvas(w, h), m.script));
  // text only until the GPU dust is up (or isn't to be had, or is lost: then the 2D dust, as before)
  if (m.dust) r.dust(false);
  r.resize(size.w, size.h, size.dpr);
  r.progress(progress);
  if (m.dust)
    createGpuDust(m.dust, m.script.dustIn).then(
      (d) => {
        if (!d) return r.dust(true);
        if (timer === undefined) return d.destroy(); // stopped meanwhile
        gpu = d;
        d.resize(size.w, size.h, size.dpr);
        d.lost.then(() => {
          if (gpu !== d) return;
          gpu = null;
          r.dust(true);
        });
      },
      () => r.dust(true),
    );
  let last = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    run!.frame((now - last) / 1000);
    gpu?.frame((now - last) / 1000);
    last = now;
  }, 1000 / 60);
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    size = m;
    loadFont(m.font).then(() => start(m));
  } else if (m.t === 'size') {
    size = m;
    run?.resize(m.w, m.h, m.dpr);
    gpu?.resize(m.w, m.h, m.dpr);
  } else if (m.t === 'progress') {
    progress = Math.max(progress, m.p);
    run?.progress(m.p);
  } else if (m.t === 'stop') {
    clearInterval(timer);
    timer = undefined;
    const d = gpu;
    gpu = null;
    d?.destroy();
    ctx.close();
  }
};
