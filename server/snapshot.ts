// World-state snapshots: gameplay test scenarios (docs/scenarios.md), for the dev server's test world only (shared/world.ts
// TEST). A snapshot is the world's whole database (every table, every row) and the live state a restart would lose
// (the walkers, the weather, the time of day, the saver's health and hand: server/world.ts takes and gives those), saved
// to scenarios/<id>.json. Loading one replaces every table's rows with the snapshot's and ends the world process: the
// next one is built from it, as from any save.
//
// Browser IDs are secret credentials (docs/netcode.md): a snapshot is checked in, so every UUID in it is replaced by a
// placeholder, the saver's by PROTAGONIST, which becomes the browser ID of whoever loads it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SNAPSHOT_ID_RE } from '../shared/world.ts';

/** Where snapshots live: checked in, next to the code. */
export const SNAPSHOT_DIR = new URL('../scenarios/', import.meta.url);
/** The saver's browser ID in a snapshot: whoever loads it plays them. */
export const PROTAGONIST = '00000000-0000-4000-8000-000000000001';
/** Anyone else who was in the world is one of these (n from 2). */
const placeholder = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type Cell = string | number | null | { b64: string };
export type Tables = Record<string, { columns: string[]; rows: Cell[][] }>;
export type Snapshot<Live = unknown> = {
  id: string;
  label: string;
  /** What it's for, in a line. */
  note: string;
  /** The world it was taken in (its seed is the layout the rows are about). */
  world: string;
  savedAt: string;
  /** Live state (server/world.ts LiveState). */
  live: Live;
  tables: Tables;
};
/** What the debug menu lists. */
export type SnapshotInfo = { id: string; label: string; note: string; savedAt: string };

/** A loaded snapshot's live state and who loaded it, until the world built from it gives it out (takePending). */
const PENDING = 'snapshot_pending';
const tableNames = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name).filter((n) => n !== PENDING);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const columnsOf = (db: DatabaseSync, name: string) =>
  (db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[]).map((c) => c.name);

/** Every table's rows, with every UUID in them a placeholder (`saver`'s PROTAGONIST). */
export function dumpDb(db: DatabaseSync, saver: string): Tables {
  const ids = new Map<string, string>([[saver.toLowerCase(), PROTAGONIST]]);
  const anon = (s: string) => s.replace(UUID_G, (u) => {
    const k = u.toLowerCase();
    if (!ids.has(k)) ids.set(k, placeholder(ids.size + 1));
    return ids.get(k)!;
  });
  const out: Tables = {};
  for (const name of tableNames(db)) {
    const columns = columnsOf(db, name);
    const all = db.prepare(`SELECT * FROM ${quote(name)}`).all() as Record<string, unknown>[];
    const rows = all.map((row) => columns.map((c): Cell => {
      const v = row[c];
      if (v instanceof Uint8Array) return { b64: Buffer.from(v).toString('base64') };
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'string') return anon(v);
      return v as number | null;
    }));
    out[name] = { columns, rows };
  }
  return out;
}

/** Every table emptied and filled with the snapshot's rows, in one transaction; PROTAGONIST becomes `loader`. Columns
 *  are matched by name (a column added since is left to its default; one gone is dropped), tables the database
 *  doesn't have are skipped. */
export function restoreDb(db: DatabaseSync, tables: Tables, loader: string) {
  const own = (v: Cell) => (typeof v === 'string' ? v.replaceAll(PROTAGONIST, loader) : v && typeof v === 'object' ? Buffer.from(v.b64, 'base64') : v);
  db.exec('BEGIN');
  try {
    for (const name of tableNames(db)) {
      db.exec(`DELETE FROM ${quote(name)}`);
      const t = tables[name];
      if (!t?.rows.length) continue;
      const have = new Set(columnsOf(db, name));
      const keep = t.columns.map((c, i) => [c, i] as const).filter(([c]) => have.has(c));
      const insert = db.prepare(`INSERT INTO ${quote(name)} (${keep.map(([c]) => quote(c)).join(', ')}) VALUES (${keep.map(() => '?').join(', ')})`);
      for (const row of t.rows) insert.run(...keep.map(([, i]) => own(row[i])));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const fileOf = (id: string) => new URL(`${id}.json`, SNAPSHOT_DIR);

export function writeSnapshot(s: Snapshot) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  // One row a line: big, but a change shows as the lines it touches.
  const tables = Object.entries(s.tables).map(([name, t]) =>
    `    ${JSON.stringify(name)}: {\n      "columns": ${JSON.stringify(t.columns)},\n      "rows": [${t.rows.map((r) => `\n        ${JSON.stringify(r)}`).join(',')}${t.rows.length ? '\n      ' : ''}]\n    }`);
  const { tables: _, ...head } = s;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  writeFileSync(fileOf(s.id), `${top},\n  "tables": {\n${tables.join(',\n')}\n  }\n}\n`);
}

export function readSnapshot(id: string): Snapshot | null {
  if (!SNAPSHOT_ID_RE.test(id)) return null;
  try {
    return JSON.parse(readFileSync(fileOf(id), 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

export function listSnapshots(world: string): SnapshotInfo[] {
  let files: string[] = [];
  try {
    files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
  } catch { /* none yet */ }
  return files.map((f) => readSnapshot(f.slice(0, -5))).filter((s): s is Snapshot => !!s && s.world === world)
    .map(({ id, label, note, savedAt }) => ({ id, label, note, savedAt })).sort((a, b) => a.label.localeCompare(b.label));
}

/** After restoreDb: the live state for the next world process, and the browser ID of who loaded it. */
export function setPending(db: DatabaseSync, live: unknown, loader: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${PENDING} (id INTEGER PRIMARY KEY CHECK (id = 1), live TEXT NOT NULL, loader TEXT NOT NULL)`);
  db.prepare(`INSERT OR REPLACE INTO ${PENDING} (id, live, loader) VALUES (1, ?, ?)`).run(JSON.stringify(live), loader);
}

/** A world process starting: the live state a snapshot just loaded left for it (once), or null. */
export function takePending<Live>(db: DatabaseSync): { live: Live; loader: string } | null {
  db.exec(`CREATE TABLE IF NOT EXISTS ${PENDING} (id INTEGER PRIMARY KEY CHECK (id = 1), live TEXT NOT NULL, loader TEXT NOT NULL)`);
  const row = db.prepare(`SELECT live, loader FROM ${PENDING} WHERE id = 1`).get() as { live: string; loader: string } | undefined;
  db.exec(`DELETE FROM ${PENDING}`);
  return row ? { live: JSON.parse(row.live) as Live, loader: row.loader } : null;
}

/** Server-clock times saved at `savedNow`, moved to the same distance from `now` (times below 0 are "none": kept). */
export const rebase = (t: number, savedNow: number, now: number) => (t >= 0 ? t - savedNow + now : t);
