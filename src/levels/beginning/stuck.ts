// The beginning's key hints, only for someone stuck (docs/levels/tutorial.md "Control hints"): the world asks first; at an
// obstacle for STUCK_S without getting past it, its one key comes up, terse, at the bottom of the screen (src/bindings.ts
// ctl: rebinding and the pad followed), and goes as soon as you are past. Each at most once in a world (localStorage,
// under the world's id): the "can't be played without it" case, a new player can't guess there is an air jump.
import { BLAST, FALLEN, GAP, TRAY } from '../../../shared/levels/beginning.ts';
import type { PlayerState } from '../../../shared/sim.ts';
import { TEXT } from '../../../shared/text.ts';
import { WORLD_ID } from '../../../shared/world.ts';
import { ctl, type Prompt } from '../../bindings';

/** Seconds at an obstacle before its key shows. */
const STUCK_S = 8;
const KEY = `beginningHints@${WORLD_ID}`;

type Obstacle = { id: keyof typeof TEXT.tutorial.stuck; key: Prompt; at: (s: PlayerState) => boolean; past: (s: PlayerState) => boolean };

/** Where each one is asked for, and when you are past it. */
const OBSTACLES: Obstacle[] = [
  { id: 'crouch', key: 'crouch', at: (s) => s.z > TRAY.z0 - 2.5 && s.z < TRAY.z1 && s.y > -0.5, past: (s) => s.z > TRAY.z1 + 0.5 },
  { id: 'jump', key: 'jump', at: (s) => s.z > FALLEN.z0 - 2.5 && s.z < FALLEN.z0 && s.y < 0.5 && s.y > -0.5, past: (s) => s.z > FALLEN.z1 },
  // The gap: at its edge, or down in the sub-floor after a jump that fell short.
  { id: 'airJump', key: 'jump', at: (s) => (s.z > GAP.z0 - 3 && s.z < GAP.z0 && s.z > FALLEN.z1 && s.y > -0.5) || s.y < -1, past: (s) => s.z > GAP.z1 && s.y > -0.5 },
  { id: 'slide', key: 'sprint', at: (s) => s.z > BLAST.z0 - 3 && s.z < BLAST.z0, past: (s) => s.z > BLAST.z1 },
];

const css = `#beginningHint { position: fixed; left: 50%; bottom: 18%; transform: translateX(-50%); padding: 4px 10px;
  font: 600 14px var(--mono); color: #fff4e4; background: rgba(20, 10, 5, 0.55); border-radius: 4px; pointer-events: none;
  white-space: nowrap; opacity: 0; transition: opacity 0.4s; }
#beginningHint kbd { font: bold 12px var(--mono); padding: 0 5px; margin-right: 7px; border-radius: 3px; background: #fff4e4; color: #2a160a; }`;

export class StuckHints {
  private el = document.createElement('div');
  private seen: Set<string>;
  private stuck = new Map<string, number>();
  private shown: Obstacle | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    this.el.id = 'beginningHint';
    document.body.append(this.el);
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      seen = [];
    }
    this.seen = new Set(seen);
  }

  /** Every frame in the beginning (`on`: false elsewhere, or in the pod: whatever shows goes). */
  update(dt: number, s: PlayerState, on: boolean) {
    if (this.shown && (!on || this.shown.past(s))) this.hide();
    if (!on) return;
    for (const o of OBSTACLES) {
      if (this.seen.has(o.id) || o.past(s)) continue;
      const t = o.at(s) ? (this.stuck.get(o.id) ?? 0) + dt : 0;
      this.stuck.set(o.id, t);
      if (t >= STUCK_S && !this.shown) this.show(o);
    }
  }

  private show(o: Obstacle) {
    this.shown = o;
    this.seen.add(o.id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.seen]));
    } catch { /* (private mode: shown again next time) */ }
    this.el.innerHTML = ctl(o.key, TEXT.tutorial.stuck[o.id]);
    this.el.style.opacity = '1';
  }

  private hide() {
    this.shown = null;
    this.el.style.opacity = '0';
  }

  /** Gone (leaving the level). */
  clear() {
    if (this.shown) this.hide();
  }
}
