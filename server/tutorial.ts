// The beginning's progress on the server (docs/levels/tutorial.md, shared/levels/beginning.ts): the level is one per
// player, and what changes in it as you go lives in your own PlayerState.gates, which only the server sets. A bit is set
// when you reach its trigger box (a door you come near, the blast door starting down, the hall's jolt) or do the thing
// (the relay out of the cabinet, into the pod's panel, F at the hatch), and reaches the client with the next
// reconciliation, as `level` does: no input bit asks for it. server/world.ts does the moving and the bag; this keeps the
// per-player state: the cabinet's session (never saved: the level is short, a reconnect finds it whole again, its relay
// out if `gates` says so) and the ride down.
import { CABINET, GATE, POD, POD_OPEN_MS, beginningLevel, beatAt, triggersAt } from '../shared/levels/beginning.ts';
import { CABINET_GONE, CABINET_ID, RELAY_INDEX, cabinetSteps } from '../shared/levels/beginningCabinet.ts';
import { partAllowed, stepAllowed } from '../shared/machineSteps.ts';
import { inBox } from '../shared/levels.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';

/** This module's level. */
export const TUTORIAL = beginningLevel.id;
/** The grant (server/db.ts grants) of someone who has been through it, or skipped it, in this world. */
export const BEGINNING_DONE = 'beginning_done';
/** From F at the hatch to waking in the desert (ms): the hatch shuts, ~3 s of shaking in the seat, the dust screen and
 *  its card (src/levels/beginning/ride.ts plays the same). */
export const RIDE_MS = 7000;
/** How far from the cabinet (m) its steps count. */
const CABINET_REACH = 6;
/** How far outside the hatch's box (m) F still counts (the client asks from where it predicts it is). */
const HATCH_SLACK = 0.6;

type Session = { done: Set<number>; taken: Set<number> };

/** After a tick: the bits of the triggers `s` stands in, set (the same state if none is new). */
export function tickTriggers(s: PlayerState): PlayerState {
  if (s.level !== TUTORIAL) return s;
  const bits = triggersAt(s.x, s.y, s.z);
  return (s.gates & bits) === bits ? s : { ...s, gates: s.gates | bits };
}

/** At the pod's hatch? */
export const atHatch = (s: PlayerState) => {
  const b = POD.hatch, e = HATCH_SLACK;
  return s.level === TUTORIAL && inBox([b[0] - e, b[1] + e, b[2] - e, b[3] + e, b[4] - e, b[5] + e], s.x, s.y, s.z);
};

/** The beat (docs/levels/tutorial.md "Shape") `s` is at. */
export const beatOf = (s: PlayerState) => beatAt(s.x, s.y, s.z);

export class TutorialServer {
  /** Each player's cabinet, by public id. */
  private cabinets = new Map<number, Session>();
  /** Who is in the pod going down, and when they land (performance.now() ms), by public id. */
  private rides = new Map<number, number>();
  /** Whose pod is still opening (its panel shutting, its hatch swinging down), and till when (ms), by public id. */
  private opening = new Map<number, number>();

  private cabinet(pid: number, gates: number): Session {
    let c = this.cabinets.get(pid);
    if (!c) {
      c = { done: new Set(), taken: new Set(CABINET_GONE) };
      if (gates & GATE.control) c.taken.add(RELAY_INDEX); // (back after a reconnect with it already out)
      this.cabinets.set(pid, c);
    }
    return c;
  }

  /** Is `id` the cabinet's session (a site message for this module)? */
  isSite(id: unknown) {
    return id === CABINET_ID;
  }

  /**
   * A disassembly message about the cabinet from `pid` standing at `s` (siteJoin, siteDone, siteTake, siteLeave): the
   * answers to send them, and the gates to set. `give()` puts the relay in their bag (false: no room).
   */
  site(pid: number, s: PlayerState, msg: { t: string; i?: unknown }, give: () => boolean): { answers: ServerMsg[]; gates: number } {
    const none = { answers: [], gates: s.gates };
    if (s.level !== TUTORIAL || Math.hypot(s.x - CABINET.x, s.z - CABINET.z) > CABINET_REACH) return none;
    if (msg.t === 'siteLeave') return none;
    const c = this.cabinet(pid, s.gates);
    const id = CABINET_ID;
    if (msg.t === 'siteJoin') return { answers: [{ t: 'siteState', id, done: [...c.done], taken: [...c.taken] }], gates: s.gates };
    const i = msg.i;
    if (typeof i !== 'number' || !Number.isInteger(i)) return none;
    const rules = cabinetSteps();
    if (msg.t === 'siteDone') {
      if (!stepAllowed(rules, c.done, i)) return none;
      c.done.add(i); // (no scrap: nothing of the level's is kept)
      return { answers: [{ t: 'siteDone', id, i }], gates: s.gates };
    }
    if (msg.t === 'siteTake') {
      if (i !== RELAY_INDEX || c.taken.has(i) || !partAllowed(rules, c.done, i)) return none;
      if (!give()) return { answers: [{ t: 'siteTook', id, i, ok: false, reason: 'full' }], gates: s.gates };
      c.taken.add(i);
      // With the relay gone the cabinet's interlock lets go: the door to the bay corridor opens.
      return { answers: [{ t: 'siteTake', id, i, by: pid }, { t: 'siteTook', id, i, ok: true, kind: 'tut_relay' }], gates: s.gates | GATE.control };
    }
    return none;
  }

  /** F at the hatch: the relay into the pod's panel (`take()` uses it up: false if it isn't in the bag), or, once it is
   *  in and the hatch has swung open (POD_OPEN_MS), into the pod and down. The gates to set, or null if nothing happens. */
  hatch(pid: number, s: PlayerState, take: () => boolean, now: number): number | null {
    if (!atHatch(s) || this.rides.has(pid)) return null;
    if (!(s.gates & GATE.powered)) {
      if (!take()) return null;
      this.opening.set(pid, now + POD_OPEN_MS);
      return s.gates | GATE.powered;
    }
    // (Back after a reconnect with the relay in: it stands open.)
    if (now < (this.opening.get(pid) ?? 0)) return null;
    this.opening.delete(pid);
    this.rides.set(pid, now + RIDE_MS);
    return s.gates | GATE.launch;
  }

  /** In the pod going down: their keys do nothing until they land. */
  riding(pid: number) {
    return this.rides.has(pid);
  }

  /** Landed: the ride is over (true once, at the time). */
  landed(pid: number, now: number): boolean {
    const at = this.rides.get(pid);
    if (at === undefined || now < at) return false;
    this.rides.delete(pid);
    return true;
  }

  /** Gone from the level (out, skipped, disconnected): what was theirs in it is forgotten. */
  forget(pid: number) {
    this.cabinets.delete(pid);
    this.rides.delete(pid);
    this.opening.delete(pid);
  }
}
