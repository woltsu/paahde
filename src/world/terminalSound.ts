// The net terminals' loop (public/audio/terminal.mp3, by Veikko Suhonen): one voice, quiet, at the nearest terminal in
// earshot (there is seldom more than one), played through its event (src/audioConfig.ts 'terminal.hum': its level and
// reach are there) on a Web Audio panner that follows the terminal. Every NetTerminal.update offers where its screen is;
// once a frame (a microtask after those updates) the loop goes to the nearest, crossfading when that changes, faded to
// nothing over the last quarter of earshot. When no terminal has offered for a moment (another stage, a hidden tab)
// it fades out.
import type * as THREE from 'three/webgpu';
import { audio } from '../audio.ts';
import { event, sampleId } from '../audioConfig.ts';
import { loadSample, play, type Voice } from '../sounds.ts';

/** Earshot (m): the event's `hear`. */
const HEAR = event('terminal.hum').hear ?? 12;
/** Fade in and out, and following the distance (s, time constants). */
const FADE = 0.6;
const FOLLOW = 0.1;
/** With no offer for this long (ms), the loop fades out. */
const IDLE_MS = 300;

type Offer = { who: object; x: number; y: number; z: number; d: number };

let offers: Offer[] = [];
let pending = false;
let voice: Voice | null = null;
let level = 0;
let current: object | null = null;
let loading = false;
let idle: ReturnType<typeof setTimeout> | null = null;

/** A terminal (`who`, any stable object) says where its sound comes from, `eye` the listener; each frame. */
export function offerTerminalSound(who: object, at: THREE.Vector3, eye: THREE.Vector3) {
  const d = at.distanceTo(eye);
  if (d < HEAR) offers.push({ who, x: at.x, y: at.y, z: at.z, d });
  if (!pending) {
    pending = true;
    queueMicrotask(resolve);
  }
}

/** A terminal gone (disposed): its loop, if it has it, fades out. */
export function dropTerminalSound(who: object) {
  if (current === who) fadeOut();
}

function resolve() {
  pending = false;
  const near = offers.reduce<Offer | null>((a, o) => (!a || o.d < a.d ? o : a), null);
  offers = [];
  if (idle) clearTimeout(idle);
  idle = setTimeout(fadeOut, IDLE_MS);
  if (!near) return fadeOut();
  if (near.who !== current) {
    fadeOut();
    current = near.who;
  }
  const ctx = audio.ctx;
  if (!ctx || !audio.running) return;
  // Full within the inner three quarters of earshot (the panner's 1/d does the rest), to nothing at its edge.
  const edge = Math.min(1, (HEAR - near.d) / (HEAR / 4));
  if (voice) {
    const p = voice.panner;
    if (p) {
      p.positionX.value = near.x;
      p.positionY.value = near.y;
      p.positionZ.value = near.z;
    }
    voice.gain.gain.setTargetAtTime(level * edge, ctx.currentTime, FOLLOW);
  } else start(near, edge);
}

function start(at: Offer, edge: number) {
  const ctx = audio.ctx;
  if (!ctx || loading) return;
  loading = true;
  const who = at.who;
  void loadSample(sampleId(event('terminal.hum').sounds[0])).then((buf) => {
    loading = false;
    if (!buf || voice || current !== who) return;
    const v = play('terminal.hum', { x: at.x, y: at.y, z: at.z });
    if (!v?.src) return;
    v.src.loop = true; // (the whole file: its encode is gapless)
    level = v.gain.gain.value;
    // From silence, no click.
    const now = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(0, now);
    v.gain.gain.setTargetAtTime(level * edge, now, FADE);
    voice = v;
  });
}

function fadeOut() {
  voice?.stop(FADE / 3);
  voice = null;
  current = null;
}
