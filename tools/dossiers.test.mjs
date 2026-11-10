// The ring hall's terminal programs (src/world/dossiers.ts, docs/terminals.md): the headshots are deterministic and look
// like faces (a dark eye row in a lit head), and every program runs a long while on a console-sized grid, writing its
// words from TEXT and keeping its pictures on the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalText } from '../src/world/terminalText.ts';
import { DOSSIER_PROGRAMS, FACE_H, FACE_W, bases, face, subject } from '../src/world/dossiers.ts';
import { TEXT } from '../shared/text.ts';

test('faces are deterministic, in range, and differ by seed and variant', () => {
  for (const v of ['human', 'dwarf', 'gnome']) {
    const a = face(5, v), b = face(5, v);
    assert.equal(a.px.length, FACE_W * FACE_H);
    assert.deepEqual(a.px, b.px);
    assert.ok(a.px.every((p) => p >= 0 && p <= 1));
  }
  assert.notDeepEqual(face(5, 'human').px, face(6, 'human').px);
  assert.notDeepEqual(face(5, 'human').px, face(5, 'dwarf').px);
});

test('a face has a lit middle and some dark (eyes, hair, clothes)', () => {
  for (let s = 0; s < 40; s++) {
    const f = face(s, ['human', 'dwarf', 'gnome'][s % 3]);
    assert.ok(Math.min(...f.px) < 0.2, `seed ${s}: nothing dark`);
    assert.ok(Math.max(...f.px) > 0.5, `seed ${s}: nothing lit`);
  }
});

test('subjects and bases are stable', () => {
  assert.deepEqual({ ...subject(42), face: null }, { ...subject(42), face: null });
  assert.match(bases(1, 0, 50), /^[ACGT]{50}$/);
  assert.equal(bases(1, 10, 5), bases(1, 0, 15).slice(10));
});

test('every program runs on a console screen, with words from TEXT and its faces shown', () => {
  const D = TEXT.tutorial.dossier;
  DOSSIER_PROGRAMS.forEach((make, i) => {
    const text = new TerminalText(80, 24, 2.5);
    const p = make(11 + i);
    p.start?.(text);
    let seen = '';
    for (let f = 0; f < 60 * 40; f++) {
      p.update(text, 1 / 60);
      if (f % 30 === 0) seen += text.lines().join('\n');
    }
    assert.ok(seen.includes(D.header), `program ${i}: no header`);
    assert.ok(text.images().length > 0, `program ${i}: no faces`);
    for (const im of text.images()) assert.ok(im.col >= 0 && im.col + im.w <= 80 && im.row + im.h <= 24, `program ${i}: picture off the screen`);
  });
});
