// The datacenter's sound (docs/levels/datacenter.md "Atmosphere"): synthesised, no samples. A broadband fan bed (pink
// noise low-passed ~4 kHz, a slow ±1 dB drift) with the mains hum (100 Hz and its 200 Hz harmonic) under it, the whole
// hall; the cooling units' low rumble with a slow fan beat, louder near the north wall; the UPS room's transformer
// hum, only in there. Now and then a disk-seek chatter from somewhere in the racks. At the default volume (0.4) it
// measures −29.9 LUFS integrated mid-hall, −28.4 by the cooling units, −29.2 in the UPS room, sample peak −9.3 dBFS at
// volume 1 (rendered offline, BS.1770 K-weighting and gating: docs/audio.md "The datacenter's bed"): well under the −23
// mix target, it is the level's whole soundscape. Through the shared ambience bed (src/audio.ts: master gain and
// limiter); every gain ramps. Its levels, each part's, are BEDS in src/audioConfig.ts (the datacenter's, and the
// beginning's copy of it aboard the ring), read every frame.
import { audio } from '../../audio.ts';
import { BEDS, type DcBedDef } from '../../audioConfig.ts';
import type { ZoneId } from '../../../shared/levels/datacenter.ts';

/** Which BEDS entry a bed plays by. */
export type BedKey = 'datacenter' | 'beginning';
/** Fade in and out on entering and leaving (s, a time constant). */
const FADE = 0.4;

export type DcBed = { out: GainNode; fans: GainNode; hum: GainNode; crac: GainNode; ups: GainNode; chatter: (when: number, peak: number) => void; drift: GainNode; stop: () => void };

/** Pink noise (Kellet's filter), `seconds` long, looping cleanly enough under a lowpass. */
function pinkBuffer(ctx: BaseAudioContext, seconds: number, brown = false): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  let seed = 0x2f6b1c3d;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const w = rand();
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
      continue;
    }
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

/** The graph, on any context (the game's, or an OfflineAudioContext to measure it), into `dest`, its parts at `def`'s
 *  levels (the whole bed starts silent: `out`). */
export function buildBed(ctx: BaseAudioContext, dest: AudioNode, def: DcBedDef = BEDS.datacenter): DcBed {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const drift = ctx.createGain(); // the slow ±1 dB the whole bed breathes by (update)
  drift.connect(out);
  const loop = (buf: AudioBuffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  };
  // Fans: the air.
  const fans = ctx.createGain();
  fans.gain.value = def.fans;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4000;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 60;
  const air = loop(pinkBuffer(ctx, 5));
  air.connect(hp).connect(lp).connect(fans).connect(drift);
  // Mains hum, quiet.
  const hum = ctx.createGain();
  hum.gain.value = def.hum;
  hum.connect(drift);
  const oscs: OscillatorNode[] = [];
  for (const [f, g] of [[100, 1], [200, 0.45], [300, 0.12]] as const) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = g;
    o.connect(og).connect(hum);
    o.start();
    oscs.push(o);
  }
  // Cooling units: a low rumble beating slowly (two fans a little out of step).
  const crac = ctx.createGain();
  crac.gain.value = 0;
  crac.connect(out);
  const rumble = loop(pinkBuffer(ctx, 6, true));
  const rlp = ctx.createBiquadFilter();
  rlp.type = 'lowpass';
  rlp.frequency.value = 180;
  const beat = ctx.createGain();
  beat.gain.value = 0.8;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.7;
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(beat.gain);
  lfo.start();
  rumble.connect(rlp).connect(beat).connect(crac);
  // The UPS room's transformer: a stronger hum with an edge.
  const ups = ctx.createGain();
  ups.gain.value = 0;
  ups.connect(out);
  for (const [f, g] of [[100, 0.5], [200, 0.25], [400, 0.08], [600, 0.04]] as const) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = g * 0.12;
    o.connect(og).connect(ups);
    o.start();
    oscs.push(o);
  }
  // Disk chatter: a few short ticks of band-passed noise.
  const tick = pinkBuffer(ctx, 0.05);
  const chatter = (when: number, peak: number) => {
    const n = 3 + Math.floor(Math.random() * 6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500 + Math.random() * 2500;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = 0;
    bp.connect(g).connect(drift);
    for (let i = 0; i < n; i++) {
      const s = ctx.createBufferSource();
      s.buffer = tick;
      const t = when + i * (0.03 + Math.random() * 0.05);
      s.connect(bp);
      s.start(t, Math.random() * 0.04, 0.008);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
    }
  };
  const stop = () => {
    air.stop();
    rumble.stop();
    lfo.stop();
    for (const o of oscs) o.stop();
    out.disconnect();
  };
  return { out, fans, hum, crac, ups, chatter, drift, stop };
}

/** The bed in the game: built on first entry, faded in and out, the units' and the UPS room's parts by where you stand. */
export class DatacenterAmbience {
  private bed: DcBed | null = null;
  private on = false;
  private t = 0;
  private chatterIn = 3;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly key: BedKey;
  /** How much of the units' rumble reaches the camera (0..1); by default the datacenter's, by its north wall. */
  private readonly unitsAt: (cam: { x: number; z: number }) => number;

  /** `key`: its levels (BEDS in src/audioConfig.ts); `unitsAt`: where the cooling units are heard. */
  constructor(key: BedKey = 'datacenter', unitsAt?: (cam: { x: number; z: number }) => number) {
    this.key = key;
    this.unitsAt = unitsAt ?? ((cam) => {
      const north = Math.max(0, 1 - Math.max(0, 27.5 - cam.z) / 14);
      return 0.25 + 0.75 * north * north;
    });
  }

  private get def(): DcBedDef {
    return BEDS[this.key];
  }

  start() {
    this.on = true;
    clearTimeout(this.stopTimer);
    audio.onStart((ctx) => {
      if (!audio.ambience) return;
      this.bed ??= buildBed(ctx, audio.ambience, this.def);
      this.bed.out.gain.setTargetAtTime(this.on ? this.def.level : 0, ctx.currentTime, FADE);
    });
  }

  stop() {
    this.on = false;
    const ctx = audio.ctx;
    if (this.bed && ctx) this.bed.out.gain.setTargetAtTime(0, ctx.currentTime, FADE);
    // Faded out: its sources stop (not left running at gain 0); the next entry builds it again.
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.on || !this.bed) return;
      this.bed.stop();
      this.bed = null;
    }, FADE * 6000);
  }

  /** `cam`: the listener; the cooling units stand along the north wall (z 27–28), the UPS room is its own zone. */
  update(dt: number, cam: { x: number; z: number }, zone: ZoneId | null) {
    const ctx = audio.ctx, bed = this.bed;
    if (!ctx || !bed || !this.on || ctx.state !== 'running') return;
    this.t += dt;
    const now = ctx.currentTime, d = this.def;
    // Every part at its level now (an edit to BEDS is heard at once).
    bed.out.gain.setTargetAtTime(d.level, now, FADE);
    bed.fans.gain.setTargetAtTime(d.fans, now, 0.3);
    bed.hum.gain.setTargetAtTime(d.hum, now, 0.3);
    bed.crac.gain.setTargetAtTime(zone === 'ups' ? 0.1 : d.units * this.unitsAt(cam), now, 0.3);
    bed.ups.gain.setTargetAtTime(zone === 'ups' ? d.ups : 0, now, 0.3);
    // ±1 dB, slowly.
    bed.drift.gain.setTargetAtTime(10 ** ((Math.sin(this.t * 0.21) * 0.6 + Math.sin(this.t * 0.083) * 0.4) / 20), now, 0.5);
    // Disk chatter among the racks (aboard the ring they are everywhere).
    if ((zone === 'hall' || this.key === 'beginning') && (this.chatterIn -= dt) <= 0) {
      this.chatterIn = 4 + Math.random() * 9;
      bed.chatter(now + 0.05, d.chatter);
    }
  }
}
