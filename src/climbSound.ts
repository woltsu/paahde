// Climbing a radio tower's ladder (shared/towers.ts), synthesised: each hand or foot landing on a steel rung
// (src/players.ts, from src/models/climbCycle.ts) is a knock and a short ring of the rung.
// - a hand: a gloved slap (low-passed noise, 20 ms) and the rung's thin ring (two inharmonic partials, ~0.1 s);
// - a foot: a boot's thud (a sine dropping from 150 Hz, 60 ms), a scuff of grit (band-passed noise) and a lower,
//   longer ring.
// Pitch varies a little from rung to rung. Others' are placed (a panner) and fade 1/d past REF, gone past HEAR; your own
// are head-locked. Through the shared output (src/audio.ts: master gain and limiter).
//
// Levels (measured offline: a steady climb, three steps a second, both kinds, rendered in headless Chrome's
// OfflineAudioContext at the default volume, ffmpeg ebur128): −31 LUFS integrated, about the footsteps on concrete;
// true peak ≤ −14 dBTP.
import { audio } from './audio';

/** Your own: full level. Others': full within REF (m), 1/d past it, silent past HEAR. */
const REF = 2.5;
const HEAR = 30;
/** Levels: the hand's knock and the foot's, and each one's ring. */
const HAND = 0.11, FOOT = 0.155, RING = 0.02;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** One hand (`hand`) or foot landing on a rung, into `out` at the context's time `t`; `r` (0..1) varies it. */
export function clank(ctx: BaseAudioContext, out: AudioNode, hand: boolean, t: number, r: number) {
  const pitch = 0.94 + r * 0.12;
  const env = (node: AudioNode, level: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    node.connect(g).connect(out);
  };
  // The knock: noise through a filter, shaped short.
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = hand ? 'lowpass' : 'bandpass';
  f.frequency.value = (hand ? 1400 : 900) * pitch;
  f.Q.value = hand ? 0.7 : 1.2;
  src.connect(f);
  env(f, hand ? HAND : FOOT * 0.6, 0.002, hand ? 0.012 : 0.02);
  src.start(t, r * 0.8);
  src.stop(t + 0.2);
  if (!hand) {
    // The boot's thud.
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.06);
    env(o, FOOT, 0.003, 0.025);
    o.start(t);
    o.stop(t + 0.25);
  }
  // The rung rings: two partials of a steel bar (free-free modes, ×2.76), a hand's thinner and shorter.
  const base = (hand ? 1250 : 820) * pitch;
  for (const [k, g] of [[1, 1], [2.76, 0.5]] as const) {
    const o = ctx.createOscillator();
    o.frequency.value = base * k;
    env(o, RING * g * (hand ? 0.8 : 1), 0.001, hand ? 0.035 : 0.06);
    o.start(t);
    o.stop(t + 0.5);
  }
}

class ClimbSound {
  private n = 1;

  /** A hand (`hand`) or foot landed on a rung at (x, y, z); `placed`: someone else's (else your own, head-locked). */
  land(hand: boolean, x: number, y: number, z: number, placed: boolean) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    let into: AudioNode = out;
    if (placed) {
      const l = ctx.listener, d = Math.hypot(x - l.positionX.value, y - l.positionY.value, z - l.positionZ.value);
      if (d > HEAR) return;
      const g = ctx.createGain();
      g.gain.value = REF / Math.max(REF, d);
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.rolloffFactor = 0;
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
      g.connect(p).connect(out);
      into = g;
      setTimeout(() => p.disconnect(), 1000);
    }
    this.n = (Math.imul(this.n, 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    clank(ctx, into, hand, ctx.currentTime, this.n / 4294967296);
  }
}

export const climbSound = new ClimbSound();
