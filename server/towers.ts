// Server side of the radio towers (shared/towers.ts, docs/radiotowers.md). Each tower has three fixtures where its parts
// are fitted (shared/towers.ts SPOTS: the radio in the cabinet at its foot, the dish drive on the dish deck, the antenna
// feed on the top deck), each an item in a box of its own (shared/boxes.ts towerBox), fitted like a building's. They're
// made the first time anyone comes near the tower, with the parts the seed left in them (shared/lootRoll.ts towerParts):
// some gone, the battery flat.
//
// A tower is alive while all three are whole and the radio's battery holds charge: its lamp blinks, its dish turns, and
// its radio mutters (src/world/towers.ts, src/towerSound.ts). Alive, it draws TOWER_W from that battery, game time
// (shared/power.ts GAME_SPEED), kept in the battery itself (its ItemData `charge`) so it goes wherever the battery goes.
// Everyone is told which towers are alive ('towers').
import { towerBox } from '../shared/boxes.ts';
import { GEAR, repaired } from '../shared/gear.ts';
import { chargeOf, makeItem, parsePart, partAt, setPart, type Item } from '../shared/items.ts';
import { towerParts } from '../shared/lootRoll.ts';
import { mulberry32 } from '../shared/noise.ts';
import { ORIGIN } from '../shared/origin.ts';
import { CELLS, GAME_SPEED } from '../shared/power.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { SPOT_ITEMS, SPOTS, TOWER_W, towersNear, type Tower } from '../shared/towers.ts';
import { WORLD_SEED } from '../shared/world.ts';
import type { ItemServer } from './items.ts';

/** A tower's fixtures are made when someone comes this near it (m). */
const MAKE_R = 900;
/** How often the drained battery is saved and sent (ms). */
const SAVE_MS = 30_000;
/** Where the radio's battery is fitted (shared/gear.ts GEAR.tower_radio). */
const BATTERY = GEAR.tower_radio.slots.findIndex((s) => 'part' in s && s.part === 'battery');

export class TowerServer {
  private items: ItemServer;
  /** The towers whose fixtures exist, by id. */
  private made = new Map<number, Tower>();
  private alive = new Set<number>();
  private savedAt = 0;
  private sendShared: (box: string) => void;

  constructor(items: ItemServer, sendShared: (box: string) => void) {
    this.items = items;
    this.sendShared = sendShared;
  }

  /** The fixture's item at tower t's spot i (made if it isn't yet). */
  private fixture(t: Tower, i: number): Item {
    const box = towerBox(t.id, i);
    const slots = this.items.slots('', box);
    if (!slots[0]) this.make(t);
    return slots[0]!;
  }

  /** Make tower t's three fixtures, with what the seed left in them. */
  private make(t: Tower) {
    const rand = mulberry32(Math.imul(t.id, 0x9e3779b1) ^ Math.imul(WORLD_SEED, 0x2c1b3c6d) ^ 0x70e7);
    const far = (Math.hypot(t.x - ORIGIN.x, t.z - ORIGIN.z) - 1500) / 4500;
    const found = towerParts(SPOT_ITEMS, far, rand);
    const boxes = SPOTS.map((_, i) => towerBox(t.id, i));
    this.items.change('', boxes, (newId) => {
      SPOTS.forEach((_, i) => {
        const slots = this.items.slots('', boxes[i]);
        if (!slots[0]) slots[0] = makeItem(newId(), { kind: SPOT_ITEMS[i], n: 1, parts: found[i].parts, data: found[i].data });
      });
    });
    for (const b of boxes) this.sendShared(b);
  }

  /** Is tower t alive: every fixture whole, and the radio's battery holding charge? */
  private live(t: Tower): boolean {
    const its = SPOTS.map((_, i) => this.fixture(t, i));
    if (!its.every((it) => repaired(it))) return false;
    const b = partAt(its[0], BATTERY);
    return !!b && (chargeOf(b) ?? 0) > 0;
  }

  /** Every second (`dt` real s): fixtures made near players, the live ones' batteries drained. True if which towers are
   *  alive changed (send `msg()`). */
  tick(players: readonly { x: number; z: number }[], dt: number, now: number): boolean {
    for (const p of players) {
      for (const t of towersNear(p.x, p.z, MAKE_R)) {
        if (this.made.has(t.id)) continue;
        this.made.set(t.id, t);
        this.fixture(t, 0);
      }
    }
    const save = now - this.savedAt > SAVE_MS;
    if (save) this.savedAt = now;
    let changed = false;
    for (const t of this.made.values()) {
      const was = this.alive.has(t.id), is = this.live(t);
      if (is) this.drain(t, dt, save);
      if (is !== was) {
        changed = true;
        if (is) this.alive.add(t.id);
        else this.alive.delete(t.id);
      }
    }
    return changed;
  }

  /** Take what the radio drew in `dt` real seconds out of its battery; saved and sent now and then. */
  private drain(t: Tower, dt: number, save: boolean) {
    const box = towerBox(t.id, 0), it = this.fixture(t, 0), b = partAt(it, BATTERY)!;
    const tier = parsePart(b.kind)?.tier ?? 0, kwh = CELLS[tier]?.kwh ?? CELLS[0].kwh;
    const used = (TOWER_W * dt * GAME_SPEED) / 3600 / 1000 / kwh;
    const left = Math.max(0, (chargeOf(b) ?? 0) - used);
    const flat = left <= 0;
    if (save || flat) this.items.change('', [box], () => setPart(it, BATTERY, { kind: b.kind, data: { ...b.data, charge: left } }));
    else setPart(it, BATTERY, { kind: b.kind, data: { ...b.data, charge: left } });
    if (save || flat) this.sendShared(box);
  }

  /** The fixtures' boxes made so far (for the join message). Fitting parts goes through the usual moves (server/world.ts
   *  onFit, onUnfit); the next tick sees what changed. */
  boxes(): string[] {
    return [...this.made.values()].flatMap((t) => SPOTS.map((_, i) => towerBox(t.id, i)));
  }

  /** Which towers are alive, for everyone. */
  msg(): ServerMsg {
    return { t: 'towers', alive: [...this.alive] };
  }
}
