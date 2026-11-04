// Climbing a radio tower's ladder (shared/towers.ts), synthesised: each hand or foot landing on a steel rung
// (src/players.ts, from src/models/climbCycle.ts) is a knock and a short ring of the rung.
// - a hand: a gloved slap (low-passed noise, 20 ms) and the rung's thin ring (two inharmonic partials, ~0.1 s);
// - a foot: a boot's thud (a sine dropping from 150 Hz, 60 ms), a scuff of grit (band-passed noise) and a lower,
//   longer ring.
// Pitch varies a little from rung to rung. Others' are placed (a panner) and fade 1/d past `ref`, gone past `hear`; your
// own are head-locked: the events climb.hand and climb.foot (src/audioConfig.ts, route 'spatial'). Through the shared output (src/audio.ts: master gain and limiter).
//
// Levels (measured offline: a steady climb, three steps a second, both kinds, rendered in headless Chrome's
// OfflineAudioContext at the default volume, ffmpeg ebur128): −31 LUFS integrated, about the footsteps on concrete;
// true peak ≤ −14 dBTP.
import { defineSynth, play } from './sounds';

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

// A hand (arg 'hand') or foot on a rung; the event's spread (`vary` 0.06) is the rung-to-rung pitch, 0.94..1.06.
defineSynth('rung', {
  length: 0.6,
  voice: (ctx, out, t, o) => clank(ctx, out, o.arg === 'hand', t, Math.min(1, Math.max(0, (o.rate - 0.94) / 0.12))),
});

class ClimbSound {
  /** A hand (`hand`) or foot landed on a rung at (x, y, z); `placed`: someone else's (else your own, head-locked). */
  land(hand: boolean, x: number, y: number, z: number, placed: boolean) {
    play(hand ? 'climb.hand' : 'climb.foot', placed ? { x, y, z } : null);
  }
}

export const climbSound = new ClimbSound();
