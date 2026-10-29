// A stage is what the client draws for one level (docs/levels.md "The client: stages"): one scene, one root per stage,
// and the active stage owns the scene-level state (fog, environment, background, the post profile) while it is active.
// A hidden root's lights are not collected by the renderer, so the active stage's lights are the scene's only lights:
// avatars, hands and held items (in the scene itself, common to every stage) are lit by whatever level they are in.
import type * as THREE from 'three/webgpu';
import type { Post } from '../post.ts';
import type { PlayerState } from '../../shared/sim.ts';
import type { Slots } from '../../shared/items.ts';
import type { SiteLink, WorkSite } from '../teardown/teardown.ts';
import type { SiteMsg } from '../net.ts';

export type { PostProfile } from '../post.ts';

/** What a stage's per-frame update gets. */
export type StageFrame = {
  dt: number;
  /** Page time (s): the pods' and lamps' animations. */
  time: number;
  /** The local player's (or the fly camera's) position, in the level's frame. */
  focus: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  /** Shared wall clock (Net.worldTime): the time of day. */
  worldTime: number;
  /** The server's clock (Net.serverTime, ms). */
  serverTime: number;
  /** The local player as predicted (src/net.ts me): a level's gates and where they stand. */
  me: PlayerState;
};

export interface Stage {
  /** The level it draws (shared/levels.ts; 0 the desert). */
  readonly level: number;
  /** Everything that belongs only to this level, lights included. */
  readonly root: THREE.Group;
  /** Took over the scene: set fog, environment, background, the post profile; show root. */
  enter(scene: THREE.Scene, post: Post): void;
  /** Gave it back: hide root, put nothing back (the next stage's enter sets everything). */
  leave(scene: THREE.Scene): void;
  /** Per-frame work while active. */
  update(frame: StageFrame): void;
  /** Just entered, still under the cover: resolves once it can be seen where the player now is (the desert's terrain
   *  streamed in and its dune shadows drawn round them), driven by update(); gives up after its own time limit. */
  arrive?(): Promise<void>;
  /** The switch away from it is over: the next stage is being drawn (the beginning's ride card clears). */
  gone?(): void;
  /** Built (and, for a level, its materials compiled) before the first enter. */
  readonly ready: Promise<void>;
  /** A machine of the level's own you stand at, to take apart (the beginning's cabinet), or null. `link`: its session. */
  workSite?(me: PlayerState, link: (id: string) => SiteLink): WorkSite | null;
  /** A disassembly message about one of its machines (src/net.ts onSite); true if it was. */
  site?(m: SiteMsg): boolean;
  /** What F does here before anything else (the beginning's hatch), or null. */
  interact?(me: PlayerState, bag: Slots | undefined): { prompt: string; act: () => void } | null;
  /** The beginning's beat `me` is at (shared/levels/beginning.ts BEATS) and what is in front of them (its speech). */
  beat?(me: PlayerState): { n: number; near: 'tray' | 'gap' | 'cabinet' | 'window' | null };
  /** How hard the ground shakes (0..1: src/camera.ts rumble), if it does. */
  readonly rumble?: number;
  /** The player's keys do nothing now (in the pod going down). */
  frozen?(me: PlayerState): boolean;
}

/** The fade to black and back (ms each way). */
const FADE_MS = 250;
/** The longest a switch waits for a stage to arrive (Stage.arrive) before showing it anyway (ms). */
const ARRIVE_MAX_MS = 8000;
/** A level whose stage failed is asked for again after this long (ms). */
const RETRY_MS = 10_000;

/**
 * Switching stages (docs/levels.md "Switching stages"): main.ts calls follow(level) every frame with the level the
 * local player is in. On a change the view fades to black over the last frame drawn (nothing is drawn meanwhile), the
 * stage is built on its first visit and kept, swapped in (the old one leaves, the new one enters), it arrives behind
 * the black (Stage.arrive: the desert streams its terrain round where we now stand), its materials are compiled on the
 * first visit (`warm`, src/warmup.ts: the light count is fixed, so that is the only compile), and the view fades back in.
 */
export class StageSwitch {
  /** False while a switch runs: main.ts draws nothing then. */
  drawing = true;
  private stages = new Map<number, Stage>();
  private building = new Map<number, Promise<Stage | null>>();
  private warmed = new Set<number>();
  private current: Stage;
  private busy = false;
  /** A level whose stage couldn't be had (none to draw, or its code failed to load): not asked for again until then
   *  (performance.now() ms), so follow() never loops fades. */
  private failedUntil = new Map<number, number>();
  /** Told when a stage's code can't be loaded at all (a deploy replaced it under a stale tab): offer a reload. */
  onBroken?: () => void;
  private fade = document.createElement('div');
  private scene: THREE.Scene;
  private post: Post;
  private make: (id: number) => Promise<Stage | null>;
  private warm: () => Promise<void>;
  private onStage: (s: Stage) => void;

  /**
   * `make` builds level `id`'s stage (null: there is none to draw, the desert stands in); `warm` compiles what is now
   * visible (the entered stage's root and everything common: avatars, hands); `onStage` is told the stage now active.
   */
  constructor(scene: THREE.Scene, post: Post, desert: Stage, make: (id: number) => Promise<Stage | null>, warm: () => Promise<void>,
    onStage: (s: Stage) => void) {
    this.scene = scene;
    this.post = post;
    this.make = make;
    this.warm = warm;
    this.onStage = onStage;
    this.current = desert;
    this.stages.set(desert.level, desert);
    this.warmed.add(desert.level);
    const f = this.fade;
    f.id = 'levelFade';
    f.style.cssText = `position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9;transition:opacity ${FADE_MS}ms linear`;
    document.body.append(f);
  }

  /** The level being drawn. */
  get level() {
    return this.current.level;
  }

  /** Called every frame with the level the player is in: switches to it if it isn't the one drawn. */
  follow(id: number) {
    if (this.busy || id === this.current.level || performance.now() < (this.failedUntil.get(id) ?? 0)) return;
    void this.switchTo(id);
  }

  /** Compile level `id`'s materials again on its next switch in (the desert, when we joined inside a level: its terrain
   *  wasn't there to be compiled behind the loading screen). */
  warmAgain(id: number) {
    this.warmed.delete(id);
  }

  /** Build level `id`'s stage ahead (near its door), so the switch only has to compile it. */
  prefetch(id: number) {
    if (performance.now() >= (this.failedUntil.get(id) ?? 0)) void this.stage(id).catch(() => {});
  }

  private stage(id: number): Promise<Stage | null> {
    const have = this.stages.get(id);
    if (have) return Promise.resolve(have);
    let p = this.building.get(id);
    if (!p) {
      p = this.make(id).then(async (s) => {
        if (s) {
          await s.ready;
          s.root.visible = false;
          this.scene.add(s.root);
          this.stages.set(id, s);
        }
        return s;
      });
      // Not kept when it fails: the next try loads it again (after the back-off).
      p.then((s) => { if (!s) this.building.delete(id); }, () => this.building.delete(id));
      this.building.set(id, p);
    }
    return p;
  }

  private async switchTo(id: number) {
    this.busy = true;
    this.drawing = false;
    this.fade.style.opacity = '1';
    let from: Stage | null = null;
    try {
      const [next] = await Promise.all([this.stage(id).catch((e) => {
        console.error('level stage failed to load', e);
        this.onBroken?.();
        return null;
      }), new Promise((r) => setTimeout(r, FADE_MS))]);
      // None to draw: the one we have stays (under the fade back in), and this level isn't asked for for a while.
      if (!next) this.failedUntil.set(id, performance.now() + RETRY_MS);
      const to = next ?? this.current;
      if (to !== this.current) {
        from = this.current;
        from.leave(this.scene);
        to.enter(this.scene, this.post);
        this.current = to;
        this.onStage(to);
        // (main.ts updates it meanwhile: it is the stage, and the level we are in)
        if (to.arrive) await Promise.race([to.arrive(), new Promise((r) => setTimeout(r, ARRIVE_MAX_MS))]);
      }
      if (!this.warmed.has(to.level)) {
        this.warmed.add(to.level);
        await this.warm();
      }
    } catch (e) {
      console.error('stage switch failed', e);
    } finally {
      // Back in over drawn frames: two more frames under the black, then the fade.
      this.drawing = true;
      requestAnimationFrame(() => requestAnimationFrame(() => (this.fade.style.opacity = '0')));
      this.busy = false;
      from?.gone?.();
    }
  }
}
