// Climbing a ladder (shared/towers.ts, shared/sim.ts stepClimb): which rung each hand and foot is on, worked out from
// the climber's height alone, so it's the same for every client and for a climber hanging still.
//
// Ladder climbing goes in diagonal pairs (the right hand with the left foot, then the left hand with the right foot),
// three points always on the ladder: one pair holds while the other moves up two rungs (STEP), and the body rises
// steadily between. A limb moving comes off its rung, back from the ladder in an arc (`lift`), and lands on the rung
// two up; climbing down plays the same backwards. The feet sit a rung either side of the climber's height; the hands
// `reach` above the feet (a whole number of rungs, from the body's shoulder height: src/models/scavenger.ts).
import { RUNG } from '../../shared/towers.ts';

/** A limb moves this far (two rungs) per step; each pair steps once in 2·STEP of climb. */
export const STEP = 2 * RUNG;

/** Limbs: 0 right hand, 1 left hand, 2 right foot, 3 left foot. The right hand moves with the left foot. */
export const RIGHT_HAND = 0, LEFT_HAND = 1, RIGHT_FOOT = 2, LEFT_FOOT = 3;
const PAIR = [0, 1, 1, 0];

export type LimbAt = {
  /** The rung's height over the ladder's foot (m) it is on, or between two of them while moving. */
  y: number;
  /** 0 holding a rung; 0..1 through its move up (or down). */
  move: number;
  /** How far off the ladder it is in its move (0..1: the arc's height, sin of the move). */
  lift: number;
};

const ease = (t: number) => t * t * (3 - 2 * t);

/** Limb `i` at climb height `h` (the feet's height over the ladder's foot), the hands `reach` over the feet; none below
 *  the ground (0) or over `top`. */
export function limbAt(i: number, h: number, reach: number, top: number): LimbAt {
  const off = PAIR[i];
  const u = (h / STEP - off) / 2, n = Math.floor(u), f = u - n;
  const t = f < 0.5 ? f * 2 : 1, e = ease(t);
  let y = STEP * (2 * n + 2 * e + off) - RUNG;
  const hand = i < 2;
  if (hand) y = Math.min(y + reach, top);
  const moving = t < 1 && f > 0;
  // At the foot one foot stays on the ground until the climb lifts it onto the first rung.
  if (!hand && y < 0) return { y: 0, move: 0, lift: 0 };
  return { y, move: moving ? t : 0, lift: moving ? Math.sin(Math.PI * t) : 0 };
}
