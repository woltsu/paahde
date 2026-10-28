// The beginning's progress on the server (docs/levels/tutorial.md, shared/levels/beginning.ts): the level is one per
// player, and what changes in it as you go lives in your own PlayerState.gates, which only the server sets. A bit is set
// when you reach its trigger box (a door you come near, the blast door starting down, the hall's jolt) and reaches the
// client with the next reconciliation, as `level` does: no input bit asks for it.
import { beginningLevel, triggersAt } from '../shared/levels/beginning.ts';
import type { PlayerState } from '../shared/sim.ts';

/** This module's level. */
export const TUTORIAL = beginningLevel.id;

/** After a tick: the bits of the triggers `s` stands in, set (the same state if none is new). */
export function tickTriggers(s: PlayerState): PlayerState {
  if (s.level !== TUTORIAL) return s;
  const bits = triggersAt(s.x, s.y, s.z);
  return (s.gates & bits) === bits ? s : { ...s, gates: s.gates | bits };
}
