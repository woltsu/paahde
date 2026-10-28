// The ride down (docs/levels/tutorial.md "Then the pod"): in the pod the shaking and the roar grow for a few seconds, then
// the dust screen comes up out of the dark (src/dustScreen.ts, as the prologue's and the death's) with the one card, and
// stays over the move to the desert (server/tutorial.ts RIDE_MS) until the desert is drawn under it; then it goes.
import { TEXT } from '../../../shared/text.ts';
import { showDustScreen, type DustScreen } from '../../dustScreen';

/** Seconds of shaking in the seat before the dust comes up, and its fade in and out. */
export const SHAKE_S = 2.8;
const IN_S = 0.8;
const OUT_S = 1.5;
/** Where the card sits (its middle, a share of the screen's height). */
const CARD_Y = 0.5;

export class Ride {
  private el = document.createElement('div');
  private screen: DustScreen | null = null;
  /** Seconds since F at the hatch (-1: not riding). */
  t = -1;

  constructor() {
    // Over the level switch's black (#levelFade, src/levels/stage.ts), under the menus.
    this.el.style.cssText = `position: fixed; inset: 0; z-index: 22; pointer-events: none; background: #050403; opacity: 0; display: none; transition: opacity ${IN_S}s linear;`;
    document.body.append(this.el);
  }

  /** In the pod: from now. */
  start() {
    if (this.t >= 0) return;
    this.t = 0;
  }

  /** Every frame while riding: how hard it shakes (0..1). */
  update(dt: number): number {
    if (this.t < 0) return 0;
    this.t += dt;
    if (this.t >= SHAKE_S && !this.screen) {
      this.el.style.display = 'block';
      const line = { text: TEXT.tutorial.card, style: 'prose' as const, at: 0.6, still: true };
      this.screen = showDustScreen(this.el, { cards: [{ lines: [line], y: CARD_Y }], dustIn: 1.5 });
      requestAnimationFrame(() => (this.el.style.opacity = '1'));
    }
    return Math.min(1, 0.5 + this.t / SHAKE_S);
  }

  /** Down: the desert is under the dust; it clears. */
  landed() {
    if (this.t < 0) return;
    this.t = -1;
    setTimeout(() => {
      this.el.style.transition = `opacity ${OUT_S}s linear`;
      this.el.style.opacity = '0';
      setTimeout(() => {
        this.screen?.stop();
        this.screen = null;
        this.el.style.display = 'none';
        this.el.style.transition = `opacity ${IN_S}s linear`;
      }, OUT_S * 1000);
    }, 1200);
  }
}
