import type { DbAdapter } from './adapter';

/**
 * Ordered, append-only migrations (blueprint §4). Never edit a shipped
 * entry — add a new one. PRAGMA user_version tracks how many have run.
 */
const MIGRATION_001_INITIAL_SCHEMA = `
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE shelves (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bins (
  id TEXT PRIMARY KEY,
  shelf_id TEXT REFERENCES shelves(id),
  short_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  cover_photo_uri TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  bin_id TEXT NOT NULL REFERENCES bins(id),
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  label_text TEXT,
  photo_uri TEXT,
  notes TEXT,
  checked_out_to TEXT,
  low_stock_threshold INTEGER,
  source_scan_id TEXT REFERENCES scans(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  bin_id TEXT REFERENCES bins(id),
  mode TEXT NOT NULL,
  photo_uri TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_response TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE VIRTUAL TABLE item_search USING fts5(
  name, brand, label_text, notes, content='items', content_rowid='rowid'
);
`;

export const MIGRATIONS: readonly string[] = [MIGRATION_001_INITIAL_SCHEMA];

export function getSchemaVersion(db: DbAdapter): number {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Applies pending migrations in order, each in its own transaction. */
export function runMigrations(db: DbAdapter): void {
  const current = getSchemaVersion(db);
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[i]);
      db.execSync(`PRAGMA user_version = ${i + 1}`);
    });
  }
}
