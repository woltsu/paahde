// Gameplay test scenarios (debug menu → Scenarios, dev server only): a fixed set-up to play a situation through again and
// again. Each one runs in the dev test world (?w=test, shared/world.ts TEST_WORLD: the real desert from that id's fixed
// seed, so a place here is the same place every time) and sets, for the one who starts it: where they stand and face,
// what they carry (the bag and the equipment emptied first; the first hotbar item in hand), the shared clock's time of
// day, the weather, and the enemies placed round them. Started from another world, the menu goes to the test world first.
// The server sets it up (server/world.ts onScenario); docs/scenarios.md says how to add one.
import { TIERS } from './salvage.ts';

export type Tier = (typeof TIERS)[number];

/** Something they carry: `n` of `kind` (stackables), or gear repaired with `tier` parts (shared/gear.ts scrapParts). */
export type ScenarioItem = { kind: string; n?: number; tier?: Tier };

/** An enemy placed at `dist` m from them, `bearing` radians turned from the way they face (0: dead ahead; turned as
 *  `facing` turns). A guardian stands there for `standS` s, then patrols round that spot; `hunting`: it comes for them
 *  at once. */
export type ScenarioEnemy = { kind: 'guardian'; dist: number; bearing?: number; standS?: number; hunting?: boolean };

/** The weather: `clear` (no storms, gas or vortices, and none come on their own while it runs), or one summoned on them
 *  (`storm`: a sandstorm after the usual warning; `front`: a mega-storm front; `gas`: poison gas). */
export type ScenarioWeather = 'clear' | 'storm' | 'front' | 'gas';

export type Scenario = {
  id: string;
  label: string;
  /** What it's for, in a line (the debug menu shows it). */
  note: string;
  /** Where they stand in the test world (m), and the way they face: `facing` radians, the sim's (shared/sim.ts: 0 looks
   *  towards -z). */
  at: { x: number; z: number; facing: number };
  /** The time of day (0..1: 0 midnight, 0.25 ≈ sunrise, 0.5 noon, 0.75 ≈ sunset), on the shared clock. */
  tod: number;
  weather: ScenarioWeather;
  /** The hotbar (in order; the first is in hand), then the bag. Equippable gear goes on. */
  hotbar: ScenarioItem[];
  bag?: ScenarioItem[];
  enemies: ScenarioEnemy[];
  /** No heat build-up (the debug menu's "Disable heat"). */
  noHeat?: boolean;
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'piercer-guardian',
    label: 'Piercer vs guardian',
    note: 'Evening on open sand, a piercer in hand, a guardian standing 300 m ahead: a long shot at the edge of its range.',
    // Flat sand west of the start; the evening sun at their back, a clear line north (+z) to it on a rise 12 m up (found
    // with the test world's seed: tools/scenarios.test.mjs checks the line).
    at: { x: -873, z: 777, facing: Math.PI },
    tod: 0.73,
    weather: 'clear',
    hotbar: [{ kind: 'piercer', tier: 'basic' }, { kind: 'canteen', tier: 'scrap' }, { kind: 'spyglass', tier: 'scrap' }],
    bag: [{ kind: 'backpack', tier: 'scrap' }],
    enemies: [{ kind: 'guardian', dist: 300, standS: 60 }],
  },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
