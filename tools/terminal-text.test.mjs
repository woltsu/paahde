// A terminal's screen text (src/world/terminalText.ts, docs/terminals.md): teletype writes wrap and scroll, screen
// prints clip and keep the cursor, the version moves with every change, and the helpers programs use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalText, asProgram, bar, fit, typewriter, wrap } from '../src/world/terminalText.ts';

const rows = (t) => t.lines().map((l) => l.trimEnd());

test('write wraps at the edge and scrolls off the bottom', () => {
  const t = new TerminalText(4, 2);
  t.write('abcdef');
  assert.deepEqual(rows(t), ['abcd', 'ef']);
  assert.deepEqual([t.cursor.col, t.cursor.row], [2, 1]);
  t.write('ghij');
  assert.deepEqual(rows(t), ['efgh', 'ij'], 'scrolled up one row');
});

test('the wrap waits for the next character, as on a real terminal', () => {
  const t = new TerminalText(3, 2);
  t.write('abc');
  assert.deepEqual([t.cursor.col, t.cursor.row], [3, 0], 'the cursor sits past the last column');
  t.write('\n');
  assert.deepEqual([t.cursor.col, t.cursor.row], [0, 1], 'a newline after a full line is one line, not two');
  t.write('x');
  assert.deepEqual(rows(t), ['abc', 'x']);
});

test('newline, carriage return and writeLine', () => {
  const t = new TerminalText(6, 3);
  t.writeLine('hello');
  t.write('xx\rab');
  assert.deepEqual(rows(t), ['hello', 'ab', '']);
});

test('print clips, keeps the cursor, and never scrolls', () => {
  const t = new TerminalText(5, 2);
  t.write('q');
  t.print(3, 0, 'xyz');
  t.print(-1, 1, 'abc');
  t.print(0, 5, 'far');
  assert.deepEqual(rows(t), ['q  xy', 'bc']);
  assert.deepEqual([t.cursor.col, t.cursor.row], [1, 0]);
  t.print(1, 0, 'a\nb');
  assert.deepEqual(rows(t), ['qa xy', 'bb'], "'\\n' carries on at the same column on the next row (over the c)");
});

test('setLines replaces the frame, setLine a row, clear empties it', () => {
  const t = new TerminalText(4, 3);
  t.write('zzzzzzzz');
  t.setLines(['one', 'twotwo']);
  assert.deepEqual(rows(t), ['one', 'twot', '']);
  t.setLine(2, 'x');
  t.setLine(9, 'ignored');
  assert.deepEqual(rows(t), ['one', 'twot', 'x']);
  t.clear();
  assert.deepEqual(rows(t), ['', '', '']);
  assert.deepEqual([t.cursor.col, t.cursor.row], [0, 0]);
});

test('control characters are drawn as spaces; anything printable is kept', () => {
  const t = new TerminalText(6, 1);
  t.write('a\tb\x07c█');
  assert.equal(t.line(0), 'a b c█');
});

test('every change moves the version', () => {
  const t = new TerminalText(3, 3);
  let v = t.version;
  for (const f of [() => t.write('a'), () => t.print(0, 1, 'b'), () => t.setLine(2, 'c'), () => t.setLines([]),
    () => t.moveTo(1, 1), () => t.showCursor(false), () => t.scroll(), () => t.clear()]) {
    f();
    assert.ok(t.version > v);
    v = t.version;
  }
});

test('moveTo clamps to the grid', () => {
  const t = new TerminalText(4, 2);
  t.moveTo(9, -3);
  assert.deepEqual([t.cursor.col, t.cursor.row], [3, 0]);
});

test('helpers: fit, bar, wrap', () => {
  assert.equal(fit('ab', 5), 'ab   ');
  assert.equal(fit('ab', 5, 'right'), '   ab');
  assert.equal(fit('ab', 6, 'center', '-'), '--ab--');
  assert.equal(fit('abcdef', 3), 'abc');
  assert.equal(bar(0.5, 12), '[#####.....]');
  assert.equal(bar(2, 6), '[####]');
  assert.deepEqual(wrap('the quick brown fox', 9), ['the quick', 'brown fox']);
  assert.deepEqual(wrap('abcdefghij x', 4), ['abcd', 'efgh', 'ij x']);
});

test('programs: a function is a program; typewriter types at its rate, then stops', () => {
  const t = new TerminalText(10, 2);
  asProgram((text) => text.setLine(0, 'fn')).update(t, 0.1);
  assert.equal(t.line(0).trimEnd(), 'fn');
  t.clear();
  const p = typewriter('hello', 10);
  p.update(t, 0.25);
  assert.equal(t.line(0).trimEnd(), 'he');
  p.update(t, 10);
  assert.equal(t.line(0).trimEnd(), 'hello');
  const v = t.version;
  p.update(t, 1);
  assert.equal(t.version, v, 'nothing more once done');
});
