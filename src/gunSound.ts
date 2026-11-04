// Sounds of the heavy guns (shared/rifle.ts; src/rifle.ts fires them), all synthesised:
// - blasterShot: the laser pulse the rifle, pistol and guardians' cannon share, pitched down (src/rifleSound.ts
//   `blaster`).
// - blast / explosion: where the blaster's plasma bolt lands, the same explosion as a guardian's missile: the bolt
//   boom (src/guardianSound.ts) under a low firework burst (missile.blast, src/audioConfig.ts), carried far through src/acoustics.ts.
// - blasterRecharge: the heavy cell's slow, grinding whine back up between shots (much longer than the rifle's), and a
//   heavy latch when it's ready: yours only.
// - gravitonShot: a deep sub-bass drop under a high tearing shimmer, as if the air were ripped.
// - gravitonImpact: the end point caving in: a rushing inhale that stops dead, then a deep thud and a ringing low hum.
// - piercerShot: the rail gun letting go: a huge supersonic crack, a deep thump in the chest, the rails ringing, and a
//   long rolling echo off the dunes rumbling away over a couple of seconds (on top of the echoes off rock that
//   src/acoustics.ts adds).
// - piercerImpact: where the slug stops: on plate a metallic punch (a hard clang of inharmonic partials over a thump,
//   torn metal hissing after); on the sand a dull thud and grains falling back; on rock or concrete a sharp crack.
// - piercerCharge: the capacitors winding up through the whole long reload, a thin rising whine with a beat in it, and
//   the next slug sliding in with a heavy clack: yours only.
// Everything is placed through src/acoustics.ts and the shared output (src/audio.ts), every level ramped. Levels are
// calibrated in the full browser mix (docs/audio.md, the `blaster`, `graviton` and `piercer` scenarios of
// tools/audio-bench.ts).
import { audio } from './audio';
import { placed, type P } from './acoustics';
import { rifleSound } from './rifleSound';
import { guardianSound } from './guardianSound';
import { play } from './samples';

/** Each sound's level (into src/acoustics.ts `placed`), calibrated in the full mix (docs/audio.md). */
const LEVEL = { recharge: 0.012, gravitonShot: 0.2, gravitonImpact: 0.33, piercerShot: 0.37, piercerImpact: 0.5, piercerCharge: 0.005 };
/** Full level within this many metres. */
const GRAV_REF = 18, PIERCE_REF = 12;

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

export function piercerShotVoice(ctx: BaseAudioContext, o: AudioNode, t: number) {
  hiss(ctx, o, t, 0.05, 'highpass', 2600, 0.7, 1, 0.0005); // the crack: the slug through the sound barrier
  hiss(ctx, o, t, 0.16, 'bandpass', 1400, 0.9, 0.7, 0.001);
  tone(ctx, o, t, 0.55, 'sine', 120, 30, 1, 0.003); // the thump
  hiss(ctx, o, t, 0.4, 'lowpass', 420, 0.8, 0.8, 0.002);
  // The rails ringing: a few inharmonic partials, dying away.
  for (const [f, a] of [[612, 0.07], [1484, 0.05], [2371, 0.035], [3922, 0.02]] as const) tone(ctx, o, t, 0.9, 'triangle', f, f * 0.985, a, 0.002);
  // The roll: the crack thrown back by dune after dune, ever later, duller and softer, rumbling away.
  for (let i = 0; i < 9; i++) {
    const at = t + 0.18 + i * (0.16 + i * 0.03) + Math.random() * 0.06, k = Math.pow(0.8, i);
    hiss(ctx, o, at, 0.35 + i * 0.06, 'lowpass', 1800 * Math.pow(0.78, i) + 160, 0.5, 0.75 * k, 0.01 + i * 0.006);
  }
  hiss(ctx, o, t + 0.12, 3, 'lowpass', 260, 0.6, 1.1, 0.3); // the rumble under it all
}

export function piercerImpactVoice(ctx: BaseAudioContext, o: AudioNode, t: number, on: 'sand' | 'hard' | 'enemy') {
  if (on === 'enemy') {
    // Plate: a hard clang over a thump, and the torn metal hissing, bits of it pattering down.
    tone(ctx, o, t, 0.35, 'sine', 160, 50, 0.9, 0.001);
    hiss(ctx, o, t, 0.05, 'highpass', 2000, 0.7, 0.9, 0.0005);
    for (const [f, a] of [[431, 0.22], [1167, 0.16], [1893, 0.12], [2960, 0.08], [4410, 0.05]] as const) {
      tone(ctx, o, t, 0.7 + Math.random() * 0.4, 'square', f * (0.97 + Math.random() * 0.06), f * 0.96, a * 0.5, 0.0008);
    }
    const tear = hiss(ctx, o, t + 0.02, 0.5, 'bandpass', 5200, 2.5, 0.35, 0.004);
    tear.frequency.setValueAtTime(5200, t + 0.02);
    tear.frequency.exponentialRampToValueAtTime(1600, t + 0.52);
    for (let i = 0; i < 6; i++) hiss(ctx, o, t + 0.25 + Math.random() * 0.8, 0.04 + Math.random() * 0.05, 'bandpass', 2500 + Math.random() * 3500, 7, 0.1 + Math.random() * 0.12);
  } else if (on === 'sand') {
    tone(ctx, o, t, 0.4, 'sine', 95, 35, 0.9, 0.003);
    hiss(ctx, o, t, 0.3, 'lowpass', 600, 0.7, 0.8, 0.003);
    hiss(ctx, o, t + 0.04, 0.9, 'bandpass', 2600, 0.6, 0.25, 0.08); // grains falling back
  } else {
    hiss(ctx, o, t, 0.06, 'highpass', 2200, 0.7, 0.9, 0.0005);
    tone(ctx, o, t, 0.3, 'sine', 140, 45, 0.7, 0.002);
    for (let i = 0; i < 5; i++) hiss(ctx, o, t + 0.08 + Math.random() * 0.5, 0.04 + Math.random() * 0.04, 'bandpass', 1500 + Math.random() * 2500, 5, 0.12 + Math.random() * 0.12);
  }
}

class GunSound {
  private charge: { osc: OscillatorNode; gain: GainNode; more?: OscillatorNode[] } | null = null;

  /** A piercer shot: yours (`at` null) or someone else's at `at`, heard from `ear`. It carries far. */
  piercerShot(at: P | null = null, ear: P | null = null) {
    const s = placed(at, ear, LEVEL.piercerShot, 20, 1200, { duration: 3.2 });
    if (audio.ctx && s) piercerShotVoice(audio.ctx, s.input, s.t);
  }

  /** The piercer's slug stopping at `at` on `on`, heard from `ear`. */
  piercerImpact(at: P, ear: P, on: 'sand' | 'hard' | 'enemy') {
    const s = placed(at, ear, LEVEL.piercerImpact, PIERCE_REF, 600, { duration: 1.2 });
    if (audio.ctx && s) piercerImpactVoice(audio.ctx, s.input, s.t, on);
  }

  /** The piercer's capacitors winding up over `s` seconds, a thin rising whine with a beat in it, then the next slug
   *  sliding in and the breech clacking shut. Yours only. */
  piercerCharge(s: number) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const t = ctx.currentTime + 0.25;
    this.stopCharge(ctx);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(LEVEL.piercerCharge * 0.4, t + s * 0.3);
    gain.gain.linearRampToValueAtTime(LEVEL.piercerCharge, t + s);
    gain.gain.setTargetAtTime(0, t + s, 0.03);
    gain.connect(out);
    const oscs: OscillatorNode[] = [];
    // Two sines a little apart (the beat quickening as they climb) and a faint octave.
    for (const [mul, a] of [[1, 1], [1.012, 0.8], [2, 0.25]] as const) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.setValueAtTime(380 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(3400 * mul, t + s);
      g.gain.value = a;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + s + 0.25);
      oscs.push(osc);
    }
    this.charge = { osc: oscs[0], gain, more: oscs.slice(1) };
    // Ready: the slug slides in and the breech clacks shut.
    const g = ctx.createGain();
    g.gain.value = LEVEL.piercerCharge * 10;
    g.connect(out);
    const slide = hiss(ctx, g, t + s - 0.16, 0.14, 'bandpass', 1300, 2, 0.25, 0.05);
    slide.frequency.setValueAtTime(1300, t + s - 0.16);
    slide.frequency.exponentialRampToValueAtTime(2600, t + s - 0.02);
    tone(ctx, g, t + s, 0.1, 'square', 180, 90, 0.3, 0.001);
    hiss(ctx, g, t + s, 0.05, 'bandpass', 3200, 5, 0.7, 0.0005);
  }

  /** Cut a recharge still going (a new shot, or another gun's). */
  private stopCharge(ctx: AudioContext) {
    if (!this.charge) return;
    this.charge.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.charge.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    for (const o of [this.charge.osc, ...(this.charge.more ?? [])]) o.stop(ctx.currentTime + 0.1);
    this.charge = null;
  }

  /** A blaster shot: yours (`at` null) or someone else's at `at`, heard from `ear`. */
  blasterShot(at: P | null = null, ear: P | null = null) {
    rifleSound.blaster(at, ear);
  }

  /** The blaster's plasma bolt bursting at `at`, heard from `ear`: a missile's explosion. */
  blast(at: P, ear: P) {
    this.explosion(at, ear);
  }

  /** A missile-sized explosion at `at`, heard from `ear`: the bolt boom under a low firework. */
  explosion(at: P, ear: P) {
    guardianSound.boom(at.x, at.y, at.z, ear);
    play('missile.blast', at, ear);
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
    this.stopCharge(ctx);
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
