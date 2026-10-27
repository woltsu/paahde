// A dust screen: blown sand on the dark with the text of a script (src/dustScreenRunner.ts DustScript), filling an
// element. The loading cover's prologue (src/prologue.ts) and the black between dying and waking up
// (src/deathDust.ts) are both one. The main thread may be blocked for long stretches (while the world builds), so it
// is drawn by a worker into an OffscreenCanvas, with the dust on a second canvas underneath on the GPU where WebGPU is
// (src/dustScreenGpu.ts). Without OffscreenCanvas it runs on the page instead, all in 2D.
import { createDustScreen, type DustScript } from './dustScreenRunner';

export type { DustScript } from './dustScreenRunner';

/** Neuropol (public/fonts): the worker loads it itself, the page has it from index.html. */
const FONT_URL = './fonts/neuropol.woff2';

export type DustScreen = {
  /** The loading bar's fill, 0..1 (only ever goes up). */
  progress(p: number): void;
  /** Stop drawing and take the canvases away. */
  stop(): void;
};

/** Show `script` filling `parent` (a positioned element covering the screen), from now. */
export function showDustScreen(parent: HTMLElement, script: DustScript): DustScreen {
  const fill = (el: HTMLCanvasElement) => ((el.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;'), el);
  const c = fill(document.createElement('canvas'));
  parent.prepend(c);
  const size = () => ({ w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1 });

  let resize = () => {};
  let progress = (_p: number) => {};
  let stop = () => {};
  let worker: Worker | null = null;
  let under: HTMLCanvasElement | null = null;
  if (typeof c.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./dustScreenWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = c.transferControlToOffscreen();
      let dust: OffscreenCanvas | undefined;
      if ('gpu' in navigator) {
        under = fill(document.createElement('canvas'));
        parent.prepend(under);
        dust = under.transferControlToOffscreen();
      }
      const font = new URL(FONT_URL, document.baseURI).href;
      worker.postMessage({ t: 'init', canvas: offscreen, dust, ...size(), script, font }, dust ? [offscreen, dust] : [offscreen]);
      const w = worker;
      resize = () => w.postMessage({ t: 'size', ...size() });
      progress = (p) => w.postMessage({ t: 'progress', p });
      stop = () => w.postMessage({ t: 'stop' });
    } catch {
      worker = null;
      under?.remove();
      under = null;
    }
  }
  if (!worker) {
    const run = createDustScreen(c.getContext('2d')!, (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }), script);
    resize = () => {
      const s = size();
      run.resize(s.w, s.h, s.dpr);
    };
    resize();
    document.fonts?.load('16px Neuropol').then(() => run.relayout(), () => {});
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      run.frame((now - last) / 1000);
      last = now;
    };
    raf = requestAnimationFrame(frame);
    progress = run.progress;
    stop = () => cancelAnimationFrame(raf);
  }
  addEventListener('resize', resize);
  let stopped = false;
  return {
    progress: (p) => progress(p),
    stop() {
      if (stopped) return;
      stopped = true;
      stop();
      removeEventListener('resize', resize);
      c.remove();
      under?.remove();
    },
  };
}
