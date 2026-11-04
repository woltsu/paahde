// Sounds of the colossus (shared/colossus.ts), synthesised, through src/acoustics.ts (late by the distance, duller and
// more reverb further off) and the shared output (src/audio.ts: master gain and limiter):
// - footfall: a foot landing is a guardian's footfall made huge: a sub boom sweeping 40 → 14 Hz, a long low rumble
//   of sand, the iron joints clanking as they take the weight; heard out to the event's `hear` (well before it's seen over
//   the dunes). The big stomp's is heavier still, with a crack and a walker's hull-slam on top.
// - lift: the hydraulics hiss as a foot comes up (a sigh of steam), louder for the big stomp.
// - tell: the big stomp held overhead: a rising steam shriek and a servo groan for as long as it hangs there.
// - salvo (against a crowd): a klaxon from the shoulder pods as they open, a roar per launch, and a falling whistle
//   over each missile's landing spot before it hits (the burst is a bolt's boom, src/guardianSound.ts).
// - charge: an arm coming up to point for a hand volley: a servo groan and a whine rising as the palm heats (its
//   rockets then launch, whistle and burst like the salvo's).
// - engine: while it's near, a slow, deep furnace drone with a throb, following it; louder when it hunts.
// - dying: a falling groan as the furnace fails; collapse: the body hitting the sand, several slams and a long rumble.
// Levels are set against the guardians' (src/guardianSound.ts, measured there): a step here at 25 m about as loud as a
// guardian's at 12 m and a little more (one-shots may poke above the mix); the engine bed well under the mix.
import { audio } from './audio';
import type { P } from './acoustics';
import { defineSynth, play } from './sounds';
import { rifleSound } from './rifleSound';

/** The engine drone: heard within ENGINE_HEAR, full within ENGINE_REF (1/d past it). */
const ENGINE_HEAR = 900;
const ENGINE_REF = 40;
const ENGINE_GAIN = 0.1;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** Filtered noise from t, `len` s, rising in `a` to `peak` and decaying. */
function hiss(ctx: BaseAudioContext, to: AudioNode, t: number, len: number, type: BiquadFilterType, f: number, q: number, peak: number, a = 0.01) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  n.loop = true;
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

/** An oscillator from t: f0 → f1 over `len`, decaying from `peak`. */
function tone(ctx: BaseAudioContext, to: AudioNode, t: number, len: number, type: OscillatorType, f0: number, f1: number, peak: number, a = 0.01) {
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

type Engine = { srcs: AudioScheduledSourceNode[]; gain: GainNode; lp: BiquadFilterNode; panner: PannerNode };

class ColossusSound {
  private eng: Engine | null = null;

  /** A foot landed at (x, y, z), `weight` 0..1 (more for the big stomp, with a walker's hull-slam on top). */
  footfall(x: number, y: number, z: number, weight: number, ear: P, big: boolean) {
    play(big ? 'colossus.stomp' : 'colossus.footfall', { x, y, z }, ear, { level: Math.min(1.5, weight) });
    if (big) rifleSound.slam({ x, y, z }, ear, true);
  }

  /** A foot lifts: hydraulics venting (from up at the knee). */
  lift(x: number, y: number, z: number, ear: P, big: boolean) {
    play(big ? 'colossus.liftBig' : 'colossus.lift', { x, y: y + 20, z }, ear);
  }

  /** The big stomp hangs over its prey for `len` s: a steam shriek rising, a servo groan. */
  tell(x: number, y: number, z: number, ear: P, len: number) {
    play('colossus.tell', { x, y, z }, ear, { arg: len });
  }

  /** An arm comes up to point for a hand volley (`len` s till the first rocket). */
  charge(x: number, y: number, z: number, ear: P, len: number) {
    play('colossus.charge', { x, y, z }, ear, { arg: len });
  }

  /** The shoulder pods open for a salvo (`len` s till the first launch): a two-tone klaxon. */
  klaxon(x: number, y: number, z: number, ear: P, len: number) {
    play('colossus.klaxon', { x, y, z }, ear, { arg: len });
  }

  /** A missile leaves its pod. */
  launch(x: number, y: number, z: number, ear: P) {
    play('colossus.launch', { x, y, z }, ear);
  }

  /** A missile coming down on (x, y, z) in `len` s: a whistle falling in pitch (from above it). */
  incoming(x: number, y: number, z: number, ear: P, len: number) {
    if (len > 0.05) play('colossus.incoming', { x, y: y + 15, z }, ear, { arg: len });
  }


  /** Its furnace drone at (x, y, z) every frame while drawn (`speed` 0..1, `angry` hunting); `off` fades it out. */
  engine(x: number, y: number, z: number, ear: P | null, speed: number, angry: boolean, off = false) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const d = ear ? Math.hypot(x - ear.x, y - ear.y, z - ear.z) : Infinity;
    if (off || d > ENGINE_HEAR) {
      if (this.eng) {
        const e = this.eng;
        this.eng = null;
        e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        for (const s of e.srcs) s.stop(ctx.currentTime + 2);
      }
      return;
    }
    if (!this.eng) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = ENGINE_REF;
      panner.rolloffFactor = 1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      lp.connect(gain).connect(panner).connect(out);
      const srcs: AudioScheduledSourceNode[] = [];
      for (const f of [27.5, 27.9, 41.2]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
        srcs.push(o);
      }
      // The furnace's roar: low noise, throbbing.
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      n.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = 0.8;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(ng.gain);
      n.connect(ng).connect(lp);
      n.start();
      lfo.start();
      srcs.push(n, lfo);
      this.eng = { srcs, gain, lp, panner };
    }
    const e = this.eng, t = ctx.currentTime;
    e.panner.positionX.setTargetAtTime(x, t, 0.1);
    e.panner.positionY.setTargetAtTime(y, t, 0.1);
    e.panner.positionZ.setTargetAtTime(z, t, 0.1);
    const edge = Math.min(1, (ENGINE_HEAR - d) / (ENGINE_HEAR * 0.3));
    e.gain.gain.setTargetAtTime(ENGINE_GAIN * edge * (0.7 + 0.3 * Math.min(1, speed)) * (angry ? 1.4 : 1), t, 0.3);
    e.lp.frequency.setTargetAtTime(angry ? 240 : 160, t, 0.5);
  }

  /** Its last weak point broke: the furnace dies with a long falling groan. */
  dying(x: number, y: number, z: number, ear: P) {
    play('colossus.dying', { x, y, z }, ear);
  }

  /** It hits the sand along its length, hull-slams all along it. */
  collapse(x: number, y: number, z: number, ear: P) {
    play('colossus.collapse', { x, y, z }, ear);
    for (let i = 0; i < 3; i++) rifleSound.slam({ x: x + (Math.random() - 0.5) * 40, y, z: z + (Math.random() - 0.5) * 40 }, ear, true);
  }
}

export const colossusSound = new ColossusSound();


// The one-shots, as synths (src/audioConfig.ts SYNTHS), played by their colossus.* events, which hold their levels and
// reach. `arg`: 'big' for the big stomp's foot and lift; seconds for the tell, charge, klaxon and incoming whistle.
const secs = (arg: number | string | undefined, d: number) => (typeof arg === 'number' && arg > 0 ? arg : d);

// A foot landing: a sub boom, a long low rumble of sand, iron joints clanking; the big stomp's heavier, with a crack.
defineSynth('colossus-foot', {
  length: (m) => (m.arg === 'big' ? 3.3 : 2.3),
  voice(ctx, o, t, m) {
    const big = m.arg === 'big';
    tone(ctx, o, t, big ? 2.2 : 1.5, 'sine', big ? 46 : 40, 14, 1);
    tone(ctx, o, t, 0.5, 'triangle', 70, 30, 0.35);
    hiss(ctx, o, t, big ? 3.2 : 2.2, 'lowpass', 170, 0.7, 0.9, 0.03);
    hiss(ctx, o, t + 0.02, 0.9, 'bandpass', 420, 1.2, 0.25);
    // Iron joints taking the weight: a couple of deep clanks just after.
    for (let i = 0; i < 2; i++) hiss(ctx, o, t + 0.08 + i * 0.13 + Math.random() * 0.05, 0.5, 'bandpass', 260 + Math.random() * 260, 14, 0.55);
    if (big) hiss(ctx, o, t, 0.25, 'highpass', 1800, 0.7, 0.4, 0.002); // the crack of it
  },
});

// A foot lifting: hydraulics venting, a sigh of steam (longer for the big stomp's).
defineSynth('colossus-lift', {
  length: (m) => (m.arg === 'big' ? 1.5 : 1),
  voice(ctx, o, t, m) {
    const bp = hiss(ctx, o, t, m.arg === 'big' ? 1.4 : 0.9, 'bandpass', 2600, 1.4, 1, 0.12);
    bp.frequency.setValueAtTime(3400, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.9);
  },
});

// The big stomp held overhead for arg s: a steam shriek rising, a servo groan.
defineSynth('colossus-tell', {
  length: (m) => secs(m.arg, 2) + 0.6,
  voice(ctx, o, t, m) {
    const len = secs(m.arg, 2);
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0, t + len + 0.1);
    n.connect(bp).connect(g).connect(o);
    n.start(t, Math.random());
    n.stop(t + len + 0.2);
    const groan = ctx.createOscillator();
    groan.type = 'sawtooth';
    groan.frequency.setValueAtTime(48, t);
    groan.frequency.linearRampToValueAtTime(62, t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(0.5, t + 0.3);
    gg.gain.setTargetAtTime(0, t + len, 0.08);
    groan.connect(lp).connect(gg).connect(o);
    groan.start(t);
    groan.stop(t + len + 0.6);
  },
});

// An arm coming up to point a hand volley, arg s till the first rocket: a servo groan, the palm's whine rising.
defineSynth('colossus-charge', {
  length: (m) => secs(m.arg, 1.5) + 1,
  voice(ctx, o, t, m) {
    const len = secs(m.arg, 1.5);
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    whine.frequency.setValueAtTime(260, t);
    whine.frequency.exponentialRampToValueAtTime(1500, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + len * 0.9);
    g.gain.setTargetAtTime(0, t + len, 0.05);
    whine.connect(g).connect(o);
    whine.start(t);
    whine.stop(t + len + 0.4);
    const bp = hiss(ctx, o, t, 0.9, 'bandpass', 1800, 1.4, 0.6, 0.1);
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(1200, t + 0.8);
    tone(ctx, o, t, 0.8, 'sawtooth', 55, 70, 0.4);
  },
});

const klaxonBeats = (arg: number | string | undefined) => Math.max(2, Math.round(secs(arg, 2) / 0.4));

// The shoulder pods opening for a salvo, arg s till the first launch: a two-tone klaxon blaring.
defineSynth('colossus-klaxon', {
  length: (m) => klaxonBeats(m.arg) * 0.4 + 0.3,
  voice(ctx, o, t, m) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    bp.connect(g).connect(o);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const beats = klaxonBeats(m.arg);
    for (let i = 0; i < beats; i++) {
      const tb = t + i * 0.4;
      osc.frequency.setValueAtTime(i % 2 ? 420 : 560, tb);
      g.gain.setValueAtTime(0, tb);
      g.gain.linearRampToValueAtTime(0.6, tb + 0.03);
      g.gain.setTargetAtTime(0, tb + 0.3, 0.03);
    }
    osc.connect(bp);
    osc.start(t);
    osc.stop(t + beats * 0.4 + 0.3);
  },
});

// A missile leaving its pod: a cough of the motor lighting, then a tearing roar fading as it climbs.
defineSynth('colossus-launch', {
  length: 1.7,
  voice(ctx, o, t) {
    tone(ctx, o, t, 0.35, 'sine', 110, 40, 0.8);
    const bp = hiss(ctx, o, t, 1.6, 'bandpass', 900, 0.8, 0.9, 0.03);
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 1.4);
    hiss(ctx, o, t, 0.12, 'highpass', 2500, 0.7, 0.5, 0.002);
  },
});

// A missile coming down in arg s: a whistle falling in pitch.
defineSynth('colossus-incoming', {
  length: (m) => secs(m.arg, 1.5) + 0.1,
  voice(ctx, o, t, m) {
    const len = secs(m.arg, 1.5);
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 18;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + len * 0.9);
    g.gain.linearRampToValueAtTime(0, t + len + 0.02);
    n.connect(bp).connect(g).connect(o);
    n.start(t, Math.random());
    n.stop(t + len + 0.1);
  },
});

// The furnace dying: a long falling groan.
defineSynth('colossus-dying', {
  length: 4.6,
  voice(ctx, o, t) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 4);
    lp.connect(o);
    for (const f of [55, 56.5, 82]) tone(ctx, lp, t, 4.5, 'sawtooth', f, f * 0.45, 0.35, 0.2);
    hiss(ctx, o, t, 3, 'bandpass', 2400, 2, 0.25, 0.05);
  },
});

// Hitting the sand along its length: a deep boom, a long rumble, debris clanking down.
defineSynth('colossus-collapse', {
  length: 5.1,
  voice(ctx, o, t) {
    tone(ctx, o, t, 3, 'sine', 38, 12, 1);
    hiss(ctx, o, t, 5, 'lowpass', 200, 0.7, 1, 0.08);
    for (let i = 0; i < 10; i++) hiss(ctx, o, t + 0.1 + Math.random() * 1.6, 0.4, 'bandpass', 250 + Math.random() * 500, 12, 0.4);
  },
});
