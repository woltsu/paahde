// The audio config (src/audioConfig.ts) against the files in public/audio/ and the code, and the sample player
// (src/samples.ts) it drives.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { EVENTS, SAMPLES, sampleId } from '../src/audioConfig.ts';

const dir = new URL('../public/audio/', import.meta.url);
const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
const ffmpeg = !spawnSync('ffmpeg', ['-version']).error;

test('every file in public/audio is a sample, and every sample a file', () => {
  const listed = Object.values(SAMPLES).map((s) => s.file);
  assert.deepEqual([...files].sort(), [...listed].sort());
  for (const [id, s] of Object.entries(SAMPLES)) assert.equal(s.file.replace(/\.\w+$/, ''), id, `${id}: named after its file`);
});

test('events play samples that exist, slices within their sprite', () => {
  for (const [id, e] of Object.entries(EVENTS)) {
    assert.ok(e.samples.length > 0, id);
    assert.ok(e.gain > 0 && Number.isFinite(e.gain), `${id}: gain`);
    if (e.route === 'placed' || e.route === 'panned') assert.ok(e.ref > 0 && e.hear > e.ref, `${id}: ref and hear`);
    for (const r of e.samples) {
      const s = SAMPLES[sampleId(r)];
      assert.ok(s, `${id}: ${JSON.stringify(r)} is a sample`);
      if (typeof r !== 'string') assert.ok(s.slices && r.slice >= 0 && r.slice < s.slices.count, `${id}: slice ${r.slice}`);
      assert.equal(e.route === 'music', !!s.loop, `${id}: music plays songs (with a loop region), and only music`);
    }
  }
});

test('the code plays samples through the config, never by file name', () => {
  const src = new URL('../src/', import.meta.url);
  const offenders = readdirSync(src, { recursive: true })
    .filter((f) => /\.ts$/.test(f) && f !== 'audioConfig.ts')
    .filter((f) => /['"`]\.\/audio\/[\w-]+\.(mp3|ogg|wav)/.test(readFileSync(new URL(f, src), 'utf8')));
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

// src/samples.ts with stand-ins for the audio graph.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/samples.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''));
function player(config = { EVENTS, SAMPLES }) {
  const sources = [], reservations = [], node = () => ({ gain: { value: 0 }, pan: { value: 0 }, connect(to) { return to; }, disconnect() {} });
  const bufs = new Map();
  const audio = { running: true, onStart() {}, out: node(), music: node(), ctx: {
    currentTime: 0, listener: { forwardX: { value: 0 }, forwardZ: { value: -1 } },
    createGain: node, createStereoPanner: node,
    createBufferSource() { const src = { ...node(), playbackRate: { value: 1 }, start(...a) { src.started = a; } }; sources.push(src); return src; },
  } };
  const placed = (...args) => { reservations.push(args.at(-1).duration); return { input: node(), t: 0 }; };
  const sample = (id) => config.SAMPLES[id], event = (id) => config.EVENTS[id];
  const sampleId = (r) => (typeof r === 'string' ? r : r.id), trimGain = (id) => 10 ** (sample(id).trim / 20);
  const m = new Function('audio', 'placed', 'EVENTS', 'event', 'sample', 'sampleId', 'sampleUrl', 'trimGain', 'fetch',
    `${source}\nreturn { play, playSample, bufs };`)(audio, placed, config.EVENTS, event, sample, sampleId, () => '', trimGain, () => new Promise(() => {}));
  for (const id of Object.keys(config.SAMPLES)) m.bufs.set(id, { duration: id.startsWith('laser') ? 0.55 : id.startsWith('firework') ? 2.2 : 2.4 });
  return { ...m, sources, reservations, bufs };
}

test('placed voices reserve their played duration at every pitch, not eight seconds', () => {
  const p = player();
  p.play('rifle.shot'); p.play('pistol.shot'); p.play('cannon.shot', {}, {}); p.play('colossus.missile', {}, {});
  assert.equal(p.reservations.length, 4);
  for (let i = 0; i < 4; i++) assert.equal(p.reservations[i], p.sources[i].buffer.duration / p.sources[i].playbackRate.value + 0.1);
  assert.ok(p.reservations[0] < 0.7 && p.reservations[1] < p.reservations[0]);
  assert.ok(p.reservations[2] > 1 && p.reservations[2] < 1.3);
});

test('a slice plays its own stretch of the sprite; trims scale the level', () => {
  const samples = structuredClone(SAMPLES);
  samples['teardown-clang'].trim = -6;
  const p = player({ EVENTS, SAMPLES: samples });
  const v = p.playSample({ id: 'teardown-clang', slice: 3 }, { route: 'direct', level: 1 });
  assert.deepEqual(v.src.started, [0, 3 * 0.6, 0.6]);
  assert.ok(Math.abs(v.gain.gain.value - 10 ** (-6 / 20)) < 1e-9);
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
