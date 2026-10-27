// The few seconds of black between dying and waking up (src/water.ts times them): the loading cover's blown sand
// (src/dustScreen.ts) coming up out of the dark with a hint, about what killed you when there is one for it.
import type { DeathCause } from '../shared/protocol.ts';
import { TEXT, type HintKeys } from '../shared/text.ts';
import { hintKeys } from './bindings';
import { showDustScreen, type DustScreen } from './dustScreen';

/** Where the hint sits: its middle this far down the screen (a share of it), a little under the middle. */
const HINT_Y = 0.6;
/** How long (s) the sand takes to come up from the dark. */
const DUST_IN = 3;
/** The share of hints about what killed you, where there are some. */
const ON_CAUSE = 0.7;

type Hint = string | ((k: HintKeys) => string);
const H = TEXT.hints;
/** The how-to banners that also make good hints, by what killed you ('any': whatever it was). */
const ALSO: Partial<Record<DeathCause | 'any', Hint[]>> = {
  any: [H.bedroll],
  heat: [H.canteen],
  storm: [H.storm_detector],
  laser: [H.jammer],
  guardian: [H.shield],
  crawler: [H.shield],
  missile: [H.shield],
  bomb: [H.shield],
  queen: [H.shield],
};

function hint(cause: DeathCause | null): string {
  const pool = (c: DeathCause | 'any'): Hint[] => [...(TEXT.deathHints[c] ?? []), ...(ALSO[c] ?? [])];
  const own = cause ? pool(cause) : [];
  const list = own.length && Math.random() < ON_CAUSE ? own : pool('any');
  const h = list[Math.floor(Math.random() * list.length)];
  return typeof h === 'function' ? h(hintKeys()) : h;
}

export class DeathDust {
  private el = document.createElement('div');
  private screen: DustScreen | null = null;

  constructor() {
    this.el.id = 'deathDust';
    // over the death fade's black (#deathFade, src/water.ts), under the menus
    this.el.style.cssText = 'position: fixed; inset: 0; z-index: 22; pointer-events: none; background: #050403; opacity: 0; display: none;';
    document.body.append(this.el);
  }

  /** Whether it's running (shown or not: see `opacity`). */
  get up() {
    return this.screen !== null;
  }

  /** Start it, unseen until `opacity` brings it up, with a hint for dying of `cause`. */
  start(cause: DeathCause | null) {
    this.stop();
    this.el.style.opacity = '0';
    this.el.style.display = 'block';
    // the hint is there whole from the start: it comes up with the screen (`opacity`), not a letter at a time
    const line = { text: hint(cause), style: 'prose' as const, at: 0, still: true };
    this.screen = showDustScreen(this.el, { cards: [{ lines: [line], y: HINT_Y }], dustIn: DUST_IN });
  }

  set opacity(a: number) {
    this.el.style.opacity = String(a);
  }

  stop() {
    this.screen?.stop();
    this.screen = null;
    this.el.style.display = 'none';
  }
}
