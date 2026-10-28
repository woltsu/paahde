// The beginning's dead control cabinet (docs/levels/tutorial.md "The cabinet"), taken apart with the real disassembly mode:
// a control_cabinet of a fixed seed, worked by one player alone (server/tutorial.ts keeps each player's session, never
// saved). Of everything inside only its relay is there to take, and it comes out as the level's own item (tut_relay,
// shared/items.ts): the other parts were taken long ago (they start out taken), and its steps pay no scrap. So the
// economy never sees it. Kept apart from shared/levels/beginning.ts, which shared/levels.ts loads early.
import { machineParts } from '../machine.ts';
import { stepList } from '../machineSteps.ts';
import { CABINET } from './beginning.ts';

/** Its session id, the same for everyone: each player's is their own on the server. */
export const CABINET_ID = 'tut:cabinet';
/** The crash-site level it rolls its parts at (shared/parts.ts rollParts). */
export const CABINET_LEVEL = 1;
/** The relay the cabinet gives. */
export const RELAY = 'tut_relay';

/** The first seed whose cabinet holds exactly one relay, and that relay's part index. */
export const CABINET_SEED = (() => {
  for (let seed = 1; ; seed++) {
    const parts = machineParts(CABINET.kind, seed, CABINET_LEVEL);
    if (parts.filter((p) => p.part === 'relay').length === 1) return seed;
  }
})();
export const RELAY_INDEX = machineParts(CABINET.kind, CABINET_SEED, CABINET_LEVEL).findIndex((p) => p.part === 'relay');

/** The parts already gone from it when you find it: all but the relay. */
export const CABINET_GONE: readonly number[] = machineParts(CABINET.kind, CABINET_SEED, CABINET_LEVEL)
  .map((_, i) => i).filter((i) => i !== RELAY_INDEX);

/** Its step rules (shared/machineSteps.ts), as the server checks them. */
export const cabinetSteps = () => stepList(CABINET.kind, CABINET_SEED, CABINET_LEVEL);
