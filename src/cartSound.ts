// The cart unfolding or packing (shared/cart.ts, src/world/carts.ts): over UNFOLD_S, hinges creaking and scrap pieces
// clanking into place, the last one a solid knock as the poles or sides lock (packing: the same, the knock first is the
// lid dropping shut). Synthesised: filtered noise bursts for the clanks, a slow-swept band of noise for the creak.
// Heard from anyone's cart near the ears: panned, fading with distance, through the master (audio.out).
//
// Loudness (docs/audio.md): an unfold and a pack rendered by renderCartFold into an OfflineAudioContext at GAIN (right by
// it, full volume) measure −23.6 LUFS integrated, true peak −9.2 dBTP (headless Chrome, ffmpeg ebur128, Nov 2026).
import { audio } from './audio';
import { UNFOLD_S } from '../shared/cart.ts';

/** Level at full slider volume, right by the cart. */
const GAIN = 1.6;
/** Full level within this distance (m), then falling off as 1/d; not played past FAR. */
const NEAR = 3, FAR = 45;

/** One unfold (`packing`: one pack) at `at` (context time), level `g`, into `dest`, on context `ctx`. `rand` varies it. */
export function renderCartFold(ctx: BaseAudioContext, dest: AudioNode, at: number, g: number, packing: boolean, rand: () => number = Math.random) {
  const len = Math.ceil(ctx.sampleRate * 0.25);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
  const burst = (t: number, freq: number, q: number, level: number, decay: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * g, t + 0.003);
    env.gain.setTargetAtTime(0, t + 0.004, decay);
    src.connect(bp).connect(env).connect(dest);
    src.start(t);
    src.stop(t + Math.min(0.25, decay * 8));
  };
  // The hinge creak: a narrow band of noise sweeping slowly, on and off, under the clanks.
  const creak = (t0: number, dur: number, from: number, to: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 18;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.linearRampToValueAtTime(to, t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.setTargetAtTime(0.9 * g, t0, 0.05);
    env.gain.setTargetAtTime(0, t0 + dur - 0.08, 0.04);
    src.connect(bp).connect(env).connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.2);
  };
  const T = UNFOLD_S;
  creak(at + 0.05, T * 0.45, 700 + rand() * 200, 1100 + rand() * 300);
  creak(at + T * 0.5, T * 0.35, 900 + rand() * 200, 650 + rand() * 150);
  // Rattling scrap all the way, then the knock (first when packing: the lid shut).
  const n = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const t = at + 0.1 + (T - 0.35) * (i / n) + rand() * 0.06;
    burst(t, 1400 + rand() * 1800, 6, 0.35 + rand() * 0.25, 0.012 + rand() * 0.01);
  }
  const knock = at + (packing ? 0.05 : T - 0.12);
  burst(knock, 380, 3, 1, 0.03);
  burst(knock + 0.004, 2200, 4, 0.5, 0.015);
}

class CartSound {
  private lx = 0;
  private lz = 0;
  private yaw = 0;

  /** Where the ears are. `yaw` is the camera yaw (three.js: forward = (−sin, −cos)). */
  listener(p: { x: number; z: number }, yaw: number) {
    this.lx = p.x;
    this.lz = p.z;
    this.yaw = yaw;
  }

  /** A cart at (x, z) starts unfolding (or `packing`). */
  play(x: number, z: number, packing: boolean) {
    const ctx = audio.ctx;
    if (!ctx || !audio.out || !audio.running) return;
    const dx = x - this.lx, dz = z - this.lz, d = Math.hypot(dx, dz);
    if (d > FAR) return;
    const pan = ctx.createStereoPanner();
    const right = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
    pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(d, NEAR))) * 0.7;
    pan.connect(audio.out);
    renderCartFold(ctx, pan, ctx.currentTime + 0.02, GAIN * Math.min(1, NEAR / Math.max(d, 0.01)) * Math.min(1, (FAR - d) / 10), packing);
  }
}

export const cartSound = new CartSound();
