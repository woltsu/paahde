/**
 * Gear effects: modifiers an item puts on whoever has it, either in hand (`held`) or anywhere in their bag
 * (`carried`, the hand included). The piercer is bulky in hand: half speed on foot, no jump, air jump or slide.
 *
 * - EFFECTS: what each effect does (its movement modifiers, read by shared/sim.ts) and how it reads in an item's
 *   tooltip (a chip in its tone: src/inventory.ts). Add an effect here, then name it on items in ITEM_EFFECTS.
 * - The server works out a player's effects each tick from their bag and hand (server/world.ts simulate: effectsOf)
 *   into PlayerState.effects, a bit per effect, so step() stays a function of state and input and the snapshot
 *   carries it to the client's prediction (src/net.ts reconcile).
 */
import type { Item } from './items.ts';
import { TEXT } from './text.ts';

/** How an effect reads: bad (red/orange), neutral (grey) or good (blue). */
export type Tone = 'bad' | 'neutral' | 'good';

export type EffectDef = {
  tone: Tone;
  /** Its chip in an item's tooltip (TEXT.effects). */
  label: string;
  /** Speed factor on foot (multiplied with any others'). */
  speed?: number;
  /** No jump or air jump. */
  noJump?: boolean;
  /** No speed slide. */
  noSlide?: boolean;
};

export const EFFECTS = {
  bulky: { tone: 'bad', label: TEXT.effects.bulky, speed: 0.5, noJump: true, noSlide: true },
} as const satisfies Record<string, EffectDef>;

export type EffectId = keyof typeof EFFECTS;
/** Every effect, in bit order (PlayerState.effects: bit i is EFFECT_IDS[i]). */
export const EFFECT_IDS = Object.keys(EFFECTS) as EffectId[];
const BIT = Object.fromEntries(EFFECT_IDS.map((id, i) => [id, 1 << i])) as Record<EffectId, number>;

/** The effects an item kind has: `held` only while in hand, `carried` while anywhere in the bag. */
export type ItemEffects = { held?: readonly EffectId[]; carried?: readonly EffectId[] };
export const ITEM_EFFECTS: Partial<Record<string, ItemEffects>> = {
  piercer: { held: ['bulky'] },
};

/** Whether `mask` (PlayerState.effects) has effect `id`. */
export const hasEffect = (mask: number | undefined, id: EffectId) => ((mask ?? 0) & BIT[id]) !== 0;

/** The mask of one item kind's effects: its `carried` ones, and its `held` ones too when `inHand`. */
export function itemEffects(kind: string | undefined, inHand: boolean): number {
  const e = kind ? ITEM_EFFECTS[kind] : undefined;
  if (!e) return 0;
  let m = 0;
  for (const id of e.carried ?? []) m |= BIT[id];
  if (inHand) for (const id of e.held ?? []) m |= BIT[id];
  return m;
}

/** A player's effects (PlayerState.effects) from their bag and the slot in hand (-1: nothing), repaired or not. */
export function effectsOf(bag: readonly (Item | null | undefined)[], hand: number): number {
  let m = 0;
  for (let i = 0; i < bag.length; i++) {
    const it = bag[i];
    if (it && ITEM_EFFECTS[it.kind]) m |= itemEffects(it.kind, i === hand);
  }
  return m;
}

/** What a mask of effects does to moving on foot: the speed factor, and whether you can jump and slide. */
export type Move = { readonly speed: number; readonly jump: boolean; readonly slide: boolean };
const FREE: Move = { speed: 1, jump: true, slide: true };
const moves = new Map<number, Move>([[0, FREE]]);
export function moveOf(mask: number | undefined): Move {
  const m = mask ?? 0;
  let mv = moves.get(m);
  if (!mv) {
    let speed = 1, jump = true, slide = true;
    EFFECT_IDS.forEach((id, i) => {
      if (!(m & (1 << i))) return;
      const d: EffectDef = EFFECTS[id];
      speed *= d.speed ?? 1;
      if (d.noJump) jump = false;
      if (d.noSlide) slide = false;
    });
    mv = { speed, jump, slide };
    moves.set(m, mv);
  }
  return mv;
}

/** Whether an item kind in hand slows you on foot (shared/sim.ts): its wearer's steps are a heavy plod
 *  (src/footsteps.ts, src/players.ts). */
export const weighsDown = (kind: string | null | undefined) => !!kind && moveOf(itemEffects(kind, true)).speed < 1;

/** An item kind's effects for its tooltip: each once, held-only ones marked as such. */
export function effectsList(kind: string): { id: EffectId; def: EffectDef; held: boolean }[] {
  const e = ITEM_EFFECTS[kind];
  if (!e) return [];
  const carried = new Set(e.carried ?? []);
  return [...(e.carried ?? []).map((id) => ({ id, held: false })), ...(e.held ?? []).filter((id) => !carried.has(id)).map((id) => ({ id, held: true }))]
    .map(({ id, held }) => ({ id, def: EFFECTS[id], held }));
}
