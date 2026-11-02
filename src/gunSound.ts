// Sounds of the heavy guns (shared/rifle.ts; src/rifle.ts fires them), all synthesised:
// - blasterShot: a heavy charge-thump: a sub drop and a punch of low noise under a downward electric snarl.
// - blast: the blaster's burst where the beam stopped: a sharp crack, a deep boom with a long low rumble, debris
//   pattering down (and on the dunes the hiss of sand falling back). It carries far (src/acoustics.ts: late, duller,
//   softer and wetter with distance, with the echoes off rock that big sounds have).
// - blasterRecharge: the heavy cell's slow, grinding whine back up between shots (much longer than the rifle's), and a
//   heavy latch when it's ready: yours only.
// - gravitonShot: a deep sub-bass drop under a high tearing shimmer, as if the air were ripped.
// - gravitonImpact: the end point caving in: a rushing inhale that stops dead, then a deep thud and a ringing low hum.
// Everything is placed through src/acoustics.ts and the shared output (src/audio.ts), every level ramped. Levels are
// calibrated in the full browser mix (docs/audio.md, the `blaster` and `graviton` scenarios of tools/audio-bench.ts).
import { audio } from './audio';
import { placed, type P } from './acoustics';

/** Each sound's level (into src/acoustics.ts `placed`), calibrated in the full mix (docs/audio.md). */
const LEVEL = { blasterShot: 0.11, blast: 0.25, recharge: 0.012, gravitonShot: 0.2, gravitonImpact: 0.33 };
/** Full level within this many metres. */
const BLAST_REF = 25, GRAV_REF = 18;

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext) {
  let b = noiseBufs.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBufs.set(ctx, b);
  return b;
}

/** Filtered noise from t for `len` s: attack `a`, exponential decay from `peak`. */
function hiss(ctx: BaseAudioContext, to: AudioNode, t: number, len: number, type: BiquadFilterType, f: number, q: number, peak: number, a = 0.002) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = type;
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(bp).connect(g).connect(to);
  n.start(t, Math.random());
  n.stop(t + len + 0.05);
  return bp;
}

/** An oscillator from t: frequency f0 → f1 over `len`, attack `a`, exponential decay from `peak`. */
function tone(ctx: BaseAudioContext, to: AudioNode, t: number, len: number, type: OscillatorType, f0: number, f1: number, peak: number, a = 0.003) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(to);
  o.start(t);
  o.stop(t + len + 0.05);
  return o;
}

// The voices, built on any context into `o` from time `t` (so they can be rendered offline and measured).

export function blasterShotVoice(ctx: BaseAudioContext, o: AudioNode, t: number) {
  tone(ctx, o, t, 0.45, 'sine', 150, 34, 0.9, 0.004); // the thump
  hiss(ctx, o, t, 0.3, 'lowpass', 700, 0.8, 0.8, 0.002); // its punch
  // The snarl: two detuned saws diving through a closing lowpass.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(5200, t);
  lp.frequency.exponentialRampToValueAtTime(380, t + 0.35);
  lp.connect(o);
  tone(ctx, lp, t, 0.38, 'sawtooth', 920, 110, 0.22, 0.002);
  tone(ctx, lp, t, 0.38, 'sawtooth', 947, 104, 0.18, 0.002);
  hiss(ctx, o, t, 0.06, 'highpass', 3500, 0.7, 0.45, 0.001); // the crack of the discharge
}

export function blastVoice(ctx: BaseAudioContext, o: AudioNode, t: number, sand: boolean) {
  hiss(ctx, o, t, 0.09, 'highpass', 1800, 0.6, 0.9, 0.001); // crack
  tone(ctx, o, t, 1.3, 'sine', 85, 26, 1, 0.006); // boom
  hiss(ctx, o, t, 1.8, 'lowpass', 380, 0.7, 1.1, 0.008); // its body and roll
  hiss(ctx, o, t + 0.05, 0.9, 'bandpass', 900, 0.9, 0.35, 0.01);
  // Debris pattering down.
  for (let i = 0; i < 10; i++) hiss(ctx, o, t + 0.15 + Math.random() * 0.9, 0.05 + Math.random() * 0.08, 'bandpass', 1200 + Math.random() * 2600, 6, 0.12 + Math.random() * 0.15);
  if (sand) hiss(ctx, o, t + 0.25, 1.6, 'bandpass', 2400, 0.6, 0.18, 0.4); // sand falling back
}

export function gravitonShotVoice(ctx: BaseAudioContext, o: AudioNode, t: number) {
  tone(ctx, o, t, 1.3, 'sine', 95, 22, 1, 0.03); // the drop
  tone(ctx, o, t, 0.9, 'triangle', 190, 44, 0.25, 0.03);
  // The tear: high partials, ring-modulated by a fast flutter, and noise sweeping down.
  const ring = ctx.createGain();
  ring.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(70, t);
  lfo.frequency.exponentialRampToValueAtTime(18, t + 0.7);
  lfo.connect(ring.gain);
  lfo.start(t);
  lfo.stop(t + 0.8);
  ring.connect(o);
  for (const [f, a] of [[4200, 0.09], [6150, 0.07], [7900, 0.05]] as const) tone(ctx, ring, t, 0.7, 'sine', f, f * 0.55, a, 0.004);
  const sweep = hiss(ctx, ring, t, 0.6, 'bandpass', 9000, 3, 0.5, 0.003);
  sweep.frequency.setValueAtTime(9000, t);
  sweep.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
}

export function gravitonImpactVoice(ctx: BaseAudioContext, o: AudioNode, t: number) {
  // The inhale: noise rising and opening, cut dead.
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(5000, t + 0.42);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.42);
  g.gain.linearRampToValueAtTime(0, t + 0.44);
  n.connect(bp).connect(g).connect(o);
  n.start(t, Math.random());
  n.stop(t + 0.5);
  const at = t + 0.44;
  tone(ctx, o, at, 0.9, 'sine', 70, 24, 1, 0.004); // thud
  hiss(ctx, o, at, 0.4, 'lowpass', 500, 0.7, 0.6, 0.002);
  // The hum, a low minor chord beating.
  for (const f of [55, 65.4, 82.4]) tone(ctx, o, at, 1.6, 'triangle', f, f * 0.97, 0.12, 0.05);
}

class GunSound {
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** A blaster shot: yours (`at` null) or someone else's at `at`, heard from `ear`. */
  blasterShot(at: P | null = null, ear: P | null = null) {
    const s = placed(at, ear, LEVEL.blasterShot, 15, 700, { duration: 0.55 });
    if (audio.ctx && s) blasterShotVoice(audio.ctx, s.input, s.t);
  }

  /** The blaster's burst at `at`, heard from `ear`; `sand`: on the dunes. */
  blast(at: P, ear: P, sand: boolean) {
    const s = placed(at, ear, LEVEL.blast, BLAST_REF, 1000, { duration: 2 });
    if (audio.ctx && s) blastVoice(audio.ctx, s.input, s.t, sand);
  }

  /** A graviton shot: yours (`at` null) or someone else's at `at`, heard from `ear`. */
  gravitonShot(at: P | null = null, ear: P | null = null) {
    const s = placed(at, ear, LEVEL.gravitonShot, 15, 700, { duration: 1.4 });
    if (audio.ctx && s) gravitonShotVoice(audio.ctx, s.input, s.t);
  }

  /** The graviton beam's end caving in at `at`, heard from `ear`. */
  gravitonImpact(at: P, ear: P) {
    const s = placed(at, ear, LEVEL.gravitonImpact, GRAV_REF, 600, { duration: 2.1 });
    if (audio.ctx && s) gravitonImpactVoice(audio.ctx, s.input, s.t);
  }

  /** The heavy cell recharging over `s` seconds: a grinding whine rising and opening up, then the latch. Yours only. */
  recharge(s: number) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const t = ctx.currentTime + 0.12;
    if (this.charge) {
      this.charge.gain.gain.cancelScheduledValues(ctx.currentTime);
      this.charge.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
      this.charge.osc.stop(ctx.currentTime + 0.1);
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + s);
    // A slow wobble on it, quickening as it fills.
    const wob = ctx.createOscillator(), wobGain = ctx.createGain();
    wob.frequency.setValueAtTime(6, t);
    wob.frequency.linearRampToValueAtTime(22, t + s);
    wobGain.gain.value = 6;
    wob.connect(wobGain).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + s);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(LEVEL.recharge, t + s * 0.5);
    gain.gain.setTargetAtTime(0, t + s, 0.02);
    osc.connect(lp).connect(gain).connect(out);
    osc.start(t);
    wob.start(t);
    osc.stop(t + s + 0.2);
    wob.stop(t + s + 0.2);
    this.charge = { osc, gain };
    // Ready: a heavy latch.
    const g = ctx.createGain();
    g.gain.value = LEVEL.recharge * 6;
    g.connect(out);
    tone(ctx, g, t + s, 0.08, 'square', 240, 120, 0.25, 0.001);
    hiss(ctx, g, t + s, 0.04, 'bandpass', 2600, 4, 0.6, 0.001);
  }
}

export const gunSound = new GunSound();
