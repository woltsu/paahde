// World-state snapshots (server/snapshot.ts): a dump and a restore give the same rows back, the browser IDs in a dump are
// placeholders (they are secrets, and snapshots are checked in) and so are players' names, and the checked-in ones hold
// none but placeholders.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { dumpDb, PROTAGONIST, PROTAGONIST_NAME, restoreDb, SNAPSHOT_DIR, setPending, takePending } from '../server/snapshot.ts';

const SAVER = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const OTHER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const LOADER = '0f0e0d0c-0b0a-4908-8706-050403020100';

function world() {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'snap-')), 'w.db'));
  db.exec(`CREATE TABLE players (id TEXT PRIMARY KEY, x REAL NOT NULL, name TEXT);
    CREATE TABLE obituaries (id INTEGER PRIMARY KEY, player INTEGER NOT NULL, name TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, data TEXT);
    CREATE TABLE chunks (cx INTEGER, cz INTEGER, data BLOB);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value REAL)`);
  db.prepare('INSERT INTO players VALUES (?, ?, ?)').run(SAVER, 1.5, 'Veikko');
  db.prepare('INSERT INTO players VALUES (?, ?, ?)').run(OTHER, -2, 'Ottilia');
  db.prepare('INSERT INTO obituaries VALUES (?, ?, ?)').run(1, 7, 'Ottilia');
  db.prepare('INSERT INTO obituaries VALUES (?, ?, ?)').run(2, 8, 'Stranger'); // (gone from players since)
  db.prepare('INSERT INTO obituaries VALUES (?, ?, ?)').run(3, 9, 'Veikko');
  db.prepare('INSERT INTO items VALUES (?, ?, ?, ?)').run(1, SAVER, 'piercer', JSON.stringify({ by: SAVER }));
  db.prepare('INSERT INTO items VALUES (?, ?, ?, ?)').run(2, OTHER, 'scrap', null);
  db.prepare('INSERT INTO chunks VALUES (?, ?, ?)').run(3, -4, new Uint8Array([1, 2, 250]));
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('lives', 10);
  return db;
}

test('a dump keeps every row, with placeholders for browser IDs', () => {
  const tables = dumpDb(world(), SAVER);
  const text = JSON.stringify(tables);
  assert.ok(!text.includes(SAVER) && !text.includes(OTHER), 'a browser ID left in the dump');
  assert.deepEqual(tables.players.rows.map((r) => r[0]).sort(), [PROTAGONIST, '00000000-0000-4000-8000-000000000002']);
  assert.equal(JSON.parse(tables.items.rows[0][3]).by, PROTAGONIST);
  assert.deepEqual(tables.chunks.rows[0], [3, -4, { b64: Buffer.from([1, 2, 250]).toString('base64') }]);
});

test('a dump names nobody: players by their placeholders, the same name the same everywhere', () => {
  const tables = dumpDb(world(), SAVER);
  const text = JSON.stringify(tables);
  for (const n of ['Veikko', 'Ottilia', 'Stranger']) assert.ok(!text.includes(n), `${n} left in the dump`);
  const named = Object.fromEntries(tables.players.rows.map((r) => [r[0], r[2]]));
  assert.deepEqual(named, { [PROTAGONIST]: PROTAGONIST_NAME, '00000000-0000-4000-8000-000000000002': 'Player 2' });
  assert.deepEqual(tables.obituaries.rows.map((r) => r[2]), ['Player 2', 'Player 3', PROTAGONIST_NAME]);
});

test('a restore replaces every row, the protagonist the loader', () => {
  const tables = dumpDb(world(), SAVER);
  const db = world();
  db.prepare('INSERT INTO items VALUES (?, ?, ?, ?)').run(9, LOADER, 'junk', null); // (what was there goes)
  db.exec('ALTER TABLE items ADD COLUMN added INTEGER DEFAULT 7'); // (a column since: its default)
  restoreDb(db, tables, LOADER);
  assert.deepEqual(db.prepare('SELECT id, owner, kind, added FROM items ORDER BY id').all().map((r) => ({ ...r })),
    [{ id: 1, owner: LOADER, kind: 'piercer', added: 7 }, { id: 2, owner: '00000000-0000-4000-8000-000000000002', kind: 'scrap', added: 7 }]);
  assert.equal(db.prepare('SELECT x FROM players WHERE id = ?').get(LOADER).x, 1.5);
  assert.deepEqual([...db.prepare('SELECT data FROM chunks').get().data], [1, 2, 250]);
  setPending(db, { tod: 0.7 }, LOADER);
  assert.ok(!('snapshot_pending' in dumpDb(db, LOADER)), 'the pending state is not part of a snapshot');
  assert.deepEqual(takePending(db), { live: { tod: 0.7 }, loader: LOADER });
  assert.equal(takePending(db), null, 'taken once');
});

test('checked-in snapshots hold no browser IDs', () => {
  let files = [];
  try { files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json')); } catch { /* none */ }
  for (const f of files) {
    const text = readFileSync(new URL(f, SNAPSHOT_DIR), 'utf8');
    const s = JSON.parse(text);
    assert.equal(`${s.id}.json`, f);
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    assert.deepEqual(uuids.filter((u) => !u.startsWith('00000000-0000-4000-8000-')), [], `${f}: a browser ID`);
    for (const [name, t] of Object.entries(s.tables)) {
      const i = t.columns.indexOf('name');
      if (i < 0) continue;
      const odd = t.rows.map((r) => r[i]).filter((n) => n !== null && n !== PROTAGONIST_NAME && !/^Player \d+$/.test(n));
      assert.deepEqual(odd, [], `${f}: a player's name in ${name}`);
    }
  }
});

test('walkers come back as they were: snapshot, restore at the same time, snapshot again', async () => {
  const { GuardianServer } = await import('../server/guardians.ts');
  const now = 123_456;
  const a = new GuardianServer();
  assert.ok(a.guardians.length, 'a world has guardians');
  Object.assign(a.guardians[0], { prey: 3, huntAt: now - 500, guardUntil: now + 5000, x: a.guardians[0].x + 12 });
  const saved = JSON.parse(JSON.stringify(a.snapshot())); // (as written to the file and read back)
  const b = new GuardianServer();
  b.restore(saved, now, now, (id) => id);
  assert.deepEqual(JSON.parse(JSON.stringify(b.snapshot())), saved);
  // Later: the times moved with the clock, a prey not here forgotten.
  const c = new GuardianServer();
  c.restore(JSON.parse(JSON.stringify(saved)), now, now + 1000, () => -1);
  assert.equal(c.guardians[0].guardUntil, now + 6000);
  assert.equal(c.guardians[0].prey, -1);
});
