// Everything a player can destroy and loot, in one place: how many come at once, where you meet them, what one leaves
// when it's killed (the dice in shared/lootRoll.ts, the tables in shared/tables.ts), and how a fight with it goes.
//
// The server leaves each one's loot through `drops` (server/world.ts). The rest (where you meet them, the fight odds) is
// what the economy simulator plays by (tools/econsim, docs/econsim.md); where it mirrors a server timer, the server's
// constant is named. The odds are rough on purpose and lean towards the player, more so with a rifle: tune them here.
import type { BossKind } from './bosses.ts';
import type { LootLevel } from './crashsites.ts';
import type { JetKind } from './jetbreak.ts';
import { bossDrops, harvesterDrops, jetDrops, killDrops, spiderlingDrops, type Drop, type Rand } from './lootRoll.ts';

/** The best gun you carry, else the scrap mace (shared/mace.ts). */
export type Weapon = 'none' | 'mace' | 'pistol' | 'rifle' | 'blaster';

export type Fight = {
  /** How long one takes (s). */
  seconds: Record<Weapon, number>;
  /** The odds you kill it (and it leaves its loot)... */
  win: Record<Weapon, number>;
  /** ...and if you don't, that it kills you (else you get away). */
  death: Record<Weapon, number>;
  /** Flying things: the odds the jammer (shared/jammer.ts) brings one down whole, if that's better than the gun. */
  jammer?: number;
  /** Each tier of the gun's (or jammer's) quality takes this share off what's left of losing, and off the death odds. */
  quality: number;
};

/** Where you meet it:
 *  - `site`: at crash sites of these loot levels when you get there (`odds` each time, or `spread`: that many go round
 *    the sites of those levels), only by night if `night`, back `backS` after you've left;
 *  - `roam`: comes to you about `perMin` times a minute while you're out `where`: `open` (past the start's keep-out round the origin),
 *    `guardianGround` (site level 2), `mudflat` (near a mud flat, shared/biomes.ts), `overhead` (anywhere outdoors);
 *    only by night if `night`; `hunt`: worth going there to wait for one;
 *  - `farm`: at the solar farms (shared/solarfarms.ts) when you get there, all `n` of them one after another, back `backS`
 *    after you've left;
 *  - `call`: only when you call it (the bosses' receivers, shared/bosses.ts). */
export type Meet =
  | { at: 'site'; levels: LootLevel[]; odds?: number; spread?: number; night?: boolean; backS?: number }
  | { at: 'farm'; backS?: number }
  | { at: 'roam'; where: 'open' | 'guardianGround' | 'mudflat' | 'overhead'; perMin: number; night?: boolean; hunt?: boolean }
  | { at: 'call' };

/** What a kill happened at: the jet's kind and whether it was jammed down whole (soft). */
export type KillCtx = { jet?: JetKind; soft?: boolean };

export type Enemy = {
  /** How many come at once. */
  n: [number, number];
  meet: Meet[];
  fight: Fight;
  /** What one leaves when killed. */
  drops: (rand: Rand, ctx?: KillCtx) => Drop[];
  /** It comes down this far away (m; a jet) instead of at your feet. */
  falls?: [number, number];
  /** How heavy it is (kg): how far a hit knocks it (shared/knockback.ts). */
  mass: number;
  /** Its hull's armour: a gun's hit on it bites only if the gun's `pierce` (shared/rifle.ts GUNS) is at least this;
   *  a weak point goes round it (shared/rifle.ts bites). 0: thin-skinned, any gun hurts it. */
  armor: number;
};

/** Armour by how thick the hull: thin (drones, spiderlings, jets: any gun bites); the walkers' plate (the piercer and
 *  the graviton pistol go through); the harvester's and the bosses' heavy plate (only the graviton pistol). The rest
 *  must find the weak points. */
export const ARMOR = { thin: 0, plate: 10, heavy: 30 } as const;

export type EnemyKind = 'crawler' | 'guardian' | 'drone' | 'jet' | 'harvester' | 'spiderling' | BossKind;

/** The mace is no better than bare hands but against crawlers, the one thing it can reach; the blaster (shared/rifle.ts
 *  BLASTER: a burst that breaks a weak point in one, a slow recharge, no scope) is the rifle unless said. */
const odds = (none: number, pistol: number, rifle: number, mace = none, blaster = rifle): Record<Weapon, number> => ({ none, mace, pistol, rifle, blaster });

/** A boss: called with its receiver, a long fight that wants the rifle. */
const boss = (kind: BossKind): Enemy => ({
  n: [1, 1],
  meet: [{ at: 'call' }],
  fight: { seconds: odds(120, 900, 900), win: odds(0, 0.2, 0.75, 0, 0.72), death: odds(0.9, 0.7, 0.6), quality: 0.25 },
  drops: (rand) => bossDrops(kind, rand),
  mass: 1e6,
  armor: ARMOR.heavy,
});

/** A site's crawlers killed are back this long (s) after everyone has left it (server/guardians.ts swarm). */
export const PACK_BACK_S = 5 * 60;

export const ENEMIES: Record<EnemyKind, Enemy> = {
  // Player-sized walkers at every crash site of crawler and guardian ground (an outpost's pack is smaller: server/guardians.ts
  // CRAWLERS_MIN..MAX, OUTPOST_CRAWLERS_MAX); the ones killed are back PACK_BACK_S after everyone has left. By night small
  // packs (1–3) roam the open desert too, one turning up near whoever is out every few minutes (server/guardians.ts
  // NIGHT_PACK_*); about half of them pass by unnoticed. None at the solar farms: their nests' spiderlings keep them.
  crawler: {
    n: [1, 4],
    meet: [{ at: 'site', levels: [0.5, 1, 2], odds: 1, backS: PACK_BACK_S }, { at: 'roam', where: 'open', perMin: 0.2, night: true }],
    fight: { seconds: odds(40, 60, 40, 50, 20), win: odds(0, 0.85, 0.97, 0.6, 0.995), death: odds(0.2, 0.08, 0.03, 0.15, 0.01), quality: 0.2 },
    drops: (rand) => killDrops('crawler', rand),
    mass: 100,
    armor: ARMOR.plate,
  },
  // The giant guardians: GUARDIANS (6) roam guardian ground's sites (server/guardians.ts), crossing your path out there now and then.
  guardian: {
    n: [1, 1],
    meet: [{ at: 'site', levels: [2], spread: 6 }, { at: 'roam', where: 'guardianGround', perMin: 0.04, hunt: true }],
    fight: { seconds: odds(50, 200, 150, 50, 90), win: odds(0, 0.38, 0.8, 0, 0.88), death: odds(0.35, 0.23, 0.1, 0.35, 0.07), quality: 0.2 },
    drops: (rand) => killDrops('guardian', rand),
    mass: 40_000,
    armor: ARMOR.plate,
  },
  // Searchlight drones: two keep each crawler- and guardian-ground site by night (DRONES_PER_SITE), and a few roam the open
  // desert day and night, drifting in on whoever is out (ROAMERS, ROAM_EVERY_S).
  drone: {
    n: [1, 2],
    meet: [{ at: 'site', levels: [0.5, 1, 2], odds: 1, night: true }, { at: 'roam', where: 'open', perMin: 0.08 }],
    fight: { seconds: odds(30, 45, 30, 30, 20), win: odds(0, 0.75, 0.93, 0, 0.97), death: odds(0.15, 0.06, 0.03, 0.15, 0.02), jammer: 0.95, quality: 0.2 },
    drops: (rand) => killDrops('drone', rand),
    mass: 40,
    armor: ARMOR.thin,
  },
  // Jets fly over every 4–10 min (server/jets.ts GAP_MIN_MS..GAP_MAX_MS); bring one down with the rifle (3 hits) or the
  // jammer and it comes down some way off, its wreck a crash site (shared/jetcrash.ts). They don't shoot back.
  jet: {
    n: [1, 1],
    meet: [{ at: 'roam', where: 'overhead', perMin: 1 / 7 }],
    fight: { seconds: odds(0, 0, 20), win: odds(0, 0, 0.4, 0, 0.3), death: odds(0, 0, 0), jammer: 0.7, quality: 0.2 },
    drops: (rand, ctx) => jetDrops(ctx?.jet ?? 'drone', !!ctx?.soft, rand),
    falls: [150, 700],
    mass: 4000,
    armor: ARMOR.thin,
  },
  // The harvester rises out of a mud flat near whoever is out by one, every 4–10 min (server/harvesters.ts GAP_MIN_MS..GAP_MAX_MS),
  // and runs them over; three cores in its maw to shoot out.
  harvester: {
    n: [1, 1],
    meet: [{ at: 'roam', where: 'mudflat', perMin: 1 / 7, hunt: true }],
    fight: { seconds: odds(40, 240, 150, 40, 90), win: odds(0, 0.3, 0.85, 0, 0.9), death: odds(0.25, 0.15, 0.06, 0.25, 0.05), quality: 0.2 },
    drops: (rand) => harvesterDrops(rand),
    mass: 2e6,
    armor: ARMOR.heavy,
  },
  // The solar farms' nests (shared/nest.ts): NEST_N (30) spiderlings each, clinging to the mirrors by the tower, most of
  // them on you by the time you're in among them (server/nests.ts); the ones killed are back PACK_BACK_S after everyone
  // has left. One rifle shot or blow of the mace, two of the pistol. The odds are each one's: the whole nest is a long
  // run of them, and losing any one of them (a spring you didn't dodge) is the fight lost. Bare-handed you run.
  spiderling: {
    n: [18, 30],
    meet: [{ at: 'farm', backS: PACK_BACK_S }],
    fight: { seconds: odds(2, 6, 4, 5, 2), win: odds(0, 0.95, 0.985, 0.94, 0.995), death: odds(0.5, 0.6, 0.6, 0.6, 0.6), quality: 0.25 },
    drops: (rand) => spiderlingDrops(rand),
    mass: 8,
    armor: ARMOR.thin,
  },
  worm: boss('worm'),
  carrier: boss('carrier'),
  colossus: boss('colossus'),
  queen: boss('queen'),
};

/** The odds of winning a fight with `kind` and, losing it, of dying, with `weapon` at quality `q` (0..3) and the jammer at
 *  quality `jam` (null: none carried). */
export function fightOdds(kind: EnemyKind, weapon: Weapon, q: number, jam: number | null): { win: number; death: number; seconds: number } {
  const f = ENEMIES[kind].fight;
  const better = (p: number, quality: number) => 1 - (1 - p) * (1 - f.quality * quality);
  let win = weapon === 'none' ? 0 : better(f.win[weapon], q);
  if (f.jammer !== undefined && jam !== null) win = Math.max(win, better(f.jammer, jam));
  return { win: Math.min(1, win), death: f.death[weapon] * Math.max(0, 1 - f.quality * q), seconds: f.seconds[weapon] };
}
