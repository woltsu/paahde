// World state: what the desert does, grown from the bosses beaten so far (`beaten`, shared/bosses.ts bossBit mask,
// kept in the world's settings by server/world.ts). The world changes as bosses fall: each stage below is one step.
// Derived, never stored: a world's state is read from `beaten` alone, so old worlds pick up new stages on their own.
//
// Stages so far (any boss counts, for now):
// - one boss beaten: runners come out (server/runners.ts sends them); before that there are none.
import { beatenCount } from './bosses.ts';

export type WorldState = {
  /** Runners are sent for players out in the open (server/runners.ts). The debug menu's summon works regardless. */
  runners: boolean;
};

/** The world's state with the boss kinds in `beaten` killed. */
export function worldState(beaten: number): WorldState {
  const n = beatenCount(beaten);
  return { runners: n >= 1 };
}
