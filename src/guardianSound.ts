// Sounds of the guardians and drones (shared/guardians.ts), synthesised:
// - footfall: each landing foot is a deep thump (a sine sweeping 55 → 24 Hz), a low rumble of noise and a
//   short metal clank, placed at the foot in 3D and heard late by the distance at the speed of sound, duller
//   further off. Hundreds of metres away you hear them before you see them land; it sells the size.
// - horn: a guardian starting to hunt you sounds a low brass blare (detuned saws through a low-pass).
// - crawlers: a chitter when one comes for you, a quickening rattle as it crouches to lunge, a snap when it bites.
// - drones: the nearest few buzz where they hover (rotor saw + whine); one locking on to you gives a short
//   rising double chirp, once (not a siren: the beam and the HUD say the rest).
// - missiles: a rocket's roar flying with each one (looped noise: a low rumble and a jet's hiss, fluttering), louder
//   and brighter as it closes on you and pitched up by its approach (softened Doppler); the blast cuts it.
// - jets: the fixed-wing drones (shared/jets.ts) roar the same way, deeper, with a turbine's whine, heard kilometres
//   off and from where the plane was when the sound left it (it lags well behind a fast one overhead).
// Footfalls (and so the bolts' and missiles' blasts) and the cannon carry across the desert through src/acoustics.ts.
// The Web Audio listener follows the camera (src/crashSound.ts sets it). Through the shared output in
// src/audio.ts; levels ramped. Footfalls and their blasts are calibrated together with shots, music and warnings
// through the actual browser master/limiter, rather than summing isolated sample readings; see docs/audio.md.
import { audio } from './audio';
import { SPEED_OF_SOUND, type P } from './acoustics';
import { defineSynth, play } from './sounds';
import type { JetKind } from '../shared/jetbreak.ts';

/** Drone buzz within this distance (m), at most this many at once. */
const BUZZ_HEAR = 110;
const BUZZ_REF = 15;
const BUZZ_GAIN = 0.16;
const MAX_BUZZ = 3;
/** Missile roar: heard within ROAR_HEAR m, at most MAX_ROAR at once; full level within ROAR_REF (1/d past it); the
 *  hiss opens up from ROAR_FAR to ROAR_NEAR. Turbulence wobbles the level by ±FLUTTER. */
const ROAR_HEAR = 700;
const ROAR_REF = 30;
const ROAR_FAR = 300;
const ROAR_NEAR = 40;
const ROAR_GAIN = 0.25;
const ROAR_RUMBLE = 2.5;
const FLUTTER = 0.3;
const MAX_ROAR = 4;
/** Jet roar: heard within JET_HEAR m, full level within JET_REF (1/d past it), the hiss and whine opening up from
 *  JET_FAR to JET_NEAR; air dulls it more slowly than a missile's (it's bigger and louder). */
const JET_HEAR = 3500;
const JET_REF = 150;
const JET_FAR = 1500;
const JET_NEAR = 200;
const JET_GAIN = 0.3;
const JET_WHINE = 0.05;
const MAX_JET = 2;
/** The fixed-wing drone (JetKind 'drone') is smaller than the stealth wing: −6 dB, and heard only within this far (m). */
const DRONE_JET_GAIN = 0.5;
const DRONE_JET_HEAR = 2200;

type Buzz = { id: number; osc: OscillatorNode; whine: OscillatorNode; gain: GainNode; panner: PannerNode };
type Roar = { srcs: AudioBufferSourceNode[]; gain: GainNode; hiss: GainNode; air: BiquadFilterNode; panner: PannerNode; whine?: OscillatorNode };

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function panner(ctx: AudioContext, x: number, y: number, z: number, ref: number) {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.rolloffFactor = 1;
  p.positionX.value = x;
  p.positionY.value = y;
  p.positionZ.value = z;
  return p;
}

// The one-shots are synths (src/audioConfig.ts SYNTHS, defined here), played by their events, which hold their levels
// and reach; the continuous sounds (drones' buzz, missiles' and jets' roar) are still made and levelled here.

/** A guardian's foot (or anything as heavy) coming down: a thump, rumble and sand, the joints clanking. */
function footfallVoice(ctx: BaseAudioContext, air: AudioNode, t: number) {
  // Thump.
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(55, t);
  o.frequency.exponentialRampToValueAtTime(24, t + 0.5);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, t);
  og.gain.linearRampToValueAtTime(1, t + 0.01);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  o.connect(og).connect(air);
  o.start(t);
  o.stop(t + 1);
  // Rumble and sand.
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.9, t + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  n.connect(lp).connect(ng).connect(air);
  n.start(t, Math.random());
  n.stop(t + 1.5);
  // Clank of the joints taking the weight.
  const c = ctx.createBufferSource();
  c.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700 + Math.random() * 400;
  bp.Q.value = 9;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0, t + 0.04);
  cg.gain.linearRampToValueAtTime(0.5, t + 0.05);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  c.connect(bp).connect(cg).connect(air);
  c.start(t + 0.04, Math.random());
  c.stop(t + 0.5);
}

defineSynth('footfall', { length: 1.6, voice: (ctx, out, t) => footfallVoice(ctx, out, t) });
// A bolt's or missile's blast: a footfall's boom, twice over (the second at 0.8).
defineSynth('boom', {
  length: 1.6,
  voice(ctx, out, t) {
    footfallVoice(ctx, out, t);
    const g = ctx.createGain();
    g.gain.value = 0.8;
    g.connect(out);
    footfallVoice(ctx, g, t);
  },
});

// A crawler's foot: a dry little tick of claw on sand and metal.
defineSynth('crawler-tick', {
  length: 0.05,
  voice(ctx, out, t) {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500 + Math.random() * 2500;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001 / 0.12, t + 0.04); // (to 0.001 at the tick's old level, 0.12)
    n.connect(bp).connect(g).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.05);
  },
});

// A crawler crouching to lunge, springing arg s from now: a dry rattle, quickening and rising to the spring.
defineSynth('crawler-rattle', {
  length: (o) => Math.max(0, Number(o.arg) || 0) + 0.1,
  voice(ctx, p, t, m) {
    const s = Math.max(0, Number(m.arg) || 0);
    // Clicks closer and closer together right up to the spring, each a little higher and louder.
    for (let at = 0; at < s; at += 0.09 - 0.072 * (at / s)) {
      const k = at / s, when = t + at + Math.random() * 0.006;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1100 + 1400 * k + Math.random() * 300, when);
      o.frequency.exponentialRampToValueAtTime(500 + 400 * k, when + 0.025);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.6 + 0.8 * k, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.025);
      o.connect(g).connect(p);
      o.start(when);
      o.stop(when + 0.03);
    }
  },
});

// A runner's wreck waking, snapping its jaws arg s from now: a servo groaning up from the dead under a ratchet of its
// jaws drawing back, quickening to the snap.
defineSynth('runner-wake', {
  length: (o) => Math.max(0.1, Number(o.arg) || 1) + 0.1,
  voice(ctx, p, t, m) {
    const s = Math.max(0.1, Number(m.arg) || 1);
    // The groan: a low saw sliding up, its filter opening, swelling and cut off at the snap.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(150, t + s);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + s);
    lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(0.8, t + s - 0.02);
    g.gain.linearRampToValueAtTime(0, t + s + 0.03);
    o.connect(lp).connect(g).connect(p);
    o.start(t);
    o.stop(t + s + 0.05);
    // The ratchet: heavy clicks closer and closer together right up to the snap.
    for (let at = 0.05; at < s; at += 0.11 - 0.08 * (at / s)) {
      const k = at / s, when = t + at + Math.random() * 0.005;
      const c = ctx.createOscillator();
      c.type = 'square';
      c.frequency.setValueAtTime(700 + 600 * k + Math.random() * 150, when);
      c.frequency.exponentialRampToValueAtTime(220 + 200 * k, when + 0.03);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.5 + 0.5 * k, when);
      cg.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
      c.connect(cg).connect(p);
      c.start(when);
      c.stop(when + 0.035);
    }
  },
});

// A crawler going for you (arg 'bite': and getting you): a rattling chitter, or a snap of mandibles.
defineSynth('crawler-chitter', {
  length: (m) => (m.arg === 'bite' ? 0.2 : 0.37),
  voice(ctx, p, t, m) {
    const bite = m.arg === 'bite', n = bite ? 3 : 9;
    for (let i = 0; i < n; i++) {
      const at = t + i * (bite ? 0.05 : 0.035) + Math.random() * 0.01;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(bite ? 900 : 1800 + Math.random() * 900, at);
      o.frequency.exponentialRampToValueAtTime(bite ? 200 : 700, at + 0.03);
      const g = ctx.createGain();
      // (Decays to 0.001 at the chitter's old level, 0.05.)
      g.gain.setValueAtTime(1, at);
      g.gain.exponentialRampToValueAtTime(0.001 / 0.05, at + 0.03);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + 0.04);
    }
  },
});

// A guardian's cannon charging: a rising whine over arg s.
defineSynth('cannon-charge', {
  length: (m) => Math.max(0.05, Number(m.arg) || 1) + 0.1,
  voice(ctx, out, t, m) {
    const s = Math.max(0.05, Number(m.arg) || 1);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + s);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + s);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + s);
    g.gain.linearRampToValueAtTime(0, t + s + 0.05);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + s + 0.1);
  },
});

// A guardian has started hunting you: a low brass chord swelling and fading.
defineSynth('guardian-horn', {
  length: 4.5,
  voice(ctx, out, t) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.6);
    lp.frequency.linearRampToValueAtTime(300, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.4);
    g.gain.setTargetAtTime(0, t + 2.2, 0.4);
    lp.connect(g).connect(out);
    for (const f of [41, 41.6, 61.7, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 4.5);
    }
  },
});

// A drone locking on to you: two short rising chirps.
defineSynth('lock-chirp', {
  length: 0.45,
  voice(ctx, out, t0) {
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.16;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(900 + i * 300, t);
      o.frequency.exponentialRampToValueAtTime(1300 + i * 300, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.08, 0.02);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.25);
    }
  },
});

class GuardianSound {
  private buzz = new Map<number, Buzz>();
  private roar = new Map<number, Roar>();
  private jet = new Map<number, Roar>();

  /** A foot landed at (x, y, z), `weight` 0..1; the listener is at `ear`. */
  footfall(x: number, y: number, z: number, weight: number, ear: P) {
    play('guardian.footfall', { x, y, z }, ear, { level: weight });
  }

  /** A crawler's foot at (x, y, z): a dry little tick, heard close by. */
  tick(x: number, y: number, z: number, ear: P) {
    play('crawler.tick', { x, y, z }, ear);
  }

  /** A crawler at (x, y, z) crouches to lunge, springing `s` seconds from now. */
  rattle(x: number, y: number, z: number, s: number, ear: P) {
    if (s > 0) play('crawler.rattle', { x, y, z }, ear, { arg: s });
  }

  /** A runner's wreck at (x, y, z) wakes, to snap its jaws in `s` seconds. */
  wake(x: number, y: number, z: number, s: number, ear: P) {
    play('runner.wake', { x, y, z }, ear, { arg: s });
  }

  /** A crawler at (x, y, z) goes for you (`bite`: and gets you). */
  chitter(x: number, y: number, z: number, bite: boolean) {
    play(bite ? 'crawler.bite' : 'crawler.chitter', { x, y, z });
  }

  /** A guardian's cannon at (x, y, z) starts charging: a rising whine over `s` seconds. */
  charge(x: number, y: number, z: number, s: number) {
    play('cannon.charge', { x, y, z }, null, { arg: s });
  }

  /** A bolt or missile burst at (x, y, z): a footfall's boom, twice over. */
  boom(x: number, y: number, z: number, ear: P) {
    play('blast.boom', { x, y, z }, ear);
  }

  /** A guardian at (x, y, z) has started hunting you. */
  horn(x: number, y: number, z: number) {
    play('guardian.horn', { x, y, z });
  }

  /** A drone just locked on to you. */
  chirp() {
    play('drone.lockOn');
  }

  /** Every frame: the missiles in the air (position, velocity m/s), roaring where they are. */
  missiles(list: { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }[], ear: { x: number; y: number; z: number }) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const now = ctx.currentTime;
    const near = list.map((m) => ({ m, d: Math.hypot(m.x - ear.x, m.y - ear.y, m.z - ear.z) })).filter((o) => o.d < ROAR_HEAR)
      .sort((a, b) => a.d - b.d).slice(0, MAX_ROAR);
    const keep = new Set(near.map((o) => o.m.id));
    for (const [id, r] of this.roar) {
      if (keep.has(id)) continue;
      // Landed (the blast takes over) or out of earshot.
      r.gain.gain.setTargetAtTime(0, now, 0.03);
      for (const s of r.srcs) s.stop(now + 0.3);
      this.roar.delete(id);
    }
    for (const { m, d } of near) {
      let r = this.roar.get(m.id);
      if (!r) this.roar.set(m.id, (r = this.roarVoice(ctx, out, m)));
      // Closer: louder (1/d) and brighter (less air between, and more of the jet's hiss); the edge of earshot fades out.
      const near01 = 1 - Math.min(1, Math.max(0, (d - ROAR_NEAR) / (ROAR_FAR - ROAR_NEAR)));
      const edge = Math.min(1, (ROAR_HEAR - d) / (ROAR_HEAR * 0.3));
      r.gain.gain.setTargetAtTime(ROAR_GAIN * (ROAR_REF / Math.max(ROAR_REF, d)) * edge, now, 0.05);
      r.hiss.gain.setTargetAtTime(0.25 + 0.75 * near01 * near01, now, 0.05);
      r.air.frequency.setTargetAtTime(Math.max(400, 16000 * Math.exp(-d / 180)), now, 0.05);
      // Doppler, softened: a missile closing on you at 200 m/s isn't heard an octave up, only higher and harsher.
      const closing = -((m.x - ear.x) * m.vx + (m.y - ear.y) * m.vy + (m.z - ear.z) * m.vz) / Math.max(d, 1);
      const rate = Math.min(1.5, Math.max(0.75, SPEED_OF_SOUND / (SPEED_OF_SOUND - 0.5 * closing)));
      for (const s of r.srcs) s.playbackRate.setTargetAtTime(rate, now, 0.05);
      r.panner.positionX.setTargetAtTime(m.x, now, 0.03);
      r.panner.positionY.setTargetAtTime(m.y, now, 0.03);
      r.panner.positionZ.setTargetAtTime(m.z, now, 0.03);
    }
  }

  /** Every frame: the fixed-wing drones, each where it was when the sound now reaching `ear` left it (position,
   *  velocity m/s). */
  jets(list: { id: number; kind: JetKind; x: number; y: number; z: number; vx: number; vz: number }[], ear: { x: number; y: number; z: number }) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const now = ctx.currentTime;
    const hear = (m: { kind: JetKind }) => (m.kind === 'drone' ? DRONE_JET_HEAR : JET_HEAR);
    const near = list.map((m) => ({ m, d: Math.hypot(m.x - ear.x, m.y - ear.y, m.z - ear.z) })).filter((o) => o.d < hear(o.m))
      .sort((a, b) => a.d - b.d).slice(0, MAX_JET);
    const keep = new Set(near.map((o) => o.m.id));
    for (const [id, r] of this.jet) {
      if (keep.has(id)) continue;
      r.gain.gain.setTargetAtTime(0, now, 0.5);
      for (const s of r.srcs) s.stop(now + 3);
      r.whine?.stop(now + 3);
      this.jet.delete(id);
    }
    for (const { m, d } of near) {
      let r = this.jet.get(m.id);
      if (!r) {
        r = this.roarVoice(ctx, out, m, 220, 1100);
        // The turbine: a high, thin tone under the hiss.
        const whine = ctx.createOscillator();
        whine.type = 'triangle';
        whine.frequency.value = 3100 + (m.id % 5) * 90;
        const wg = ctx.createGain();
        wg.gain.value = JET_WHINE;
        whine.connect(wg).connect(r.hiss);
        whine.start();
        r.whine = whine;
        this.jet.set(m.id, r);
      }
      const near01 = 1 - Math.min(1, Math.max(0, (d - JET_NEAR) / (JET_FAR - JET_NEAR)));
      const h = hear(m), edge = Math.min(1, (h - d) / (h * 0.3));
      const g = m.kind === 'drone' ? JET_GAIN * DRONE_JET_GAIN : JET_GAIN;
      r.gain.gain.setTargetAtTime(g * (JET_REF / Math.max(JET_REF, d)) * edge, now, 0.1);
      r.hiss.gain.setTargetAtTime(0.2 + 0.8 * near01 * near01, now, 0.1);
      r.air.frequency.setTargetAtTime(Math.max(300, 16000 * Math.exp(-d / 700)), now, 0.1);
      // Doppler, softened like the missiles': higher coming in, a falling moan going away.
      const closing = -((m.x - ear.x) * m.vx + (m.z - ear.z) * m.vz) / Math.max(d, 1);
      const rate = Math.min(1.4, Math.max(0.75, SPEED_OF_SOUND / (SPEED_OF_SOUND - 0.5 * closing)));
      for (const s of r.srcs) s.playbackRate.setTargetAtTime(rate, now, 0.1);
      r.whine!.detune.setTargetAtTime(1200 * Math.log2(rate), now, 0.1);
      r.panner.positionX.setTargetAtTime(m.x, now, 0.05);
      r.panner.positionY.setTargetAtTime(m.y, now, 0.05);
      r.panner.positionZ.setTargetAtTime(m.z, now, 0.05);
    }
  }

  /** A missile's roar: looped noise as a low rumble and a jet's hiss, fluttering with the exhaust's turbulence. */
  private roarVoice(ctx: AudioContext, out: AudioNode, m: { x: number; y: number; z: number }, rumbleHz = 350, hissHz = 1600): Roar {
    const buf = noise(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = rumbleHz;
    const rumble2 = ctx.createBiquadFilter();
    rumble2.type = 'lowpass';
    rumble2.frequency.value = rumbleHz;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = ROAR_RUMBLE;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hissHz;
    band.Q.value = 0.5;
    const hiss = ctx.createGain();
    hiss.gain.value = 0.25;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 400;
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.rolloffFactor = 0; // the level is ours
    p.positionX.value = m.x;
    p.positionY.value = m.y;
    p.positionZ.value = m.z;
    src.connect(rumble).connect(rumble2).connect(rumbleGain).connect(air);
    src.connect(band).connect(hiss).connect(air);
    air.connect(flutter).connect(gain).connect(p).connect(out);
    // Turbulence: the same noise, slowed to a few Hz, wobbles the level ±FLUTTER.
    const wob = ctx.createBufferSource();
    wob.buffer = buf;
    wob.loop = true;
    const wobLp = ctx.createBiquadFilter();
    wobLp.type = 'lowpass';
    wobLp.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = FLUTTER / 0.03; // the noise low-passed to 9 Hz is ~0.015 RMS: ±FLUTTER at about 2σ
    wob.connect(wobLp).connect(depth).connect(flutter.gain);
    const at = Math.random() * buf.duration;
    src.start(ctx.currentTime, at);
    wob.start(ctx.currentTime, (at + 1) % buf.duration);
    return { srcs: [src, wob], gain, hiss, air, panner: p };
  }

  /** Every frame: the drones near the listener. */
  drones(list: { id: number; x: number; y: number; z: number }[], ear: { x: number; z: number }) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const now = ctx.currentTime;
    const near = list.map((d) => ({ d, r: Math.hypot(d.x - ear.x, d.z - ear.z) })).filter((o) => o.r < BUZZ_HEAR)
      .sort((a, b) => a.r - b.r).slice(0, MAX_BUZZ);
    const keep = new Set(near.map((o) => o.d.id));
    for (const [id, b] of this.buzz) {
      if (keep.has(id)) continue;
      b.gain.gain.setTargetAtTime(0, now, 0.3);
      b.osc.stop(now + 1.5);
      b.whine.stop(now + 1.5);
      this.buzz.delete(id);
    }
    for (const { d, r } of near) {
      let b = this.buzz.get(d.id);
      if (!b) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 118 + (d.id % 5) * 4;
        const whine = ctx.createOscillator();
        whine.frequency.value = 1420 + (d.id % 7) * 30;
        const wg = ctx.createGain();
        wg.gain.value = 0.08;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const p = panner(ctx, d.x, d.y, d.z, BUZZ_REF);
        osc.connect(lp).connect(gain);
        whine.connect(wg).connect(gain);
        gain.connect(p).connect(out);
        osc.start();
        whine.start();
        this.buzz.set(d.id, (b = { id: d.id, osc, whine, gain, panner: p }));
      }
      const fade = 1 - Math.max(0, (r - BUZZ_HEAR * 0.7) / (BUZZ_HEAR * 0.3));
      b.gain.gain.setTargetAtTime(BUZZ_GAIN * fade, now, 0.2);
      b.panner.positionX.setTargetAtTime(d.x, now, 0.05);
      b.panner.positionY.setTargetAtTime(d.y, now, 0.05);
      b.panner.positionZ.setTargetAtTime(d.z, now, 0.05);
    }
  }
}

export const guardianSound = new GuardianSound();
