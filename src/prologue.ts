// The loading cover (#cover in index.html): the prologue (src/prologueRunner.ts), started from src/entry.ts before
// the big game bundle has downloaded and stopped by src/main.ts when the cover leaves. The main thread is blocked for
// long stretches while the world builds, so it is drawn by a worker into an OffscreenCanvas, with the dust on a second
// canvas underneath on the GPU where WebGPU is (src/prologueDust.ts). Without OffscreenCanvas it runs on the page
// instead, all in 2D.
// A tab's first load tells the whole prologue and keeps the cover up until it is told (or a key or click skips it);
// a reload in the same tab (a deploy, src/update.ts), or any load once this browser has joined a game, shows only
// the title. `&prologue` in the address (e.g. `?w=lab&prologue`) tells the whole prologue every time and keeps the cover
// up for good, to look at it.
import { createPrologue, FONT_URL, PROLOGUE_S } from './prologueRunner';

let off: (() => void) | null = null;
let progress: (p: number) => void = () => {};
let until = 0; // performance.now() the cover may lift at
const KEEP = new URLSearchParams(location.search).has('prologue');

function start() {
  const cover = document.getElementById('cover');
  if (!cover || off) return;
  let full = true;
  try {
    full = !sessionStorage.getItem('prologueSeen') && !localStorage.getItem('joinedBefore');
    sessionStorage.setItem('prologueSeen', '1');
  } catch {
    // no storage: tell it every time
  }
  if (KEEP) full = true;
  until = KEEP ? Infinity : full ? performance.now() + PROLOGUE_S * 1000 : 0;
  const skip = () => (until = KEEP ? Infinity : 0);
  const c = document.createElement('canvas');
  cover.prepend(c);
  const size = () => ({ w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1 });

  let resize = () => {};
  let stop = () => {};
  let worker: Worker | null = null;
  let under: HTMLCanvasElement | null = null;
  if (typeof c.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./prologueWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = c.transferControlToOffscreen();
      let dust: OffscreenCanvas | undefined;
      if ('gpu' in navigator) {
        under = document.createElement('canvas');
        cover.prepend(under);
        dust = under.transferControlToOffscreen();
      }
      const font = new URL(FONT_URL, document.baseURI).href;
      worker.postMessage({ t: 'init', canvas: offscreen, dust, ...size(), full, font }, dust ? [offscreen, dust] : [offscreen]);
      const w = worker;
      resize = () => w.postMessage({ t: 'size', ...size() });
      progress = (p) => w.postMessage({ t: 'progress', p });
      stop = () => w.postMessage({ t: 'stop' });
    } catch {
      worker = null;
      under?.remove();
    }
  }
  if (!worker) {
    const run = createPrologue(c.getContext('2d')!, (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }), full);
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
  addEventListener('keydown', skip);
  addEventListener('pointerdown', skip);
  off = () => {
    stop();
    removeEventListener('resize', resize);
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
    c.remove();
    under?.remove();
  };
}

function stopPrologue() {
  off?.();
  off = null;
  progress = () => {};
}

/** We joined a game: from now on this browser sees only the title. */
function joined() {
  try {
    localStorage.setItem('joinedBefore', '1');
  } catch {
    // no storage: the prologue is told again next time
  }
}

export const prologue = {
  joined,
  start,
  stop: stopPrologue,
  progress: (p: number) => progress(p),
  /** Whether the cover may lift: the prologue has been told, skipped, or was only the title. */
  told: () => performance.now() >= until,
};
