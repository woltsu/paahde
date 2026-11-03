// Each gun's own crosshair (src/rifle.ts draws it while a gun is in hand, in place of the dot of src/crosshair.ts):
// its shape is the gun's character, it opens with the hip-fire cone, its cell's recharge fills it back in, and a hit
// flashes it white. No numbers, no bars: the one HUD element a gun gets carries all of it.
// - pistol: small open brackets either side, a pip and a front-post tick below; the brackets redraw as it recharges.
// - rifle: a clean fine cross with a centre dot; its four lines fill back in from the outside.
// - blaster: a chunky amber ring (the burst) with four heavy notches, a dot and a little drop bar under it (its
//   bolt falls); the ring winds round clockwise over the long recharge.
// - piercer: long thin blue-white rails left and right, a penetrator chevron whose tip is the aim, and three
//   capacitor chevrons under it that light one by one, the last when it's ready.
// - graviton: a dark void ringed in violet, six motes slowly orbiting it on the cone (by the comfort motion setting),
//   lit one by one as it recharges.
// SVG, one per gun, drawn as `<use>` copies of the gun's glyph: a dark halo under it (reads on bright sand and at
// night), the glyph, and the hit flash. Per frame only three custom properties change on the shown one (`--g` the gap
// in px, `--q` the charge 0..1, `--rot` the graviton's turn), so no layout. Sized with the comfort HUD scale.
import { comfort } from './comfort';

export type ReticleGun = 'rifle' | 'pistol' | 'blaster' | 'piercer' | 'graviton';

/** The guns' colours (the beams': src/world/zaps.ts BEAMS). */
const COLOR: Record<ReticleGun, string> = {
  pistol: '#ffe9d6', rifle: '#f6f3ec', blaster: '#ffc67a', piercer: '#dcecff', graviton: '#c9a6ff',
};

/** Inline style for a stroke `w` px wide (+ the halo's extra on the halo copy) and anything else. */
const st = (w: number, more = '') => `style="stroke-width:calc(${w}px + var(--h));${more}"`;
/** Drawn up to the charge (pathLength 1). */
const FILL = 'stroke-dasharray:1 2;stroke-dashoffset:calc(1 - var(--q))';
/** Dim until the charge passes `t`, then lit. */
const LIT = (t: number) => `opacity:clamp(var(--track), (var(--q) - ${t}) * 999 + 1, 1)`;
/** Out along a direction at the gap (+ `d` px). */
const OUT = (deg: number, d = 0) => `transform:rotate(${deg}deg) translateX(calc(var(--g) * 1px + ${d}px))`;
const TRACK = 'opacity:var(--track)';

const GLYPH: Record<ReticleGun, string> = {
  // Open brackets, each a track and its redrawing fill; a pip and a short post below.
  pistol: [0, 180].map((a) => `<g style="${OUT(a)}">
    <path d="M-4 -5 H0 V5 H-4" fill="none" ${st(1.6, TRACK)}/>
    <path d="M-4 -5 H0 V5 H-4" fill="none" pathLength="1" ${st(1.6, FILL)}/></g>`).join('')
    + `<g style="${OUT(90, 1)}"><path d="M0 0 H4" ${st(1.8)}/></g><circle r="1.1" ${st(0)}/>`,
  // Four fine lines, filled from the outer end inwards; a centre dot.
  rifle: [0, 90, 180, 270].map((a) => `<g style="${OUT(a)}">
    <path d="M10 0 H1" ${st(1.6, TRACK)}/><path d="M10 0 H1" pathLength="1" ${st(1.6, FILL)}/></g>`).join('')
    + `<circle r="1.1" ${st(0)}/>`,
  // The burst ring: track, and the fill winding round from the top; four heavy notches; dot and drop bar.
  blaster: `<circle fill="none" ${st(2.4, `r:calc(var(--g) * 1px + 3px);${TRACK}`)}/>
    <circle fill="none" pathLength="1" ${st(2.4, `r:calc(var(--g) * 1px + 3px);transform:rotate(-90deg);${FILL}`)}/>`
    + [45, 135, 225, 315].map((a) => `<g style="${OUT(a, 6)}"><path d="M0 0 H5" ${st(2.6)}/></g>`).join('')
    + `<circle r="1.5" ${st(0)}/><path d="M-2.5 6.5 H2.5" ${st(1.6)}/>`,
  // Long rails, filled from the outside in; the penetrator chevron (tip on the aim); three capacitor chevrons.
  piercer: [0, 180].map((a) => `<g style="${OUT(a)}">
    <path d="M26 0 H3" ${st(1.4, TRACK)}/><path d="M26 0 H3" pathLength="1" ${st(1.4, FILL)}/></g>`).join('')
    + `<path d="M-3.5 4.5 L0 0.8 L3.5 4.5" fill="none" ${st(1.4)}/>`
    + [0, 1, 2].map((k) => `<g style="${OUT(90, 6 + k * 6.5)}"><path d="M2 -3 L0 0 L2 3" fill="none" ${st(1.4, LIT([0.99, 0.66, 0.33][k]))}/></g>`).join(''),
  // A faint orbit on the cone, six motes turning round it, lit as it recharges; the void in the middle.
  graviton: `<circle fill="none" ${st(0.8, `r:calc(var(--g) * 1px + 5px);opacity:calc(var(--track) * 0.8)`)}/>`
    + [0, 1, 2, 3, 4, 5].map((k) => `<g style="transform:rotate(calc(var(--rot) * 1deg + ${k * 60}deg)) translateX(calc(var(--g) * 1px + 5px))">
      <circle r="1.6" ${st(0.4, LIT((k + 1) / 6 - 0.01))}/></g>`).join('')
    + `<g style="transform:rotate(calc(var(--rot) * -2.2deg))"><path d="M0 -5.2 A5.2 5.2 0 0 1 4.5 2.6 M0 5.2 A5.2 5.2 0 0 1 -4.5 -2.6" fill="none" ${st(0.8, 'opacity:0.55')}/></g>`
    + `<circle r="2.6" fill="#16091f" ${st(1.1)}/>`,
};

/** Reduced motion asked for by the system: the graviton's motes stand still. */
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const css = `
#reticle { position: fixed; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; z-index: 4; display: none; zoom: var(--hud-scale, 1); }
body.rifleHeld #reticle { display: block; }
body.rifleHeld #crosshair { display: none; }
body.rifleScoped #reticle, body.gunSights #reticle, body.down #reticle { display: none; }
#reticle svg { position: absolute; left: -160px; top: -160px; width: 320px; height: 320px; overflow: visible; display: none;
  --g: 6; --q: 1; --rot: 0; }
#reticle svg.on { display: block; }
#reticle use { stroke-linecap: butt; stroke-linejoin: miter; }
#reticle .halo { --h: 2.2px; --track: 1; stroke: rgba(20, 10, 4, 0.6); fill: rgba(20, 10, 4, 0.6); }
#reticle .glyph { --h: 0px; --track: 0.22; stroke: currentColor; fill: currentColor; }
#reticle .flash { --h: 0.6px; --track: 1; stroke: #fff; fill: #fff; opacity: 0; transform-origin: 0 0; }
`;

export class Reticle {
  private el = document.createElement('div');
  private svgs = {} as Record<ReticleGun, SVGSVGElement>;
  private flashes = {} as Record<ReticleGun, SVGUseElement>;
  private gun: ReticleGun | null = null;
  private turn = 0;
  private last = { g: '', q: '', rot: '' };

  constructor(parent: HTMLElement = document.body) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    this.el.id = 'reticle';
    this.el.innerHTML = (Object.keys(GLYPH) as ReticleGun[]).map((gun) => `<svg class="${gun}" viewBox="-160 -160 320 320" style="color:${COLOR[gun]}">
<defs><g id="ret-${gun}">${GLYPH[gun]}</g></defs>
<use href="#ret-${gun}" class="halo"/><use href="#ret-${gun}" class="glyph"/><use href="#ret-${gun}" class="flash"/></svg>`).join('');
    for (const svg of this.el.querySelectorAll('svg')) {
      const gun = svg.classList[0] as ReticleGun;
      this.svgs[gun] = svg;
      this.flashes[gun] = svg.querySelector('.flash')!;
    }
    parent.append(this.el);
  }

  /** This frame: `gun`'s crosshair, its gap `gapPx` (screen px from the centre: the cone), the cell's `charge` 0..1;
   *  `dt` turns the graviton's motes. */
  set(gun: ReticleGun, gapPx: number, charge: number, dt: number) {
    if (gun !== this.gun) {
      if (this.gun) this.svgs[this.gun].classList.remove('on');
      this.svgs[gun].classList.add('on');
      this.gun = gun;
      this.last = { g: '', q: '', rot: '' };
    }
    const s = this.svgs[gun].style;
    const g = (gapPx / comfort.hudScale).toFixed(1);
    const q = Math.max(0, Math.min(1, charge)).toFixed(3);
    if (g !== this.last.g) s.setProperty('--g', (this.last.g = g));
    if (q !== this.last.q) s.setProperty('--q', (this.last.q = q));
    if (gun === 'graviton') {
      this.turn = (this.turn + dt * 14 * comfort.motion * (reduced ? 0 : 1)) % 360;
      const rot = this.turn.toFixed(1);
      if (rot !== this.last.rot) s.setProperty('--rot', (this.last.rot = rot));
    }
  }

  /** Our shot hit something: the crosshair flashes white-hot and opens a little. */
  hit() {
    if (!this.gun) return;
    const big = this.gun === 'blaster' || this.gun === 'piercer' || this.gun === 'graviton';
    this.flashes[this.gun].animate(
      [{ opacity: 0.95, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${big ? 1.35 : 1.25})` }],
      { duration: big ? 260 : 170, easing: 'ease-out' },
    );
  }
}

