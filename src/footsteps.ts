// Footstep sounds: one short step per stride, played when an avatar plants a foot (src/players.ts,
// alongside the footprint). Remote players' steps are panned and fade with distance.
//
// Each surface is a sprite of single steps sliced from a recording (see public/credits.txt): `count` slices
// of `len` seconds, each a step starting near the slot start. Outside it is a walk on a gravel trail,
// levelled so a steady walk at ~2.4 steps/s measures −23 LUFS; inside a shelter it is footsteps on concrete,
// which only peak-normalise to about −30 LUFS, so their gain is higher to sound as loud. `gain` pulls both
// well under the wind, since in game you take ~4.4 steps/s. Carrying what weighs you down (shared/effects.ts weighsDown: the piercer) a step is a
// plod: pitched down, a little louder, with a dull thud of the weight coming down under it.
// The sprites, the steps' level at full slider volume (for the local player walking: footsteps should be barely
// noticed), their spread and how far they carry (`ref`: full level within it, then 1/d; none past `hear`) are the
// events footstep.sand and footstep.concrete in src/audioConfig.ts.
import { audio } from './audio';
import { reflect } from './acoustics';
import { event, sample, sampleId, trimGain, type EventId } from './audioConfig';
import { atEar } from './echo';
import { sampleBuffer, spread } from './sounds';

export type Surface = 'sand' | 'concrete';

const STEPS: Record<Surface, EventId> = { sand: 'footstep.sand', concrete: 'footstep.concrete' };
/** Echoes off the walls round you (src/acoustics.ts `reflect`): a faint slap, so walking doesn't tire; heard from this
 *  far (m) of travel. */
const ECHO = 0.5;
const ECHO_HEAR = 1200;
const WALK = 6;
/** A heavy step: pitch ×, level ×, and its thud's level (× the step's). */
const HEAVY_PITCH = 0.8, HEAVY_LEVEL = 1.3, THUD = 0.9;

class Footsteps {
  private last = -1;
  private lx = 0;
  private lz = 0;
  private yaw = 0;

  /** Where the ears are. `yaw` is the camera yaw (three.js: forward = (−sin, −cos)). */
  listener(p: { x: number; z: number }, yaw: number) {
    this.lx = p.x;
    this.lz = p.z;
    this.yaw = yaw;
  }

  /** A foot planted at (x, z) on `surface`, moving at `speed` m/s; `heavy`: carrying a heavy gun. */
  step(x: number, z: number, speed: number, surface: Surface = 'sand', heavy = false) {
    const e = event(STEPS[surface]), id = sampleId(e.sounds[0]), slices = sample(id).slices;
    const ctx = audio.ctx, buf = sampleBuffer(id);
    if (!ctx || !buf || !slices || !audio.out || !audio.running) return;
    const near = e.ref ?? 2.5, far = e.hear ?? 30;
    const dx = x - this.lx, dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d > far) return;
    // Faster is heavier, a bit; distance falls off as 1/d with a fade to nothing at far (over its last sixth).
    const level = e.gain * trimGain(id) * (heavy ? HEAVY_LEVEL : Math.min(1.4, 0.6 + 0.4 * (speed / WALK))) * Math.min(1, near / d) * Math.min(1, (far - d) / (far / 6));

    // A random step, never the same one twice in a row, slightly varied in pitch and level.
    let i = Math.floor(Math.random() * (slices.count - 1));
    if (i >= this.last) i++;
    this.last = i;
    const slot = slices.len;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (e.pitch ?? 1) * spread(e.vary) * (heavy ? HEAVY_PITCH : 1);
    const gain = ctx.createGain();
    gain.gain.value = level * spread(e.jitter);
    // Pan by which side of the listener it is on; steps under your own feet stay centred.
    const pan = ctx.createStereoPanner();
    const right = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
    pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(d, near))) * 0.7;
    src.connect(gain).connect(pan).connect(audio.out);
    reflect(gain, d < near ? null : atEar(x, z), gain.gain.value, ECHO_HEAR, ECHO);
    src.start(ctx.currentTime, i * slot, slot);
    if (heavy) {
      // The weight coming down: a short low sine drop.
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + 0.012;
      o.frequency.setValueAtTime(85, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * THUD, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.22);
    }
  }
}

export const footsteps = new Footsteps();
