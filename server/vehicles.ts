// Server side of vehicles (shared/vehicles.ts): the `vehicles` table, the broken vehicles lying in the world (a quad
// by the first crashed pod, HOME_BIKE, one per world and shared by everyone there: it seats two; motorcycles at the
// crash sites, FINDS.motorcycle, a new one a while after one is stood up; older worlds also kept the motorcycle each
// player found by their pod, before the quad), standing one up once its part slots are filled (its item is in box veh<id>: parts are fitted there
// like a building's, server/items.ts fit / unfit), and getting on and off: mount() puts the player on it at once
// (shared/sim.ts riding), and whoever rides it carries it with them until they get off (or die, or leave), when it
// is parked where they are. Keeps shared/vehicles.ts's list in step and broadcasts it when it changes. Each one is
// the player's who stood it up (one stood up before there were owners: whoever rides it first); each player is told
// which are theirs (`mine` in the 'vehicles' message, never who owns the others: the owner is a browser ID).
// A quad being ridden takes a passenger: board() puts someone on foot on its back (shared/sim.ts PlayerState.pillion;
// server/world.ts carries them with it), unboard() takes them off (getting off, or the rider getting off, dying or
// leaving).
//
// Carts (shared/cart.ts, docs/cart.md): one per player, standing by their pod (arriveCart(), once, a grant: existing
// players get theirs on their next join), theirs from the start. Backing the bike you ride slowly up to your own parked
// cart's coupler hitches it (tryHitch(), each tick: the state is set as mount() sets it, the client reconciles). It stays
// linked to that bike (`hitched`): getting off parks both, the cart behind (release()); getting back on tows it again
// (mount()); F on its tongue on foot lets it go (unhitch()). Someone else getting on the bike it's linked to lets it go
// too: only its owner tows it. Its box cargo<id> rides along. Its owner unfolds it, on foot looking at it, with the cart
// key (unfold(): not linked to a bike, on sand level enough, shared/cart.ts unfoldError) and packs it with the same;
// backing the bike up to it unfolded packs and hitches it in one go (tryHitch). Packing (and so that hitch) is
// refused while `packBlocked` says so (phase 3's benches). Its owner raises its level with the wrench from the build menu (upgrade():
// shared/crafting.ts CART_UPGRADES, ItemData.level on its item in veh<id>).
// Each cart carries its owner's colour (`color`, from their player row: right while they're offline, and set again on
// every join, recolor()), so it's told apart by the pods.
import { cargoBox, vehicleBox, vehicleId } from '../shared/boxes.ts';
import { bikeLevel, GEAR, isVehicle, partsOf, repaired, RIDDEN, scrapParts } from '../shared/gear.ts';
import { partKind, setData, type ItemData } from '../shared/items.ts';
import { CART_UPGRADES, WRENCH } from '../shared/crafting.ts';
import { coreCrashSites } from '../shared/crashsites.ts';
import { brokenParts, cartSpot, findSpot, foundData, homeBikeSpot, nearPiles } from '../shared/lootRoll.ts';
import { atTongue, backingUpTo, CART, CART_MAX_LEVEL, cartLevel, hitchHeading, isCamp, isCart, towedPose, UNFOLD_S, unfoldError } from '../shared/cart.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { carried, type PlayerState } from '../shared/sim.ts';
import { FINDS, HOME_BIKE } from '../shared/tables.ts';
import { heightAt } from '../shared/terrain.ts';
import { TEXT } from '../shared/text.ts';
import { placed } from '../shared/placed.ts';
import { inReach, parked, setVehicles, vehicles, type Vehicle } from '../shared/vehicles.ts';
import { LAB } from '../shared/world.ts';
import type { openDb } from './db.ts';
import type { ItemServer } from './items.ts';

type Db = ReturnType<typeof openDb>;

/** Slack (m) on the reach checks for the server's view of the player lagging the client's. */
const REACH_SLACK = 1.5;
/** A find stood up is replaced by another broken one this long after (ms). */
const FIND_RESPAWN_MS = 3 * 60_000;
/** The world's DB setting that says the motorcycle items were made vehicles (v12, migrate()). */
const MIGRATED = 'vehicles';
/** A player's grant that says their cart has been laid out by their pod (arriveCart()). */
const CART_GRANT = 'cart';
const KIND = 'motorcycle';
/** The one by the pods. */
const HOME = 'quad';

export class VehicleServer {
  private db: Db;
  private items: ItemServer;
  private changed = false;
  /** Where each came from ('home', 'arrival', 'find', 'old'). */
  private src = new Map<number, string>();
  /** Whose each is (browser ID), if anyone's. */
  private owner = new Map<number, string>();
  /** Why cart `id` can't be packed now (a machine on its table, a dismantling job running: phase 3, docs/cart.md), or
   *  null. */
  packBlocked: (id: number) => string | null = () => null;
  /** When the finds stood up are replaced (ms since epoch). */
  private due: number[] = [];
  private sites = coreCrashSites();
  private piles = nearPiles();

  constructor(db: Db, items: ItemServer) {
    this.db = db;
    this.items = items;
    if (db.getSetting(MIGRATED) === undefined) this.migrate();
    const rows = db.loadVehicles().filter((r) => isVehicle(r.kind));
    // The list first (shared/storage.ts opens the boxes by it), then each one's parts from its box.
    setVehicles(rows.map((r) => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, z: r.z, heading: r.heading, up: r.up, parts: [],
      ...(isCart(r) ? { open: r.open, ...(r.hitched !== null && rows.some((b) => b.id === r.hitched) ? { hitched: r.hitched } : {}) } : {}) })));
    for (const r of rows) {
      this.src.set(r.id, r.src);
      if (r.owner) this.owner.set(r.id, r.owner);
    }
    // A cart's owner's colour (a public one: the owner's browser ID never goes out).
    setVehicles(vehicles.map((v) => {
      const o = isCart(v) ? this.owner.get(v.id) : undefined;
      const color = o === undefined ? undefined : db.getPlayer(o)?.color;
      return color === undefined ? v : { ...v, color };
    }));
    setVehicles(vehicles.map((v) => this.withParts(v)));
    db.tx(() => {
      if (!vehicles.some((v) => v.kind === HOME && this.src.get(v.id) === 'home')) this.spawnHome();
      for (let n = this.lyingFinds(); n < this.wantFinds(); n++) this.spawnFind();
    });
    this.changed = false;
  }

  /** The vehicle as its box has it: the parts fitted now (a cart's level). */
  private withParts(v: Vehicle): Vehicle {
    const it = this.items.slots('', vehicleBox(v.id))[0];
    return { ...v, parts: it ? partsOf(it) : [], ...(isCart(v) ? { level: cartLevel(it) } : {}) };
  }

  private set(list: Vehicle[]) {
    setVehicles(list);
    this.changed = true;
  }

  private update(id: number, change: Partial<Vehicle>) {
    this.set(vehicles.map((v) => (v.id === id ? { ...v, ...change } : v)));
  }

  /** A new vehicle (in the table, its item in its box with `parts`). Call inside a transaction. */
  private add(x: number, z: number, heading: number, parts: (string | null)[], up: boolean, src: string, y = heightAt(x, z), data?: ItemData, kind = KIND): Vehicle {
    const id = this.db.insertVehicle(kind, x, y, z, heading, up, src);
    const v: Vehicle = { id, kind, x, y, z, heading, up, parts: [...parts], ...(kind === CART ? { open: false, level: data?.level ?? 0 } : {}) };
    this.src.set(id, src);
    this.set([...vehicles, v]); // (its box opens with it: shared/storage.ts boxSize)
    this.items.stowNew(vehicleBox(id), kind, parts, data);
    return v;
  }

  /** The home quad's parts: HOME_BIKE.fitted, scrap tier. */
  private homeParts() {
    return GEAR[HOME].slots.map((s) => ('part' in s && HOME_BIKE.fitted.includes(s.part) ? partKind(s.part, 'scrap') : null));
  }

  /** The broken quad by the first crashed pod, once in a world (HOME_BIKE). An older world's home motorcycle may lie
   *  on its spot: then a little way off. */
  private spawnHome() {
    let { x, z } = homeBikeSpot();
    if (vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 3)) {
      x += 3.5;
      z += 1.5;
    }
    this.add(x, z, 0.6, this.homeParts(), false, 'home', undefined, undefined, HOME);
  }

  /**
   * Player `browserId` (any join) has a cart standing by their pod `pod`, theirs, level 0 and its box empty: laid out
   * once (a grant), so a new player's is there from the start and an existing player's comes on their next join. In the
   * lab, by its spawn (shared/lootRoll.ts cartSpot). Returns the new one's id, if one was laid out.
   */
  arriveCart(browserId: string, pod: number): number | null {
    if (this.db.hasGrant(browserId, CART_GRANT)) return null;
    return this.db.tx(() => {
      this.db.markGrant(browserId, CART_GRANT);
      const at = cartSpot(pod, [...vehicles, ...placed]);
      const v = this.add(at.x, at.z, at.heading, [], true, 'arrival', undefined, undefined, CART);
      this.own(v.id, browserId);
      return v.id;
    });
  }

  /** Debug menu: a motorcycle (a `quad`) at `x`, `z` facing `heading`, broken (parts as found) or `working` (stood up
   *  with Scrap parts, nobody's until ridden). Returns it. */
  debugSpawn(x: number, z: number, heading: number, working: boolean, quad = false): Vehicle {
    const kind = quad ? HOME : KIND;
    return this.db.tx(() => (working
      ? this.add(x, z, heading, scrapParts(kind), true, 'debug', undefined, undefined, kind)
      : this.add(x, z, heading, brokenParts(kind, Math.random), false, 'debug', undefined, undefined, kind)));
  }

  /** Finds wanted lying broken at the crash sites at once (none in the lab: no desert). */
  private wantFinds() {
    return LAB ? 0 : (FINDS[KIND]?.n ?? 0);
  }

  /** Finds lying broken now, and those due back. */
  private lyingFinds() {
    return vehicles.filter((v) => this.src.get(v.id) === 'find' && !v.up).length + this.due.length;
  }

  /** A broken one at a crash site of its level (FINDS), like the gear found there (shared/lootRoll.ts). */
  private spawnFind(): Vehicle {
    const { x, z } = findSpot(FINDS[KIND]?.level ?? 1, this.sites, this.piles, Math.random);
    const parts = brokenParts(KIND, Math.random);
    return this.add(x, z, Math.random() * Math.PI * 2, parts, false, 'find', undefined, foundData(KIND, parts, Math.random));
  }

  /**
   * v12: the motorcycle was an item (in the bag, the Vehicle slot, the chests, dropped on the sand) with a cargo box
   * of its own per player ('bike'). Each becomes a vehicle: one dropped on the sand where it lay, the others in a row
   * by the home bike's spot; a player's old cargo goes into their bike's (or a working one of their own if they had none).
   */
  private migrate() {
    this.db.tx(() => {
      const { bikes, cargo } = this.db.takeOldBikes();
      const dropped = this.db.loadDropped().filter((r) => r.kind === KIND);
      const home = homeBikeSpot();
      let row = 0;
      const lined = () => {
        row++;
        return { x: home.x + 3 * row, z: home.z - 2 };
      };
      const mine = new Map<string, Vehicle>();
      for (const b of bikes) {
        const parts = b.parts ?? scrapParts(KIND);
        const { x, z } = lined();
        const v = this.add(x, z, 0.6, parts, repaired({ id: 0, kind: KIND, n: 1, parts }), 'old');
        if (b.owner) this.own(v.id, b.owner);
        if (b.owner && (!mine.has(b.owner) || v.up)) mine.set(b.owner, v);
      }
      for (const d of dropped) {
        this.db.deleteDropped(d.id);
        this.add(d.x, d.z, Math.random() * Math.PI * 2, d.parts ?? scrapParts(KIND), false, 'old');
      }
      for (const owner of cargo) {
        let v = mine.get(owner);
        if (!v?.up) {
          const { x, z } = lined();
          v = this.add(x, z, 0.6, scrapParts(KIND), true, 'old');
          this.own(v.id, owner);
        }
        this.db.moveBox(owner, 'bike', '', cargoBox(v.id));
      }
      this.db.setSetting(MIGRATED, 1);
      if (bikes.length || dropped.length || cargo.length) {
        console.log(`vehicles: ${bikes.length + dropped.length} motorcycles and ${cargo.length} cargo boxes are in the world now`);
      }
    });
  }

  /** The vehicles' boxes, for a joining player: each one's item, and a working one's cargo. */
  boxes(): string[] {
    return vehicles.flatMap((v) => (v.up ? [vehicleBox(v.id), cargoBox(v.id)] : [vehicleBox(v.id)]));
  }

  /** A vehicle's box changed (parts fitted or taken out): its parts in the list follow. */
  refresh(box: string) {
    const id = vehicleId(box);
    if (vehicles.some((v) => v.id === id)) this.set(vehicles.map((v) => (v.id === id ? this.withParts(v) : v)));
  }

  /** May a part come out of this box? Not out of a working vehicle (only swapped for another). */
  canUnfit(box: string): boolean {
    const id = vehicleId(box);
    return id < 0 || !vehicles.find((v) => v.id === id)?.up;
  }

  /** Vehicle `id` is player `browserId`'s from now on. */
  private own(id: number, browserId: string) {
    this.db.ownVehicle(id, browserId);
    this.owner.set(id, browserId);
    this.changed = true;
  }

  /** Player `browserId`'s colour is `color` (every join): their carts are painted it. */
  recolor(browserId: string, color: number) {
    if (vehicles.some((v) => isCart(v) && v.color !== color && this.owner.get(v.id) === browserId)) {
      this.set(vehicles.map((v) => (isCart(v) && this.owner.get(v.id) === browserId ? { ...v, color } : v)));
    }
  }

  /** Player `browserId`'s camp: their own cart, parked, unfolded and built (shared/cart.ts isCamp), or undefined. They
   *  wake up beside it (server/world.ts homeOf). */
  campOf(browserId: string): Vehicle | undefined {
    return vehicles.find((v) => isCamp(v) && this.owner.get(v.id) === browserId);
  }

  /** Player `browserId`'s vehicles' ids. */
  mine(browserId: string): number[] {
    return vehicles.flatMap((v) => (this.owner.get(v.id) === browserId ? [v.id] : []));
  }

  /** Player `browserId` at `s` stands broken vehicle `id` up (every part slot filled, in reach): it's theirs. Returns
   *  it, or why not. */
  repair(browserId: string, s: PlayerState, id: unknown): Vehicle | string {
    const v = vehicles.find((q) => q.id === id);
    if (!v || v.up) return TEXT.notice.alreadyGone;
    if (!parked(v) || !inReach(s, v, REACH_SLACK)) return TEXT.notice.tooFar;
    if (!repaired(this.items.slots('', vehicleBox(v.id))[0])) return TEXT.notice.missingParts;
    this.db.standVehicle(v.id);
    this.update(v.id, { up: true });
    this.own(v.id, browserId);
    // A find stood up: another broken one comes after a while.
    if (this.src.get(v.id) === 'find') this.due.push(Date.now() + FIND_RESPAWN_MS);
    return vehicles.find((q) => q.id === v.id)!;
  }

  /**
   * Player `rider` (public id; browser ID `browserId`) at `s` gets on vehicle `id`, at once: it must be working, in
   * reach and nobody's on it (nobody's own yet: it's theirs now). Returns their state moved onto it, riding
   * (shared/sim.ts), or why not.
   */
  mount(rider: number, browserId: string, s: PlayerState, id: unknown): PlayerState | string {
    const v = vehicles.find((q) => q.id === id);
    if (!v || !RIDDEN.includes(v.kind)) return TEXT.notice.alreadyGone;
    if (s.pillion) return TEXT.notice.getOffFirst;
    if (s.riding || this.ridden(rider)) return TEXT.notice.getOffFirst;
    if (!parked(v)) return TEXT.notice.someoneOnIt;
    if (!inReach(s, v, REACH_SLACK)) return TEXT.notice.tooFar;
    const bike = bikeLevel(this.items.slots('', vehicleBox(v.id))[0]);
    if (!v.up || !bike) return TEXT.notice.broken;
    this.update(v.id, { rider });
    if (!this.owner.has(v.id)) this.own(v.id, browserId);
    // A cart linked to it: towed again if it's theirs; someone else's is let go where it stands.
    const cart = this.cartOn(v.id);
    const tow = cart && parked(cart) && this.owner.get(cart.id) === browserId ? cart : undefined;
    if (tow) this.update(tow.id, { rider });
    else if (cart) this.hitch(cart.id, undefined);
    return {
      ...s, x: v.x, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0, sliding: false, crouching: false,
      riding: true, heading: v.heading, bike, nose: 0, noseSpin: 0, tow: tow?.id ?? 0, hitch: tow?.heading ?? 0,
      ...(v.kind === HOME ? { quad: true } : {}),
    };
  }

  /**
   * Player `id` at `s` (on foot) gets on the back of quad `vid` behind whoever rides it (at `riding`, their state): it
   * must have its back seat free and be within reach of them. Returns their state on it (shared/sim.ts PlayerState.pillion,
   * where the rider is: server/world.ts carries them from then on), or why not.
   */
  board(id: number, s: PlayerState, vid: unknown, riding: PlayerState | undefined): PlayerState | string {
    const v = vehicles.find((q) => q.id === vid);
    if (!v || v.kind !== HOME || v.rider === undefined || !riding?.riding) return TEXT.notice.alreadyGone;
    if (s.riding || s.pillion || this.ridden(id)) return TEXT.notice.getOffFirst;
    if (v.passenger !== undefined) return TEXT.notice.someoneOnIt;
    if (!inReach(s, riding, REACH_SLACK)) return TEXT.notice.tooFar;
    this.update(v.id, { passenger: id });
    return { ...carried(s, riding), sliding: false, crouching: false, climb: undefined, tow: 0, pillion: v.rider };
  }

  /** Player `id` is off the back of whatever quad they rode on (if any). */
  unboard(id: number) {
    const v = vehicles.find((q) => q.passenger === id);
    if (v) this.update(v.id, { passenger: undefined });
  }

  /** The passenger on the back of the quad player `rider` rides, if any (their public id). */
  passengerOf(rider: number): number | undefined {
    return this.ridden(rider)?.passenger;
  }

  /** The cart linked to bike `bike` (vehicle id), if any. */
  private cartOn(bike: number): Vehicle | undefined {
    return vehicles.find((c) => isCart(c) && c.hitched === bike);
  }

  /** Cart `id` linked to bike `bike` from now on (undefined: to none). */
  private hitch(id: number, bike: number | undefined) {
    this.db.hitchVehicle(id, bike ?? null);
    this.update(id, { hitched: bike });
  }

  /**
   * Each tick, for player `rider` (browser ID `browserId`) at `s` riding a bike that tows nothing: backing it slowly up
   * to their own parked cart's coupler hitches it (shared/cart.ts backingUpTo; not one unfolded, nor one linked to a bike
   * being ridden). Returns their state towing it (as mount() returns theirs riding), or null.
   */
  tryHitch(rider: number, browserId: string, s: PlayerState): PlayerState | null {
    if (!s.riding || s.tow || !s.grounded) return null;
    const bike = this.ridden(rider);
    if (!bike || this.cartOn(bike.id)) return null;
    for (const c of vehicles) {
      if (!isCart(c) || !parked(c) || this.owner.get(c.id) !== browserId || !backingUpTo(s, c)) continue;
      const linked = c.hitched === undefined ? undefined : vehicles.find((b) => b.id === c.hitched);
      if (linked && !parked(linked)) continue;
      const hitch = hitchHeading(s, c);
      if (hitch === null || this.pack(c)) continue; // (packed first: refused while its benches are busy)
      this.hitch(c.id, bike.id);
      this.update(c.id, { rider });
      return { ...s, tow: c.id, hitch };
    }
    return null;
  }

  /** Player `browserId` at `s` (on foot) lets their cart `id` go from the bike it's linked to, F on its tongue. Returns
   *  true, or why not. */
  unhitch(browserId: string, s: PlayerState, id: unknown): true | string {
    const c = vehicles.find((q) => q.id === id);
    if (!c || !isCart(c)) return TEXT.notice.alreadyGone;
    if (this.owner.get(c.id) !== browserId) return TEXT.notice.notYours;
    if (s.riding || !parked(c)) return TEXT.notice.getOffFirst;
    if (!atTongue(s, c, REACH_SLACK)) return TEXT.notice.tooFar;
    if (c.hitched !== undefined) this.hitch(c.id, undefined);
    return true;
  }

  /** Your own parked cart `id`, in reach of `s` on foot, or why not. */
  private ownCart(browserId: string, s: PlayerState, id: unknown): Vehicle | string {
    const c = vehicles.find((q) => q.id === id);
    if (!c || !isCart(c)) return TEXT.notice.alreadyGone;
    if (this.owner.get(c.id) !== browserId) return TEXT.notice.notYours;
    if (s.riding || !parked(c)) return TEXT.notice.getOffFirst;
    if (!inReach(s, c, REACH_SLACK)) return TEXT.notice.tooFar;
    return c;
  }

  /** Player `browserId` at `s` (on foot) unfolds (`open`) or packs their parked cart `id` (the cart key, looking at it).
   *  Unfolding refuses while it's linked to a bike or on sand too uneven (shared/cart.ts unfoldError); packing while
   *  packBlocked says so. Returns true, or why not. */
  unfold(browserId: string, s: PlayerState, id: unknown, open: unknown): true | string {
    const c = this.ownCart(browserId, s, id);
    if (typeof c === 'string') return c;
    if (open !== true) return this.pack(c) ?? true;
    if (c.open) return true;
    const why = unfoldError(c);
    if (why) return why === 'hitched' ? TEXT.notice.unhitchFirst : TEXT.notice.tooSteep;
    this.db.openVehicle(c.id, true);
    this.update(c.id, { open: true });
    this.pitch(c.id);
    return true;
  }

  /** Cart `id`'s canopy is being put up (drawn over UNFOLD_S): it shades and is solid once that's done
   *  (shared/cart.ts canopyUp). */
  private pitch(id: number) {
    this.update(id, { pitching: true });
    setTimeout(() => {
      if (vehicles.some((v) => v.id === id && v.pitching)) this.update(id, { pitching: undefined });
    }, UNFOLD_S * 1000);
  }

  /** Cart `c` packed (to be hitched), or why not (packBlocked). */
  private pack(c: Vehicle): string | null {
    if (!c.open) return null;
    const why = this.packBlocked(c.id);
    if (why) return why;
    this.db.openVehicle(c.id, false);
    this.update(c.id, { open: false });
    return null;
  }

  /** Player `browserId` at `s`, the wrench in their bag, raises their parked cart `id` a level (shared/crafting.ts
   *  CART_UPGRADES), using up its materials from the bag. Returns the new level, or why not. */
  upgrade(browserId: string, s: PlayerState, id: unknown): number | string {
    const c = this.ownCart(browserId, s, id);
    if (typeof c === 'string') return c;
    if (!this.items.has(browserId, WRENCH)) return TEXT.notice.cantPlace;
    const box = vehicleBox(c.id);
    const level = cartLevel(this.items.slots('', box)[0]) + 1;
    if (level > CART_MAX_LEVEL || !CART_UPGRADES[level]) return TEXT.notice.fullyBuilt;
    const ok = this.db.tx(() => {
      if (!this.items.useUp(browserId, CART_UPGRADES[level])) return false;
      this.items.edit('', box, 0, (it) => (setData(it, 'level', level), true));
      return true;
    });
    if (!ok) return TEXT.notice.missingMaterials;
    this.refresh(box);
    if (level === 1 && c.open) this.pitch(c.id);
    return level;
  }

  /** The bike (or quad) player `rider` is riding, if any. */
  ridden(rider: number): Vehicle | undefined {
    return vehicles.find((v) => v.rider === rider && RIDDEN.includes(v.kind));
  }

  /** The cart player `rider` is towing, if any. */
  private towed(rider: number): Vehicle | undefined {
    return vehicles.find((v) => v.rider === rider && isCart(v));
  }

  /**
   * Player `rider` is off their vehicle: after riding it (`s`: where they got off), it's parked there; without `s`, it
   * stays where it stood.
   */
  release(rider: number, s?: PlayerState) {
    this.unboard(rider); // (riding on someone's back: off it)
    // The cart they tow first: parked behind the bike, where the state has it (shared/cart.ts towedPose), still linked.
    const c = this.towed(rider);
    if (c && !s) this.update(c.id, { rider: undefined });
    else if (c && s) {
      const at = towedPose(s), y = heightAt(at.x, at.z);
      this.db.moveVehicle(c.id, at.x, y, at.z, at.heading);
      this.update(c.id, { x: at.x, y, z: at.z, heading: at.heading, rider: undefined });
    }
    const v = this.ridden(rider);
    if (!v) return;
    // Its passenger is off with it (server/world.ts carryPassengers puts them down beside it).
    if (!s) return this.update(v.id, { rider: undefined, passenger: undefined });
    // In the air (died, left mid-jump): down on the ground under them.
    const y = s.grounded ? s.y : Math.min(s.y, heightAt(s.x, s.z));
    this.db.moveVehicle(v.id, s.x, y, s.z, s.heading);
    this.update(v.id, { x: s.x, y, z: s.z, heading: s.heading, rider: undefined, passenger: undefined });
  }

  /**
   * Player `rider` (at `s`) is still on their vehicle: writes where it is now (and the cart they tow), so a server that
   * stops without them getting off (a crash, a kill) brings it back near where they were, not where they got on.
   */
  persist(rider: number, s: PlayerState) {
    const c = this.towed(rider);
    if (c) {
      const at = towedPose(s);
      this.db.moveVehicle(c.id, at.x, heightAt(at.x, at.z), at.z, at.heading);
    }
    const v = this.ridden(rider);
    if (v) this.db.moveVehicle(v.id, s.x, s.grounded ? s.y : Math.min(s.y, heightAt(s.x, s.z)), s.z, s.heading);
  }

  /** Every few seconds: the finds stood up a while ago are replaced by broken ones. Returns the new ones' ids. */
  respawn(): number[] {
    const now = Date.now();
    const n = this.due.filter((t) => t <= now).length;
    if (!n) return [];
    this.due = this.due.filter((t) => t > now);
    return this.db.tx(() => Array.from({ length: n }, () => this.spawnFind().id));
  }

  /** The list for player `browserId`, with which are theirs. */
  joinMessage(browserId: string): ServerMsg {
    return { t: 'vehicles', list: vehicles, mine: this.mine(browserId) };
  }

  /** Changed since the last flush: the message for each player (joinMessage), or null. */
  flush(): ((browserId: string) => ServerMsg) | null {
    if (!this.changed) return null;
    this.changed = false;
    return (browserId) => this.joinMessage(browserId);
  }
}
