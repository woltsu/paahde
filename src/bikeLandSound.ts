// The thump of a bike coming down after a long jump (src/bike.ts, with the landing dust cloud). Every rider's
// is heard: panned, and fading with distance.
//
// public/audio/bike-crash.mp3 is mixed for the game from CC0 sounds: a heavy hit, then rumble and debris dying
// away over ~2 s. Mono, levelled to −23 LUFS (true peak −6 dBTP). How rough the landing was decides how much
// of it is heard: most landings are just the hit, quiet and muffled (a thud in the sand), a little fuller the
// rougher; only near the sim's hard landing does it open up into the crash, loud and bright, and only a really
// hard one (well past it) lets the debris play out.
import { audio } from './audio';
import { reflect } from './acoustics';
import { atEar } from './echo';
import { event, sampleId, trimGain } from './audioConfig';
import { sampleBuffer, spread } from './sounds';
import { BIKE_HARD_LANDING } from '../shared/sim.ts';

// Its level at full slider volume (for a hard landing under your own wheels), spread and reach (full level within
// `ref` m, then 1/d; none past `hear`) are the event bike.land in src/audioConfig.ts.
/** Impact (m/s into the sand) at which it is the softest thud; up to BIKE_HARD_LANDING it stays a muffled thud. */
const SOFT = 4;
/** The crash comes in from this fraction of BIKE_HARD_LANDING, whole at it. */
const HARD_FROM = 0.8;
/** Past BIKE_HARD_LANDING by this much (m/s), the whole crash plays out. */
const CRASH = 14;
/** The hit is let through whole for this long (s), then the tail fades. */
const HOLD = 0.2;
/** Echoes off the walls round you (src/acoustics.ts `reflect`), heard from this far (m) of travel. */
const ECHO_HEAR = 2000;

class BikeLandSound {
  private lx = 0;
  private lz = 0;
  private yaw = 0;

  /** Where the ears are. `yaw` is the camera yaw (three.js: forward = (−sin, −cos)). */
  listener(p: { x: number; z: number }, yaw: number) {
    this.lx = p.x;
    this.lz = p.z;
    this.yaw = yaw;
  }

  /** A bike landed at (x, z), hitting the sand at `impact` m/s (across the slope, as shared/sim.ts stepBike). */
  play(x: number, z: number, impact: number) {
    const e = event('bike.land'), id = sampleId(e.sounds[0]);
    const ctx = audio.ctx, buf = sampleBuffer(id);
    if (!ctx || !buf || !audio.out || !audio.running) return;
    const near = e.ref ?? 4, far = e.hear ?? 60;
    const dx = x - this.lx, dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d > far) return;
    const rough = Math.min(1, Math.max(0, (impact - SOFT) / (BIKE_HARD_LANDING - SOFT)));
    const hard = Math.min(1, Math.max(0, (impact / BIKE_HARD_LANDING - HARD_FROM) / (1 - HARD_FROM)));
    const crash = Math.min(1, Math.max(0, (impact - BIKE_HARD_LANDING) / CRASH));
    // Full level within `near`, then 1/d, faded to nothing over the last sixth of `far`.
    const level = e.gain * trimGain(id) * (0.15 + 0.2 * rough + 0.65 * hard) * Math.min(1, near / d) * Math.min(1, (far - d) / (far / 6));
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (1.06 - 0.12 * rough) * (e.pitch ?? 1) * spread(e.vary);
    // A thud in the sand (350 Hz, up to 1.2 kHz the rougher), opening up to the whole crash only when it's hard.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 350 * Math.pow(3.5, rough) * Math.pow(17, hard);
    // The tail rings longer the harder it was; under a crash the debris is faded out before it comes.
    const tail = 0.05 + 0.12 * rough * rough + 0.25 * hard + 4 * crash * crash;
    const gain = ctx.createGain();
    const g = level * spread(e.jitter);
    gain.gain.setValueAtTime(g, now);
    gain.gain.setValueAtTime(g, now + HOLD);
    gain.gain.setTargetAtTime(0, now + HOLD, tail);
    const pan = ctx.createStereoPanner();
    const right = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
    pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(d, near))) * 0.7;
    src.connect(tone).connect(gain).connect(pan).connect(audio.out);
    reflect(gain, d < near ? null : atEar(x, z), g, ECHO_HEAR);
    src.start(now);
    src.stop(now + Math.min(buf.duration, HOLD + tail * 7));
  }
}

export const bikeLandSound = new BikeLandSound();
