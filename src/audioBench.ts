// The audio workbench (debug menu → Sound → Audio workbench, ?debug only): plays any sound event or sample of
// src/audioConfig.ts through the game's own audio graph (src/samples.ts, src/acoustics.ts, the buses and limiter of
// src/audio.ts) from a spot round you, and tunes the config live.
//
// - Events / Samples: the two lists of the config, filtered by the search box; ▶ plays one, a click opens it below.
// - Where: a top-down pad round you (you at the centre facing up, distance on a log scale out to 600 m; click or drag
//   to place the sound), its height over your ears, and presets. "In your head" plays it as your own (no spot).
//   The spot is taken relative to where you stand and look each time it plays, so "Repeat" follows you about.
// - Route: as the event says, or forced (direct, placed, panned, music). Samples play placed when given a spot.
//   Footsteps and the bike's landing are played by their own modules (src/footsteps.ts, src/bikeLandSound.ts).
// - Editing: an event's gain, pitch, spread and reach, a sample's trim (dB; "→ −23" levels it from its `lufs`).
//   Edits apply at once (the game reads the config on every play), are kept in this browser and come back on
//   reload; "Copy edits" gives them as a list to carry into src/audioConfig.ts, "Reset" drops them.
// The panel is clickable while the mouse is free (F3 frees it).
import { audio } from './audio';
import type { P } from './acoustics';
import { EVENTS, SAMPLES, event, sample, sampleId, type EventDef, type EventId, type Route, type SampleDef, type SampleId } from './audioConfig';
import { bikeLandSound } from './bikeLandSound';
import { footsteps } from './footsteps';
import { loadSample, play, playSample, sampleBuffer, type Voice } from './samples';
import { BIKE_HARD_LANDING } from '../shared/sim.ts';

const EDITS_KEY = 'audioBench.edits';
const OPEN_KEY = 'audioBench.open';
/** The pad's reach (m) and its rings. */
const PAD_MAX = 600;
const RINGS = [5, 20, 100, 600];
const PRESETS: [string, number, number][] = [['Front 5 m', 0, 5], ['Left 20 m', -90, 20], ['Right 50 m', 90, 50], ['Behind 100 m', 180, 100], ['Front 300 m', 0, 300]];
const EVENT_FIELDS = ['gain', 'pitch', 'vary', 'jitter', 'ref', 'hear'] as const;
type EventField = (typeof EVENT_FIELDS)[number];
interface Edits { samples: Partial<Record<SampleId, { trim: number }>>; events: Partial<Record<EventId, Partial<Record<EventField, number>>>> }

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const db = (g: number) => 20 * Math.log10(g);
const fmt = (v: number | undefined, d = 2) => (v === undefined ? '–' : String(+v.toFixed(d)));

export interface BenchView {
  /** The ears (the camera) and which way they face (three.js yaw: forward = (−sin, −cos)). */
  ear: P;
  yaw: number;
}

export class AudioBench {
  private panel = document.createElement('div');
  private tab: 'events' | 'samples' = 'events';
  private filter = '';
  private sel: { kind: 'event'; id: EventId } | { kind: 'sample'; id: SampleId } | null = null;
  /** The spot: bearing (degrees clockwise from where you look), distance (m), height over the ears (m); or your head. */
  private bearing = 0;
  private dist = 20;
  private height = 0;
  private head = false;
  private route: Route | '' = '';
  private repeat: ReturnType<typeof setInterval> | undefined;
  private voices = new Set<Voice>();
  private last: (() => void) | null = null;
  /** The config as written, to diff edits against and reset to. */
  private original = { samples: structuredClone(SAMPLES) as Record<SampleId, SampleDef>, events: structuredClone(EVENTS) as Record<EventId, EventDef> };
  private edits: Edits = { samples: {}, events: {} };

  private view: () => BenchView;

  constructor(view: () => BenchView) {
    this.view = view;
    this.load();
    this.build();
    try { if (localStorage.getItem(OPEN_KEY) === '1') this.toggle(true); } catch { /* no storage */ }
  }

  toggle(open = this.panel.style.display === 'none') {
    this.panel.style.display = open ? 'flex' : 'none';
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* no storage */ }
    if (open) {
      this.list();
      this.detail();
      this.pad();
    }
  }

  // ---- edits ----

  private load() {
    try {
      const e = JSON.parse(localStorage.getItem(EDITS_KEY) ?? 'null') as Edits | null;
      if (e) this.edits = { samples: e.samples ?? {}, events: e.events ?? {} };
    } catch { /* no storage, or junk */ }
    for (const [id, s] of Object.entries(this.edits.samples) as [SampleId, { trim: number }][]) if (SAMPLES[id]) sample(id).trim = s.trim;
    for (const [id, f] of Object.entries(this.edits.events) as [EventId, Partial<Record<EventField, number>>][]) if (EVENTS[id]) Object.assign(event(id), f);
  }

  private save() {
    try { localStorage.setItem(EDITS_KEY, JSON.stringify(this.edits)); } catch { /* no storage */ }
    this.footer();
  }

  private setTrim(id: SampleId, trim: number) {
    trim = Math.round(trim * 10) / 10;
    sample(id).trim = trim;
    if (trim === this.original.samples[id].trim) delete this.edits.samples[id];
    else this.edits.samples[id] = { trim };
    this.save();
  }

  private setField(id: EventId, f: EventField, v: number) {
    const e = event(id) as EventDef & Partial<Record<EventField, number>>, o = this.original.events[id] as EventDef & Partial<Record<EventField, number>>;
    e[f] = v;
    const ed = (this.edits.events[id] ??= {});
    if (v === o[f]) delete ed[f];
    else ed[f] = v;
    if (!Object.keys(ed).length) delete this.edits.events[id];
    this.save();
  }

  private diff() {
    const lines = ['// Audio workbench edits, for src/audioConfig.ts'];
    for (const [id, s] of Object.entries(this.edits.samples) as [SampleId, { trim: number }][])
      lines.push(`SAMPLES['${id}'].trim: ${this.original.samples[id].trim} → ${s.trim}`);
    for (const [id, f] of Object.entries(this.edits.events) as [EventId, Partial<Record<EventField, number>>][])
      for (const [k, v] of Object.entries(f)) lines.push(`EVENTS['${id}'].${k}: ${fmt((this.original.events[id] as unknown as Record<string, number>)[k], 4)} → ${fmt(v, 4)}`);
    return lines.join('\n');
  }

  private reset() {
    for (const id of Object.keys(this.edits.samples) as SampleId[]) sample(id).trim = this.original.samples[id].trim;
    for (const id of Object.keys(this.edits.events) as EventId[]) {
      const e = event(id) as unknown as Record<string, number | undefined>, o = this.original.events[id] as unknown as Record<string, number | undefined>;
      for (const f of EVENT_FIELDS) e[f] = o[f];
    }
    this.edits = { samples: {}, events: {} };
    this.save();
    this.detail();
  }

  // ---- playing ----

  /** Where the sound is now (null: in your head), and the ears. */
  private spot(): { at: P | null; ear: P } {
    const { ear, yaw } = this.view();
    if (this.head) return { at: null, ear: { x: ear.x, y: ear.y, z: ear.z } };
    const b = (this.bearing * Math.PI) / 180, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = fx * Math.cos(b) + rx * Math.sin(b), dz = fz * Math.cos(b) + rz * Math.sin(b);
    return { at: { x: ear.x + dx * this.dist, y: ear.y + this.height, z: ear.z + dz * this.dist }, ear: { x: ear.x, y: ear.y, z: ear.z } };
  }

  private keep(v: Voice | null) {
    if (!v) return;
    this.voices.add(v);
    v.src.addEventListener('ended', () => this.voices.delete(v));
  }

  private playEvent(id: EventId) {
    const go = () => {
      const { at, ear } = this.spot(), e = event(id), route = this.route || e.route;
      for (const r of e.samples) void loadSample(sampleId(r));
      // The bespoke ones, as the game plays them (they keep their own listener: where you are).
      if (route === 'panned' && (id === 'footstep.sand' || id === 'footstep.concrete')) {
        const p = at ?? ear;
        footsteps.step(p.x, p.z, 6, id === 'footstep.sand' ? 'sand' : 'concrete');
      } else if (route === 'panned' && id === 'bike.land') {
        const p = at ?? ear;
        bikeLandSound.play(p.x, p.z, BIKE_HARD_LANDING);
      } else this.keep(play(id, at, ear, { route }));
    };
    this.run(go);
  }

  private playSampleId(id: SampleId) {
    const go = () => {
      const { at, ear } = this.spot(), s = sample(id);
      const route = this.route || (s.loop ? 'music' : at ? 'placed' : 'direct');
      this.keep(playSample(id, { route, at, ear, level: 1, ref: route === 'panned' ? 2.5 : 15, hear: route === 'panned' ? 30 : 600 }));
    };
    this.run(go);
  }

  /** Play now (loading first if needed), and again every `Repeat` seconds while it's ticked. */
  private run(go: () => void) {
    this.last = go;
    if (!audio.ctx) return this.flash('Click anywhere first (audio starts on a gesture)');
    void Promise.all(this.wanted().map(loadSample)).then(go);
    this.rearm();
  }

  private wanted(): SampleId[] {
    if (!this.sel) return [];
    return this.sel.kind === 'sample' ? [this.sel.id] : event(this.sel.id).samples.map(sampleId);
  }

  private rearm() {
    clearInterval(this.repeat);
    const box = this.q<HTMLInputElement>('#abRepeat'), every = Number(this.q<HTMLInputElement>('#abEvery').value);
    if (box.checked && this.last && every > 0.05) this.repeat = setInterval(() => this.last?.(), every * 1000);
  }

  private stopAll() {
    clearInterval(this.repeat);
    this.q<HTMLInputElement>('#abRepeat').checked = false;
    for (const v of this.voices) v.stop(0.05);
    this.voices.clear();
  }

  // ---- the panel ----

  private q<T extends HTMLElement>(s: string) {
    return this.panel.querySelector<T>(s)!;
  }

  private flash(text: string) {
    const m = this.q<HTMLElement>('#abMsg');
    m.textContent = text;
    setTimeout(() => m.textContent === text && (m.textContent = ''), 2500);
  }

  private build() {
    const style = document.createElement('style');
    style.textContent = `
#audioBench { position: fixed; top: 48px; left: 12px; width: 380px; max-height: calc(100vh / var(--ui, 1) - 60px); display: none;
  flex-direction: column; gap: 6px; padding: 8px 10px 10px; box-sizing: border-box; font: 12px var(--mono); color: #ffe9cc;
  background: rgba(20, 10, 5, 0.9); border-radius: 8px; box-shadow: 0 0 0 1px rgba(255, 240, 220, 0.18); z-index: 10; }
#audioBench h4 { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; display: flex; gap: 6px; align-items: center; }
#audioBench h4 .sp { flex: 1; }
#audioBench button, #audioBench select, #audioBench input:not([type=checkbox]):not([type=range]) { font: inherit; color: inherit;
  background: rgba(255, 233, 204, 0.12); border: 0; border-radius: 4px; padding: 3px 7px; }
#audioBench button { cursor: pointer; }
#audioBench button:hover { background: rgba(255, 233, 204, 0.25); }
#audioBench button.on { background: rgba(255, 190, 110, 0.35); }
#audioBench button.go { background: rgba(255, 190, 110, 0.28); }
#audioBench .row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#audioBench .list { overflow-y: auto; flex: 1 1 160px; min-height: 80px; max-height: 30vh; overscroll-behavior: contain; border-top: 1px solid rgba(255, 240, 220, 0.12); }
#audioBench .item { display: flex; gap: 6px; align-items: center; padding: 2px 2px; cursor: pointer; border-radius: 3px; }
#audioBench .item:hover { background: rgba(255, 233, 204, 0.08); }
#audioBench .item.sel { background: rgba(255, 190, 110, 0.2); }
#audioBench .item .n { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#audioBench .item .m, #audioBench .dim { opacity: .55; font-size: 11px; }
#audioBench .item button { padding: 0 6px; }
#audioBench .detail { border-top: 1px solid rgba(255, 240, 220, 0.12); padding-top: 5px; overflow-y: auto; flex: none; max-height: 36vh; }
#audioBench .detail b { letter-spacing: .03em; }
#audioBench .f { display: grid; grid-template-columns: 52px 1fr 58px; gap: 6px; align-items: center; margin-top: 3px; }
#audioBench .f input[type=range] { width: 100%; }
#audioBench .f .v { text-align: right; }
#audioBench .f.ed .v { color: #ffbe6e; }
#audioBench a { color: #ffbe6e; cursor: pointer; text-decoration: underline dotted; }
#audioBench canvas { border-radius: 50%; cursor: crosshair; touch-action: none; flex: none; }
#audioBench .where { display: flex; gap: 8px; border-top: 1px solid rgba(255, 240, 220, 0.12); padding-top: 6px; }
#audioBench .where .side { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
#audioBench .where .side .row button { padding: 2px 5px; font-size: 11px; }
#audioBench .foot { border-top: 1px solid rgba(255, 240, 220, 0.12); padding-top: 6px; }
#audioBench #abMsg { color: #ffbe6e; }`;
    document.head.append(style);
    const p = this.panel;
    p.id = 'audioBench';
    p.innerHTML = `<h4>Audio workbench<span class="sp"></span><button id="abStop" title="Stop everything the bench started">Stop</button><button id="abClose" title="Close">×</button></h4>
<div class="row"><button data-tab="events">Events</button><button data-tab="samples">Samples</button>
<input id="abFilter" placeholder="search" style="flex:1;min-width:0"></div>
<div class="list" id="abList"></div>
<div class="detail" id="abDetail"></div>
<div class="where"><canvas id="abPad" width="150" height="150" style="width:150px;height:150px"></canvas>
<div class="side"><div id="abWhere"></div>
<label class="row">Height <input id="abHeight" type="range" min="-30" max="60" step="1" style="flex:1;min-width:0"> <span id="abHeightV"></span></label>
<div class="row"><button id="abHead" title="Play it as your own: in your head, no spot">In your head</button>${PRESETS.map(([n], i) => `<button data-preset="${i}">${n}</button>`).join('')}</div>
<label class="row">Route <select id="abRoute"><option value="">as configured</option><option>direct</option><option>placed</option><option>panned</option><option>music</option></select></label>
<div class="row"><button id="abPlay" class="go">▶ Play</button><label><input id="abRepeat" type="checkbox"> Repeat every</label>
<input id="abEvery" type="number" min="0.1" max="30" step="0.1" value="2" style="width:46px"> s</div></div></div>
<div class="foot row"><span id="abEdits"></span><span class="sp" style="flex:1"></span><button id="abCopy" title="The edits as a list, for src/audioConfig.ts">Copy edits</button><button id="abReset" title="Back to src/audioConfig.ts as written">Reset</button></div>
<div id="abMsg"></div>`;
    for (const b of p.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.addEventListener('click', () => { this.tab = b.dataset.tab as 'events' | 'samples'; this.list(); });
    const filter = this.q<HTMLInputElement>('#abFilter');
    filter.addEventListener('input', () => { this.filter = filter.value.trim().toLowerCase(); this.list(); });
    // Typing and scrolling here aren't the game's keys and wheel.
    p.addEventListener('keydown', (e) => e.stopPropagation());
    p.addEventListener('keyup', (e) => e.stopPropagation());
    p.addEventListener('wheel', (e) => e.stopPropagation());
    this.q('#abClose').addEventListener('click', () => this.toggle(false));
    this.q('#abStop').addEventListener('click', () => this.stopAll());
    this.q('#abPlay').addEventListener('click', () => this.playSelected());
    this.q('#abRepeat').addEventListener('change', () => this.rearm());
    this.q('#abEvery').addEventListener('change', () => this.rearm());
    this.q('#abCopy').addEventListener('click', () => navigator.clipboard.writeText(this.diff()).then(() => this.flash('Edits copied'), () => this.flash('Clipboard refused')));
    this.q('#abReset').addEventListener('click', () => this.reset());
    this.q<HTMLSelectElement>('#abRoute').addEventListener('change', (e) => { this.route = (e.target as HTMLSelectElement).value as Route | ''; });
    const height = this.q<HTMLInputElement>('#abHeight');
    height.value = String(this.height);
    height.addEventListener('input', () => { this.height = Number(height.value); this.pad(); });
    this.q('#abHead').addEventListener('click', () => { this.head = !this.head; this.pad(); });
    for (const b of p.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.addEventListener('click', () => {
      const [, bearing, dist] = PRESETS[Number(b.dataset.preset)];
      Object.assign(this, { bearing, dist, head: false });
      this.pad();
    });
    const pad = this.q<HTMLCanvasElement>('#abPad');
    const at = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
      const k = Math.min(1, Math.hypot(x, y));
      this.dist = Math.max(0.5, Math.round(Math.expm1(k * Math.log1p(PAD_MAX)) * 10) / 10);
      this.bearing = Math.round((Math.atan2(x, -y) * 180) / Math.PI);
      this.head = false;
      this.pad();
    };
    pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); at(e); });
    pad.addEventListener('pointermove', (e) => pad.hasPointerCapture(e.pointerId) && at(e));
    document.body.append(p);
    this.footer();
  }

  private playSelected() {
    if (!this.sel) return this.flash('Pick an event or a sample');
    if (this.sel.kind === 'event') this.playEvent(this.sel.id);
    else this.playSampleId(this.sel.id);
  }

  private list() {
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const box = this.q<HTMLElement>('#abList'), f = this.filter, html: string[] = [];
    const sel = (kind: string, id: string) => (this.sel?.kind === kind && this.sel.id === id ? ' sel' : '');
    if (this.tab === 'events') {
      for (const id of Object.keys(EVENTS) as EventId[]) {
        const e = event(id), names = e.samples.map(sampleId).join(' ');
        if (f && !`${id} ${names} ${e.by}`.toLowerCase().includes(f)) continue;
        html.push(`<div class="item${sel('event', id)}" data-event="${id}"><button data-play title="Play">▶</button><span class="n">${esc(id)}</span><span class="m">${e.route} · ${fmt(e.gain)}</span></div>`);
      }
    } else {
      const used = this.usedBy();
      for (const id of Object.keys(SAMPLES) as SampleId[]) {
        const s = sample(id);
        if (f && !`${id} ${s.from}`.toLowerCase().includes(f)) continue;
        const n = used.get(id)?.length ?? 0;
        html.push(`<div class="item${sel('sample', id)}" data-sample="${id}"><button data-play title="Play">▶</button><span class="n">${esc(id)}</span><span class="m">${fmt(s.lufs + s.trim, 1)} LUFS · ${n ? `${n} event${n > 1 ? 's' : ''}` : 'unused'}</span></div>`);
      }
    }
    box.innerHTML = html.join('') || '<div class="dim">Nothing matches.</div>';
    for (const el of box.querySelectorAll<HTMLElement>('.item')) {
      const pick = () => {
        this.sel = el.dataset.event ? { kind: 'event', id: el.dataset.event as EventId } : { kind: 'sample', id: el.dataset.sample as SampleId };
        for (const o of box.querySelectorAll('.item')) o.classList.toggle('sel', o === el);
        this.detail();
      };
      el.addEventListener('click', pick);
      el.querySelector('[data-play]')!.addEventListener('click', (e) => { e.stopPropagation(); pick(); this.playSelected(); });
    }
  }

  private usedBy() {
    const m = new Map<SampleId, EventId[]>();
    for (const id of Object.keys(EVENTS) as EventId[]) for (const r of event(id).samples) {
      const s = sampleId(r), l = m.get(s) ?? [];
      if (!l.includes(id)) l.push(id);
      m.set(s, l);
    }
    return m;
  }

  /** A slider row: label, range, value; `edited` marks a change from the config as written. */
  private slider(key: string, label: string, min: number, max: number, step: number, v: number, show: string, edited: boolean) {
    return `<label class="f${edited ? ' ed' : ''}"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="v">${show}</span></label>`;
  }

  private detail() {
    const box = this.q<HTMLElement>('#abDetail'), s = this.sel;
    if (!s) { box.innerHTML = '<div class="dim">Pick an event or a sample.</div>'; return; }
    if (s.kind === 'sample') {
      const d = sample(s.id), o = this.original.samples[s.id], buf = sampleBuffer(s.id), used = this.usedBy().get(s.id) ?? [];
      box.innerHTML = `<b>${esc(s.id)}</b> <span class="dim">${esc(d.file)}</span>
<div class="dim">${esc(d.from)}</div>
<div>${fmt(d.lufs, 1)} LUFS as the file${d.trim ? `, ${fmt(d.lufs + d.trim, 1)} trimmed` : ''}${buf ? ` · ${fmt(buf.duration)} s` : ''}${d.slices ? ` · ${d.slices.count} slices of ${d.slices.len} s` : ''}${d.loop ? ` · loops ${fmt(d.loop[0])}–${fmt(d.loop[1])} s` : ''}</div>
${this.slider('trim', 'Trim', -24, 24, 0.1, d.trim, `${d.trim > 0 ? '+' : ''}${fmt(d.trim, 1)} dB`, d.trim !== o.trim)}
<div class="row" style="margin-top:4px"><button id="abLevel" title="Trim it to −23 LUFS (docs/audio.md)">→ −23 LUFS</button><button id="abTrim0">Trim 0</button></div>
<div style="margin-top:4px">Played by: ${used.map((e) => `<a data-goto-event="${e}">${esc(e)}</a>`).join(', ') || '<span class="dim">no event yet</span>'}</div>`;
      const trim = box.querySelector<HTMLInputElement>('[data-k=trim]')!;
      trim.addEventListener('input', () => {
        this.setTrim(s.id, Number(trim.value));
        this.shown(trim, `${d.trim > 0 ? '+' : ''}${fmt(d.trim, 1)} dB`, d.trim !== o.trim);
      });
      trim.addEventListener('change', () => { this.detail(); this.list(); });
      box.querySelector('#abLevel')!.addEventListener('click', () => { this.setTrim(s.id, -23 - d.lufs); this.detail(); this.list(); });
      box.querySelector('#abTrim0')!.addEventListener('click', () => { this.setTrim(s.id, 0); this.detail(); this.list(); });
      if (!buf) void loadSample(s.id).then(() => this.sel === s && this.detail());
    } else {
      const e = event(s.id), o = this.original.events[s.id];
      const placed = e.route === 'placed' || e.route === 'panned';
      // Each sample's level at its source: its loudness, trim and the event's gain (before distance and the mix).
      const levels = () => e.samples.map((r) => {
        const id = sampleId(r), d = sample(id);
        return `<a data-goto-sample="${id}">${esc(id)}${typeof r === 'string' ? '' : `#${r.slice}`}</a> <span class="dim">≈${fmt(d.lufs + d.trim + db(e.gain), 1)}</span>`;
      }).join(', ') + ' <span class="dim">LUFS at the source</span>';
      const show: Record<EventField, () => string> = {
        gain: () => `${fmt(e.gain)} (${fmt(db(e.gain), 1)} dB)`, pitch: () => fmt(e.pitch ?? 1), vary: () => fmt(e.vary ?? 0),
        jitter: () => fmt(e.jitter ?? 0), ref: () => fmt(e.ref, 1), hear: () => fmt(e.hear, 0),
      };
      const ed = (f: EventField) => e[f] !== o[f];
      box.innerHTML = `<b>${esc(s.id)}</b> <span class="dim">${e.route} · ${esc(e.by)}</span>
<div id="abLevels" style="margin-top:2px">${levels()}</div>
${this.slider('gain', 'Gain', 0, 4, 0.01, e.gain, show.gain(), ed('gain'))}
${this.slider('pitch', 'Pitch', 0.25, 2, 0.01, e.pitch ?? 1, show.pitch(), ed('pitch'))}
${this.slider('vary', 'Vary ±', 0, 0.3, 0.01, e.vary ?? 0, show.vary(), ed('vary'))}
${this.slider('jitter', 'Level ±', 0, 0.5, 0.01, e.jitter ?? 0, show.jitter(), ed('jitter'))}
${placed ? this.slider('ref', 'Ref m', 0.5, 100, 0.5, e.ref ?? 15, show.ref(), ed('ref')) + this.slider('hear', 'Hear m', 5, 1000, 5, e.hear ?? 600, show.hear(), ed('hear')) : ''}`;
      for (const input of box.querySelectorAll<HTMLInputElement>('[data-k]')) input.addEventListener('input', () => {
        const f = input.dataset.k as EventField;
        this.setField(s.id, f, Number(input.value));
        this.shown(input, show[f](), ed(f));
        if (f === 'gain') box.querySelector('#abLevels')!.innerHTML = levels();
      });
      box.querySelector('#abLevels')!.addEventListener('click', (ev) => {
        const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-goto-sample]')?.dataset.gotoSample;
        if (id) this.goto({ kind: 'sample', id: id as SampleId });
      });
    }
    for (const a of box.querySelectorAll<HTMLElement>('[data-goto-event]')) a.addEventListener('click', () => this.goto({ kind: 'event', id: a.dataset.gotoEvent as EventId }));
  }

  /** A slider's value and whether it differs from the config as written, updated in place (not redrawn: it's being dragged). */
  private shown(input: HTMLInputElement, text: string, edited: boolean) {
    const row = input.parentElement!;
    row.classList.toggle('ed', edited);
    row.querySelector('.v')!.textContent = text;
  }

  /** Open an event or a sample from a link. */
  private goto(sel: NonNullable<AudioBench['sel']>) {
    this.sel = sel;
    this.tab = sel.kind === 'event' ? 'events' : 'samples';
    this.filter = '';
    this.q<HTMLInputElement>('#abFilter').value = '';
    this.list();
    this.detail();
    this.q<HTMLElement>('#abList').querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  private footer() {
    const n = Object.keys(this.edits.samples).length + Object.values(this.edits.events).reduce((a, f) => a + Object.keys(f ?? {}).length, 0);
    this.q<HTMLElement>('#abEdits').textContent = n ? `${n} edit${n > 1 ? 's' : ''}, not in the config yet` : 'No edits';
  }

  /** The pad: you at the centre facing up, the spot, the rings. */
  private pad() {
    const c = this.q<HTMLCanvasElement>('#abPad'), g = c.getContext('2d')!, R = c.width / 2;
    const r = (d: number) => (Math.log1p(d) / Math.log1p(PAD_MAX)) * (R - 2);
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255, 233, 204, 0.06)';
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 233, 204, 0.18)';
    g.fillStyle = 'rgba(255, 233, 204, 0.45)';
    g.font = '9px monospace';
    for (const d of RINGS) {
      g.beginPath(); g.arc(R, R, r(d), 0, Math.PI * 2); g.stroke();
      g.fillText(`${d}`, R + 2, R - r(d) + 9);
    }
    // You, facing up.
    g.fillStyle = '#ffe9cc';
    g.beginPath(); g.moveTo(R, R - 6); g.lineTo(R - 4, R + 4); g.lineTo(R + 4, R + 4); g.closePath(); g.fill();
    const where = this.q<HTMLElement>('#abWhere');
    this.q<HTMLButtonElement>('#abHead').classList.toggle('on', this.head);
    this.q<HTMLElement>('#abHeightV').textContent = `${this.height > 0 ? '+' : ''}${this.height} m`;
    if (this.head) { where.textContent = 'In your head'; return; }
    const b = (this.bearing * Math.PI) / 180, x = R + Math.sin(b) * r(this.dist), y = R - Math.cos(b) * r(this.dist);
    g.fillStyle = '#ffbe6e';
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    const side = Math.abs(this.bearing) < 3 ? 'ahead' : Math.abs(this.bearing) > 177 ? 'behind' : `${Math.abs(this.bearing)}° ${this.bearing > 0 ? 'right' : 'left'}`;
    where.textContent = `${fmt(this.dist, 1)} m, ${side}`;
  }
}
