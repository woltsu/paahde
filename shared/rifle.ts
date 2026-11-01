// The laser rifle: gear (shared/gear.ts), found broken out on crawler ground and repaired at the workbench, held from the hotbar, the one thing that can fight
// the walkers (shared/guardians.ts). Each walker carries glowing red weak points; a hit breaks one, and once every
// one of them is broken it dies: it collapses where it stands (src/world/guardians.ts), smoking, and drops parts.
//
// Hits are found by the shooter's client against what it draws (the legs are client-side IK, so only it knows where a
// knee is); the server checks the shot is plausible (rifle in hand, rate, range, aimed near that walker) and breaks
// the target for everyone. Client: src/rifle.ts (aiming, sway, recoil, the shot), src/world/zaps.ts (beam, sparks).
import { CRAWLER, type Kind } from './guardians.ts';
import type { Pusher } from './knockback.ts';

export const RIFLE = 'laser_rifle';
/** Semi-automatic: one shot per click, at most one every COOLDOWN_MS while the cell recharges (scaled by the gun's
 *  quality, shared/gear.ts gunCooldown). */
export const COOLDOWN_MS = 420;
/** How far the beam reaches (m). */
export const RANGE = 260;

/** The server's check of a hit a client claims: did the shot from (x, y, z) to (ex, ey, ez) pass within `slack` (m) of
 *  (cx, cy, cz) and end within 1.5 × slack of it? */
export function shotPasses(x: number, y: number, z: number, ex: number, ey: number, ez: number, cx: number, cy: number, cz: number, slack: number): boolean {
  const dx = ex - x, dy = ey - y, dz = ez - z, len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 0.01) return false;
  const t = Math.max(0, Math.min(1, ((cx - x) * dx + (cy - y) * dy + (cz - z) * dz) / len2));
  return Math.hypot(x + dx * t - cx, y + dy * t - cy, z + dz * t - cz) <= slack && Math.hypot(ex - cx, ey - cy, ez - cz) <= slack * 1.5;
}

/**
 * The laser pistol: the cheap one, found broken at the scrap fields near home (and in caches) and repaired with a
 * coil and scrap. One-handed, iron sights, no scope; it breaks weak points and drones just as the rifle does, but recharges
 * faster and only reaches PISTOL_RANGE: under a guardian's cannon (BOLT_RANGE, shared/guardians.ts), so it's for
 * crawlers and drones, or for a brave close fight.
 */
export const PISTOL = 'laser_pistol';
export const PISTOL_COOLDOWN_MS = 280;
export const PISTOL_RANGE = 100;

/**
 * The blaster: the heavy one, after the rifle (found broken on guardian ground). Two-handed, no scope, a long recharge;
 * its beam bursts where it stops (the sand, a wall, an enemy), and the burst hurts every damageable thing within
 * BLAST_R of it (drones, spiderlings, the crawlers' and the guardians' weak points: shared/enemies.ts `armor`): for
 * many small enemies at once.
 */
export const BLASTER = 'blaster';
export const BLASTER_COOLDOWN_MS = 1400;
export const BLASTER_RANGE = 160;
/** The burst's reach (m) around where the beam stopped. */
export const BLAST_R = 4.5;

/**
 * The graviton pistol: the end of everything. Never found out there (no loot table holds it: the lab and the debug menu
 * only); its beam pierces any armour and anything it touches dies at once.
 */
export const GRAVITON = 'graviton_pistol';
export const GRAVITON_COOLDOWN_MS = 600;
export const GRAVITON_RANGE = 400;

/**
 * The guns by item kind: cooldown (ms), reach (m), `pierce` (armour it goes through: shared/enemies.ts `armor`),
 * `damage` (hits a weak point or a thin-skinned enemy takes from one shot), `blast` (m: bursts where it stops,
 * hurting everything within it, else just what it hit), `push` (shared/knockback.ts), `scope` (aims through a scope).
 */
export type Gun = { cooldown: number; range: number; pierce: number; damage: number; blast?: number; push: Pusher; scope?: true };
export const GUNS: Record<string, Gun> = {
  [RIFLE]: { cooldown: COOLDOWN_MS, range: RANGE, pierce: 1, damage: 1, push: 'rifle', scope: true },
  [PISTOL]: { cooldown: PISTOL_COOLDOWN_MS, range: PISTOL_RANGE, pierce: 1, damage: 1, push: 'pistol' },
  [BLASTER]: { cooldown: BLASTER_COOLDOWN_MS, range: BLASTER_RANGE, pierce: 1, damage: 2, blast: BLAST_R, push: 'blaster' },
  [GRAVITON]: { cooldown: GRAVITON_COOLDOWN_MS, range: GRAVITON_RANGE, pierce: 100, damage: 1000, push: 'graviton' },
};

/**
 * Armour: does a hit of `gun` on an enemy with hull armour `armor` (shared/enemies.ts ENEMIES[kind].armor, ARMOR)
 * bite? A weak point is never armoured (`weak`); otherwise the gun must pierce the armour. The lasers and the blaster
 * bite drones, spiderlings and jets but not the hulls of the walkers, the harvester or the bosses; the graviton pistol
 * bites everything. (Takes the number, not the kind: shared/enemies.ts imports this module's GUNS through lootRoll.)
 */
export function bites(gun: Gun, armor: number, weak: boolean): boolean {
  return weak || gun.pierce >= armor;
}

/** Kills whatever it bites outright (the graviton pistol): every weak point, every hit point at once. */
export const kills = (gun: Gun) => gun.damage >= OVERKILL;
const OVERKILL = 1000;

/**
 * A walker's weak points. Guardians: one on every knee (in the tibia's frame, origin at the knee, +Z down the shin,
 * +Y towards the bend's outside), and one on the belly under the body's core (body frame, facing down, behind the
 * cannon's pod). Crawlers: two on the flanks of the body (body frame, +Z forward). Positions and radii
 * at the model's scale 1 (multiplied by KINDS scale); `hit` pads the radius for the hit test (small, quick crawlers).
 */
export type WeakPoint = { on: 'tibia' | 'body' | 'belly'; leg: number; x: number; y: number; z: number; r: number };

const KNEE = { x: 0, y: 0.55, z: 0.15, r: 0.85 };
const BELLY = { x: 0, y: -2.1, z: -3.2, r: 0.8 };
const FLANK = { y: 1.9, z: 0.9, r: 1.25 };

export function weakPoints(kind: Kind, legs: 3 | 4): WeakPoint[] {
  if (kind === CRAWLER) return [-1, 1].map((s) => ({ on: 'body', leg: -1, x: s * 3.35, ...FLANK }));
  const knees = Array.from({ length: legs }, (_, leg): WeakPoint => ({ on: 'tibia', leg, ...KNEE }));
  return [...knees, { on: 'belly', leg: -1, ...BELLY }];
}

/** The hit test's radius over the drawn one, by kind (guardian, crawler). */
export const HIT_PAD = [1.15, 1.6];

/** Drones (shared/guardians.ts) take DRONE_HP hits; the last brings one down: it falls, crashes and burns for
 *  DRONE_WRECK_S before the server clears it. A shot counts if it passes within DRONE_HIT m of the drone's centre. */
export const DRONE_HP = 2;
export const DRONE_WRECK_S = 25;
export const DRONE_HIT = 2.5;

/** A dead walker's wreck lies where it fell this long (s), by kind (guardian, crawler), then the server clears it; the
 *  client sinks it into the sand over the last WRECK_SINK s. */
export const WRECK_S = [180, 40];
export const WRECK_SINK = 6;

/** Hits a guardian's weak point takes before it breaks (a crawler's break at one); one hit cracks it and it blinks. */
export const GUARDIAN_POINT_HP = 2;

/** All of a walker's weak points broken (bit i: point i)? */
export const allBroken = (mask: number, n: number) => mask === (1 << n) - 1;
