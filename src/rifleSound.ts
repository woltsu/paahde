// Sounds of the laser rifle (src/rifle.ts) and of what it does to the walkers:
// - shot: one of three pulses cut from Defunct3's "Pulse laser" (CC0, public/credits.txt; laser-1..3.mp3, mono,
//   0.40–0.55 s, each levelled to −18.5 LUFS momentary, true peak ≤ −1.5 dBTP), picked at random and a little
//   off pitch each time; the pistol plays them higher and lighter. Your own is dry and in your head; another
//   player's carries across the desert (src/acoustics.ts: late, duller, softer and more reverb with distance). A
//   guardian's cannon fires the same pulses an octave down (cannon.shot), slower and heavier: −15 LUFS momentary
//   max within its `ref` (peaks about 0 dBFS: the limiter takes them), −21 at 80 m. The blaster fires them a
//   fifth or so down (blaster.shot): heavier than the rifle, lighter than the cannon.
// - A weak point shattering, a drone crashing, a missile's blast and the like burst like a firework (TB0Y298's
//   "Firework Explosion" 1–4, CC BY 4.0): events of their own, played where they happen.
// The rest is synthesised (synths defined here, src/audioConfig.ts SYNTHS):
// - rifle-charge: the cell whining back up between shots, with a click when it's ready.
// - beam-impact: where the beam struck: a hiss of sand, a metal ping, or the red glass of a weak point shattering with
//   an electric fizz.
// - thrown scrap (src/throw.ts): the swish of the throw, and a dull clank as it strikes a drone.
// - a dying walker: servos winding down with a clunk as each leg gives out, then the crash of the hull on the sand.
// Every level, pitch and reach is its event's in src/audioConfig.ts. Shots are calibrated in the complete browser mix,
// including simultaneous players, footsteps, warnings, music and the master limiter (docs/audio.md); the source
// assets' levels alone do not predict that mix.
import type { P } from './acoustics';
import { defineSynth, play, type Voice } from './sounds';

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** Filtered noise from t for `len` s: attack `a`, exponential decay. */
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

/** An oscillator from t: frequency f0 → f1 over `len`, exponential decay from `peak`. */
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

const chargeS = (arg: number | string | undefined) => (typeof arg === 'number' ? Math.max(0.05, arg) : 0.5);

// The cell recharging over arg s, then a click.
defineSynth('rifle-charge', {
  length: (o) => chargeS(o.arg) + 0.2,
  voice(ctx, out, t, o) {
    const s = chargeS(o.arg);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(1700, t + s);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + s * 0.6);
    gain.gain.setTargetAtTime(0, t + s, 0.015);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + s + 0.2);
    // Ready: the click, as loud as when it was 0.25 against the whine's 0.035.
    const g = ctx.createGain();
    g.gain.value = 0.25 / 0.035;
    g.connect(out);
    hiss(ctx, g, t + s, 0.03, 'bandpass', 3200, 6, 0.6, 0.001);
  },
});

// Where the beam struck: arg 'sand', 'metal' or 'glass' (a weak point).
defineSynth('beam-impact', {
  length: (o) => (o.arg === 'sand' ? 0.45 : o.arg === 'glass' ? 1 : 0.9),
  voice(ctx, o, t, m) {
    if (m.arg === 'sand') {
      hiss(ctx, o, t, 0.35, 'bandpass', 1800, 0.8, 0.5);
      tone(ctx, o, t, 0.1, 'sine', 160, 60, 0.4);
      return;
    }
    // Metal: a ping of a few inharmonic partials.
    for (const [f, a] of [[1870, 0.25], [3120, 0.16], [4650, 0.1]] as const) tone(ctx, o, t, 0.5 + Math.random() * 0.3, 'sine', f * (0.95 + Math.random() * 0.1), f * 0.98, a);
    hiss(ctx, o, t, 0.08, 'highpass', 3000, 0.7, 0.4);
    if (m.arg !== 'glass') return;
    // Glass: a crunch, then shards tinkling, and the electrics fizzing out.
    hiss(ctx, o, t, 0.18, 'bandpass', 2400, 1.2, 1.0, 0.001);
    for (let i = 0; i < 9; i++) hiss(ctx, o, t + 0.03 + Math.random() * 0.35, 0.05 + Math.random() * 0.06, 'bandpass', 4000 + Math.random() * 5000, 8, 0.4 * Math.random() + 0.1);
    const fizz = hiss(ctx, o, t + 0.02, 0.9, 'bandpass', 6000, 2, 0.35, 0.02);
    fizz.frequency.setValueAtTime(6000, t);
    fizz.frequency.exponentialRampToValueAtTime(1500, t + 0.9);
    tone(ctx, o, t, 0.6, 'square', 110, 55, 0.08, 0.01);
  },
});

// Something thrown: a short swish of air.
defineSynth('swish', {
  length: 0.35,
  voice(ctx, o, t) {
    const bp = hiss(ctx, o, t, 0.28, 'bandpass', 700, 1.4, 0.45, 0.06);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.28);
  },
});

// Thrown junk striking a drone: a heavy clank, lower and duller than a beam's ping.
defineSynth('clank', {
  length: 0.6,
  voice(ctx, o, t) {
    tone(ctx, o, t, 0.12, 'triangle', 190, 90, 0.5);
    for (const [f, a] of [[640, 0.22], [1130, 0.14], [1790, 0.08]] as const) tone(ctx, o, t, 0.35 + Math.random() * 0.2, 'sine', f * (0.94 + Math.random() * 0.12), f * 0.97, a);
    hiss(ctx, o, t, 0.1, 'bandpass', 2200, 0.9, 0.45);
  },
});

// A walker's leg giving out: a servo winding down and a clunk; arg 'light' (a crawler: higher and quicker) or not.
defineSynth('leg-fail', {
  length: (m) => (m.arg === 'light' ? 0.6 : 1),
  voice(ctx, o, t, m) {
    const k = m.arg === 'light' ? 2.6 : 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 * k;
    lp.connect(o);
    tone(ctx, lp, t, 0.8 / k, 'sawtooth', 420 * k, 45 * k, 0.3, 0.02);
    tone(ctx, lp, t, 0.8 / k, 'sawtooth', 433 * k, 47 * k, 0.2, 0.02);
    hiss(ctx, o, t + 0.55 / k, 0.4, 'bandpass', 600 * k, 6, 0.6);
    tone(ctx, o, t + 0.55 / k, 0.3, 'sine', 90 * k, 40 * k, 0.6);
  },
});

// A dead walker's hull (or a drone, a plane's piece) hitting the sand; arg 'light' (small: higher and shorter) or not.
defineSynth('hull-slam', {
  length: (m) => (m.arg === 'light' ? 1 : 1.9),
  voice(ctx, o, t, m) {
    const k = m.arg === 'light' ? 2.4 : 1;
    tone(ctx, o, t, 1.4 / k, 'sine', 50 * k, 20 * k, 1, 0.01);
    hiss(ctx, o, t, 1.8 / k, 'lowpass', 300 * k, 0.6, 0.9, 0.01);
    // Plates and struts clattering down after it.
    for (let i = 0; i < 6; i++) hiss(ctx, o, t + 0.05 + Math.random() * 0.6 / k, 0.25, 'bandpass', (500 + Math.random() * 900) * k, 10, 0.35);
  },
});

class RifleSound {
  private charge: Voice | null = null;

  /** A shot: yours (`at` null) or someone else's at `at`, heard from `ear`. `pistol`: the laser pistol's, higher,
   *  shorter and lighter. */
  shot(at: P | null = null, ear: P | null = null, pistol = false) {
    play(pistol ? 'pistol.shot' : 'rifle.shot', at, ear);
  }

  /** A blaster shot: yours (`at` null) or someone else's at `at`, heard from `ear`: the pulse pitched down, heavier. */
  blaster(at: P | null = null, ear: P | null = null) {
    play('blaster.shot', at, ear);
  }

  /** A guardian's cannon firing at `at`, heard from `ear` (src/guardians.ts): a rifle shot an octave down. */
  cannon(at: P, ear: P) {
    play('cannon.shot', at, ear);
  }

  /** The cell recharging over `s` seconds, then a click: yours only. */
  recharge(s: number) {
    this.charge?.stop(0.015);
    this.charge = play('rifle.charge', null, null, { arg: s, delay: 0.05 });
  }

  /** Where the beam struck: sand, metal, or a weak point's glass. */
  impact(what: 'sand' | 'metal' | 'glass', at: P, ear: P) {
    play(`beam.${what}`, at, ear);
  }

  /** Something thrown: a short swish of air, yours (`at` null) or someone else's. */
  swish(at: P | null = null, ear: P | null = null) {
    play('throw.swish', at, ear);
  }

  /** Thrown junk striking a drone. */
  clank(at: P, ear: P) {
    play('throw.clank', at, ear);
  }

  /** A walker's leg giving out (`heavy`: a guardian). */
  fail(at: P, ear: P, heavy: boolean) {
    play(heavy ? 'legFail.heavy' : 'legFail.light', at, ear);
  }

  /** A dead walker's hull hitting the sand. */
  slam(at: P, ear: P, heavy: boolean) {
    play(heavy ? 'slam.heavy' : 'slam.light', at, ear);
  }
}

export const rifleSound = new RifleSound();
