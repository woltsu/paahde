// Draws a dust screen off the main thread (src/dustScreen.ts has the page side): the dust on the GPU
// (src/dustScreenGpu.ts) where it can, under the text and bar on the 2D canvas, or all of it in 2D where it can't.
import { createGpuDust, type GpuDust } from './dustScreenGpu';
import { createDustScreen, type DustScript } from './dustScreenRunner';

type In =
  | { t: 'init'; canvas: OffscreenCanvas; dust?: OffscreenCanvas; w: number; h: number; dpr: number; script: DustScript; font: string }
  | { t: 'size'; w: number; h: number; dpr: number }
  | { t: 'progress'; p: number }
  | { t: 'stop' };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; close(): void; fonts?: FontFaceSet };

let run: ReturnType<typeof createDustScreen> | null = null;
let gpu: GpuDust | null = null;
let size = { w: 1, h: 1, dpr: 1 };
let timer: ReturnType<typeof setInterval> | undefined;
ctx.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    size = m;
    const r = (run = createDustScreen(m.canvas.getContext('2d')!, (w, h) => new OffscreenCanvas(w, h), m.script));
    // text only until the GPU dust is up (or isn't to be had, or is lost: then the 2D dust, as before)
    if (m.dust) r.dust(false);
    r.resize(m.w, m.h, m.dpr);
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
    // a worker doesn't see the page's @font-face: load the title font here, and lay the text out again once it's in
    if (ctx.fonts && typeof FontFace !== 'undefined') {
      const font = new FontFace('Neuropol', `url(${m.font})`);
      ctx.fonts.add(font);
      font.load().then(() => run?.relayout(), () => {});
    }
    let last = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      run!.frame((now - last) / 1000);
      gpu?.frame((now - last) / 1000);
      last = now;
    }, 1000 / 60);
  } else if (m.t === 'size') {
    size = m;
    run?.resize(m.w, m.h, m.dpr);
    gpu?.resize(m.w, m.h, m.dpr);
  }
  else if (m.t === 'progress') run?.progress(m.p);
  else if (m.t === 'stop') {
    clearInterval(timer);
    timer = undefined;
    const d = gpu;
    gpu = null;
    d?.destroy();
    ctx.close();
  }
};
