// The loading cover (#cover in index.html): the prologue, a dust screen (src/dustScreen.ts) started from src/entry.ts
// before the big game bundle has downloaded and stopped by src/main.ts when the cover leaves: its paragraphs fading
// in one after another, then the title card, over a loading bar.
// A tab's first load tells the whole prologue and keeps the cover up until it is told (or a key or click skips it);
// a reload in the same tab (a deploy, src/update.ts), or any load once this browser has joined a game, shows only
// the title. `&prologue` in the address (e.g. `?w=lab&prologue`) tells the whole prologue every time and keeps the cover
// up for good, to look at it.
import { TEXT } from '../shared/text.ts';
import { showDustScreen, type DustScript } from './dustScreen';

// The prologue's timeline (s): each paragraph starts, then they all go and the card comes up and stays.
const PARA_AT = [2.5, 6.9, 11.5, 14.6];
const OUT_AT = 18;
const CARD_AT = 19.6;
/** When the full prologue has been told: the cover stays up at least this long on a tab's first load. */
const PROLOGUE_S = CARD_AT + 4;
const TITLE_AT = 0.4; // the title alone, on a reload

/** `full`: the whole prologue; otherwise only the title. */
function script(full: boolean): DustScript {
  const title = { text: TEXT.game.title, style: 'title' as const };
  if (!full) return { cards: [{ lines: [{ ...title, at: TITLE_AT }] }], bar: true };
  return {
    cards: [
      { lines: TEXT.prologue.lines.map((text, i) => ({ text, style: 'prose' as const, at: PARA_AT[i] ?? PARA_AT[PARA_AT.length - 1] + 3 * (i - PARA_AT.length + 1) })), out: OUT_AT },
      { lines: [{ ...title, at: CARD_AT }, { text: TEXT.prologue.time, style: 'caption', at: CARD_AT + 1.4 }] },
    ],
    bar: true,
  };
}

let off: (() => void) | null = null;
let progress: (p: number) => void = () => {};
let until = 0; // performance.now() the cover may lift at
const KEEP = new URLSearchParams(location.search).has('prologue');

function start() {
  const cover = document.getElementById('cover');
  if (!cover || off) return;
  let full = true;
  try {
    full = !sessionStorage.getItem('prologueSeen') && !localStorage.getItem('joinedBefore');
    sessionStorage.setItem('prologueSeen', '1');
  } catch {
    // no storage: tell it every time
  }
  if (KEEP) full = true;
  until = KEEP ? Infinity : full ? performance.now() + PROLOGUE_S * 1000 : 0;
  const skip = () => (until = KEEP ? Infinity : 0);
  const screen = showDustScreen(cover, script(full));
  progress = screen.progress;
  addEventListener('keydown', skip);
  addEventListener('pointerdown', skip);
  off = () => {
    screen.stop();
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
  };
}

function stopPrologue() {
  off?.();
  off = null;
  progress = () => {};
}

/** We joined a game: from now on this browser sees only the title. */
function joined() {
  try {
    localStorage.setItem('joinedBefore', '1');
  } catch {
    // no storage: the prologue is told again next time
  }
}

export const prologue = {
  joined,
  start,
  stop: stopPrologue,
  progress: (p: number) => progress(p),
  /** Whether the cover may lift: the prologue has been told, skipped, or was only the title. */
  told: () => performance.now() >= until,
};
