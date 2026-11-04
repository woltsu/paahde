// The audio config (src/audioConfig.ts) against the files in public/audio/, the synths the code defines and the code
// that plays them, and the player (src/sounds.ts) it drives.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as config from '../src/audioConfig.ts';

const { EVENTS, SAMPLES, SYNTHS, soundId } = config;
const dir = new URL('../public/audio/', import.meta.url);
const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
const ffmpeg = !spawnSync('ffmpeg', ['-version']).error;
const srcDir = new URL('../src/', import.meta.url);
const sources = readdirSync(srcDir, { recursive: true }).filter((f) => /\.ts$/.test(f)).map((f) => ({ f, text: readFileSync(new URL(f, srcDir), 'utf8') }));

test('every file in public/audio is a sample, and every sample a file', () => {
  const listed = Object.values(SAMPLES).map((s) => s.file);
  assert.deepEqual([...files].sort(), [...listed].sort());
  for (const [id, s] of Object.entries(SAMPLES)) assert.equal(s.file.replace(/\.\w+$/, ''), id, `${id}: named after its file`);
});

test('every synth is defined by the module it names, and every defined synth is listed', () => {
  for (const id of Object.keys(SYNTHS)) assert.ok(!(id in SAMPLES), `${id}: a sample and a synth`);
  const defined = new Map();
  for (const { f, text } of sources) for (const m of text.matchAll(/defineSynth\('([\w-]+)'/g)) {
    assert.ok(!defined.has(m[1]), `${m[1]}: defined twice`);
    defined.set(m[1], `src/${f}`);
  }
  for (const [id, s] of Object.entries(SYNTHS)) assert.equal(defined.get(id), s.by, `${id}: defined in ${s.by}`);
  for (const id of defined.keys()) assert.ok(id in SYNTHS, `${id}: defined but not in SYNTHS`);
});

test('events play sounds that exist, slices within their sprite', () => {
  for (const [id, e] of Object.entries(EVENTS)) {
    assert.ok(e.sounds.length > 0, id);
    assert.ok(e.gain > 0 && Number.isFinite(e.gain), `${id}: gain`);
    if (e.route === 'placed' || e.route === 'panned') assert.ok(e.ref > 0 && e.hear > e.ref, `${id}: ref and hear`);
    if (e.route === 'spatial') assert.ok(e.ref > 0, `${id}: ref`);
    for (const r of e.sounds) {
      const s = SAMPLES[soundId(r)] ?? SYNTHS[soundId(r)];
      assert.ok(s, `${id}: ${JSON.stringify(r)} is a sound`);
      if (typeof r !== 'string') assert.ok(s.slices && r.slice >= 0 && r.slice < s.slices.count, `${id}: slice ${r.slice}`);
      assert.equal(e.route === 'music', !!s.loop, `${id}: music plays songs (with a loop region), and only music`);
    }
  }
});

test('the code plays samples through the config, never by file name', () => {
  const offenders = sources.filter(({ f, text }) => f !== 'audioConfig.ts' && /['"`]\.\/audio\/[\w-]+\.(mp3|ogg|wav)/.test(text)).map(({ f }) => f);
  assert.deepEqual(offenders, []);
});

test('measured loudness and lengths match the files', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  for (const [id, s] of Object.entries(SAMPLES)) {
    const path = new URL(s.file, dir).pathname;
    const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const lufs = Number(meter.slice(meter.lastIndexOf('Summary:')).match(/\bI:\s+(-?[\d.]+) LUFS/)[1]);
    assert.ok(Math.abs(lufs - s.lufs) <= 0.3, `${id}: lufs ${s.lufs}, measures ${lufs}`);
    const length = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' }).stdout);
    if (s.slices) assert.ok(s.slices.count * s.slices.len <= length + 0.01, `${id}: slices fit (${length} s)`);
    if (s.loop) assert.ok(s.loop[0] < s.loop[1] && s.loop[1] <= length + 0.01, `${id}: loop fits (${length} s)`);
  }
});

// src/sounds.ts with stand-ins for the audio graph (and the real config).
const player_ = stripTypeScriptTypes(readFileSync(new URL('../src/sounds.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''));
function player() {
  const made = [], reservations = [], node = () => ({ gain: { value: 0 }, pan: { value: 0 }, connect(to) { return to; }, disconnect() {} });
  const audio = { running: true, onStart() {}, out: node(), music: node(), warning: node(), protectWarning() {}, ctx: {
    currentTime: 0, listener: { forwardX: { value: 0 }, forwardZ: { value: -1 } },
    createGain: node, createStereoPanner: node,
    createBufferSource() { const src = { ...node(), playbackRate: { value: 1 }, start(...a) { src.started = a; } }; made.push(src); return src; },
  } };
  const placed = (...args) => { reservations.push(args.at(-1)); return { input: node(), t: 0 }; };
  const m = new Function('audio', 'placed', 'config', 'fetch',
    `const { ${Object.keys(config).join(', ')} } = config;\n${player_}\nreturn { play, playSound, playSample, defineSynth, bufs };`)(audio, placed, config, () => new Promise(() => {}));
  for (const id of Object.keys(SAMPLES)) m.bufs.set(id, { duration: id.startsWith('laser') ? 0.55 : id.startsWith('firework') ? 2.2 : 2.4 });
  return { ...m, made, reservations };
}

test('placed voices reserve their played duration at every pitch, not eight seconds', () => {
  const p = player();
  p.play('rifle.shot'); p.play('pistol.shot'); p.play('cannon.shot', {}, {}); p.play('colossus.missile', {}, {});
  assert.equal(p.reservations.length, 4);
  for (let i = 0; i < 4; i++) assert.equal(p.reservations[i].duration, p.made[i].buffer.duration / p.made[i].playbackRate.value + 0.1);
  assert.ok(p.reservations[0].duration < 0.7 && p.reservations[1].duration < p.reservations[0].duration);
  assert.ok(p.reservations[2].duration > 1 && p.reservations[2].duration < 1.3);
});

test('a slice plays its own stretch of the sprite; trims scale the level', () => {
  const p = player(), was = SAMPLES['teardown-clang'].trim;
  SAMPLES['teardown-clang'].trim = -6;
  try {
    const v = p.playSample({ id: 'teardown-clang', slice: 3 }, { route: 'direct', level: 1 });
    assert.deepEqual(v.src.started, [0, 3 * 0.6, 0.6]);
    assert.ok(Math.abs(v.gain.gain.value - 10 ** (-6 / 20)) < 1e-9);
  } finally { SAMPLES['teardown-clang'].trim = was; }
});

test('a random pick never plays the same sample twice running', () => {
  const p = player();
  let last = null;
  for (let i = 0; i < 50; i++) {
    const b = p.play('weakPoint.break', {}, {}).src.buffer;
    assert.notEqual(b, last);
    last = b;
  }
});

test('a synth plays like a sample: its event\'s level, trim, argument, length and bus', () => {
  const p = player(), calls = [], was = SYNTHS['crawler-rattle'].trim;
  p.defineSynth('crawler-rattle', { length: (o) => o.arg + 0.1, voice: (ctx, out, t, o) => calls.push({ out, t, o }) });
  SYNTHS['crawler-rattle'].trim = 6;
  try {
    const v = p.play('crawler.rattle', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { arg: 0.8 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].o.arg, 0.8);
    assert.equal(calls[0].out, v.gain, 'made into its voice, so stop() fades it');
    const r = p.reservations[0];
    assert.equal(r.duration, 0.9);
    assert.equal(r.warning, true, 'on the warning bus, as its event says');
    assert.equal(v.src, undefined);
    assert.equal(v.end, v.t + 0.9);
    // Without an argument from the code, the event's own.
    p.play('crawler.rattle', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(calls[1].o.arg, EVENTS['crawler.rattle'].arg);
  } finally { SYNTHS['crawler-rattle'].trim = was; }
  // A synth nobody defined plays nothing (and doesn't throw).
  assert.equal(p.play('drone.lockOn'), null);
});
