// The ring hall's overhead carriages (docs/levels/ring.md "Overhead rails"): bridge cranes hung under two pairs of rails
// that run all the way round the ring under the ceiling, moving stop-and-go, each its own way along its track, never
// closer than `DRIVE.gap` to the one ahead. At each stop the hoist lets its load down a little and takes it back up; the
// load swings on its cables when the carriage speeds up or slows down. Client-only dressing (nothing in the sim, the
// level is private): this is only the motion, pure (no three.js), drawn by rails.ts.
import { mulberry32 } from '../../../shared/noise.ts';
import { RING } from '../../../shared/ring.ts';

/** Once round the ring, along the deck (m): a track's z wraps by this. */
export const LOOP = 2 * Math.PI * RING.radius;

/** The two tracks: each a pair of rails `RAILS.span` apart, centred `x` across the hall, its carriages all going `dir`
 *  (+1: +z, the walk's way). Between the ceiling's light bands (x ±10, ±26: src/levels/beginning/ring.ts BANDS). */
export const TRACKS = [{ x: -18, dir: 1 }, { x: 18, dir: -1 }] as const;

/** The rails: the I-beams' underside over the deck, their depth, and the two rails of a track this far apart (m). */
export const RAILS = { y: 31, h: 0.5, span: 6 } as const;

/** How they drive: top speed (m/s, ± `vary` per carriage), acceleration (m/s²), the room kept to the one ahead (m), a
 *  leg's length and a stop's (m, s), how far the hoist lets the load down at a stop (m). */
export const DRIVE = { vmax: 3.6, vary: 0.8, accel: 0.7, gap: 14, legMin: 40, legMax: 220, waitMin: 6, waitMax: 16, drop: 2.5 } as const;

/** Carriages on each track, and the cable's length with the load up (m). */
export const PER_TRACK = 8;
export const CABLE = 4;

/** What a carriage carries: a rack on the way somewhere, a container, or just its hook. */
export type Load = 'rack' | 'crate' | 'none';

export type Carriage = {
  track: number;
  /** Along the track, unwrapped (only ever grows by `dir`): `wrapZ` for where it is on the ring. */
  z: number;
  v: number;
  vmax: number;
  /** Where this leg ends (unwrapped, as `z`). */
  target: number;
  /** Stopped: this stop's length and how far into it (s); 0 while driving. */
  wait: number;
  waitT: number;
  /** How far the hoist has the load down now (m, 0..DRIVE.drop). */
  drop: number;
  load: Load;
  /** The load's swing on its cables (rad about the axis; + trails towards -z) and its rate. */
  swing: number;
  swingV: number;
};

/** The sim's gravity (shared/sim.ts), which is the spin's here. */
const G = 25;

/** `z` on the ring, in [0, LOOP). */
export const wrapZ = (z: number) => ((z % LOOP) + LOOP) % LOOP;

export class Carriages {
  readonly list: Carriage[] = [];
  /** Each carriage's leader (the next one ahead on its track), by index. */
  private ahead: number[] = [];
  private rand: () => number;

  /** `near`: the carriages are spread round the ring, the first of each track just this side of it (the walk's start). */
  constructor(seed = 7, near = 60) {
    this.rand = mulberry32(seed);
    const r = this.rand, spacing = LOOP / PER_TRACK;
    TRACKS.forEach((t, k) => {
      const first = this.list.length;
      for (let i = 0; i < PER_TRACK; i++) {
        // Spread evenly, jittered well inside the spacing, so none starts within the gap of another.
        const z = near + k * 70 + i * spacing * t.dir + (r() - 0.5) * spacing * 0.4;
        const load: Load = r() < 0.5 ? 'rack' : r() < 0.6 ? 'crate' : 'none';
        const c: Carriage = { track: k, z, v: 0, vmax: DRIVE.vmax + (r() - 0.5) * DRIVE.vary, target: z, wait: 0, waitT: 0, drop: 0, load, swing: 0, swingV: 0 };
        // Some start stopped part way through a stop, the rest under way.
        if (r() < 0.4) {
          this.stop(c);
          c.waitT = r() * c.wait;
        } else this.leg(c);
        this.list.push(c);
      }
      // No overtaking: the order along the track never changes, so neither does who is ahead.
      const ids = Array.from({ length: PER_TRACK }, (_, i) => first + i).sort((a, b) => (this.list[a].z - this.list[b].z) * t.dir);
      ids.forEach((id, i) => (this.ahead[id] = ids[(i + 1) % ids.length]));
    });
  }

  /** The room from `c` to the one ahead of it on its track (m, round the ring). */
  room(i: number): number {
    const c = this.list[i], a = this.list[this.ahead[i]], dir = TRACKS[c.track].dir;
    return wrapZ((a.z - c.z) * dir);
  }

  /** Move everything on by `dt` (s; long frames are cut short: they only lose time). */
  step(dt: number) {
    dt = Math.min(dt, 0.1);
    if (dt <= 0) return;
    this.list.forEach((c, i) => {
      const dir = TRACKS[c.track].dir, v0 = c.v;
      if (c.wait > 0) {
        // Stopped: the load down and back up over the stop.
        c.waitT += dt;
        const k = Math.sin(Math.PI * Math.min(1, c.waitT / c.wait));
        c.drop = DRIVE.drop * k * k;
        if (c.waitT >= c.wait) {
          c.wait = 0;
          c.drop = 0;
          this.leg(c);
        }
      } else {
        // To the leg's end, or short of the one ahead, whichever is nearer: brake in time for it.
        const toGo = (c.target - c.z) * dir;
        const free = Math.max(0, this.room(i) - DRIVE.gap);
        const d = Math.min(toGo, free);
        const brake = (c.v * c.v) / (2 * DRIVE.accel);
        const a = d > brake + 0.05 ? (c.v < c.vmax ? DRIVE.accel : 0) : -(c.v * c.v) / (2 * Math.max(d, 0.01));
        c.v = Math.max(0, Math.min(c.vmax, c.v + a * dt));
        const move = Math.min(c.v * dt, Math.max(0, d));
        c.z += dir * move;
        if (toGo - move <= 0.05 && c.v < 0.4) {
          c.v = 0;
          this.stop(c);
        } else if (free - move <= 0.05) c.v = 0; // (held behind the one ahead)
      }
      // The load on its cables: a pendulum hung from the hoist, pushed by the carriage's acceleration along the ring.
      const acc = ((c.v - v0) / dt) * dir, len = CABLE + c.drop + 1.5;
      c.swingV += ((acc * Math.cos(c.swing) - G * Math.sin(c.swing)) / len - 0.35 * c.swingV) * dt;
      c.swing += c.swingV * dt;
    });
  }

  private leg(c: Carriage) {
    c.target = c.z + TRACKS[c.track].dir * (DRIVE.legMin + this.rand() * (DRIVE.legMax - DRIVE.legMin));
  }

  private stop(c: Carriage) {
    c.wait = DRIVE.waitMin + this.rand() * (DRIVE.waitMax - DRIVE.waitMin);
    c.waitT = 0;
  }
}
