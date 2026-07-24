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

/**
 * Stage 3: triggers keep the external-content FTS index in step with the
 * items table, plus a backfill for databases that already have items.
 */
const MIGRATION_002_FTS_TRIGGERS = `
CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO item_search(rowid, name, brand, label_text, notes)
  VALUES (new.rowid, new.name, new.brand, new.label_text, new.notes);
END;

CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO item_search(item_search, rowid, name, brand, label_text, notes)
  VALUES ('delete', old.rowid, old.name, old.brand, old.label_text, old.notes);
END;

CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO item_search(item_search, rowid, name, brand, label_text, notes)
  VALUES ('delete', old.rowid, old.name, old.brand, old.label_text, old.notes);
  INSERT INTO item_search(rowid, name, brand, label_text, notes)
  VALUES (new.rowid, new.name, new.brand, new.label_text, new.notes);
END;

INSERT INTO item_search(rowid, name, brand, label_text, notes)
  SELECT rowid, name, brand, label_text, notes FROM items;
`;

/**
 * D15 cost transparency: cloud scans record which engine ran and the
 * measured token usage + computed dollar cost. All nullable — free engines
 * (fixture, local) and pre-migration scans simply have NULLs.
 */
const MIGRATION_003_SCAN_USAGE = `
ALTER TABLE scans ADD COLUMN engine TEXT;
ALTER TABLE scans ADD COLUMN input_tokens INTEGER;
ALTER TABLE scans ADD COLUMN output_tokens INTEGER;
ALTER TABLE scans ADD COLUMN cost_usd REAL;
`;

/**
 * D16 local diagnostics: a bounded event log (see src/diagnostics/events.ts).
 * No FK on scan_id — events must outlive the scans they describe, and a
 * diagnostics write must never fail because of referential integrity.
 */
const MIGRATION_004_EVENTS = `
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  detail TEXT,
  duration_ms INTEGER,
  scan_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX events_created_at ON events(created_at);
`;

// D17: recently-deleted safety net. A full snapshot COPY — items really are
// deleted from `items`, so live queries and the FTS index need no changes
// and search can never surface a ghost. Purged after 30 days on boot.
const MIGRATION_005_DELETED_ITEMS = `
CREATE TABLE deleted_items (
  id TEXT PRIMARY KEY,
  bin_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  label_text TEXT,
  photo_uri TEXT,
  notes TEXT,
  low_stock_threshold INTEGER,
  source_scan_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX deleted_items_deleted_at ON deleted_items(deleted_at);
`;

/**
 * Field-test finding: the review screen and item editor call `category` a
 * **Tag**, but it was never indexed — typing "fastener" into Home returned
 * nothing while every fastener in the workshop carried that tag.
 *
 * FTS5 has no ALTER TABLE, so widening the index means rebuilding it. That
 * is safe here in a way that an inventory change would not be: `item_search`
 * is derived data over `items` (external content), so dropping and
 * repopulating it cannot lose anything — the append-only rule (§11.6) is
 * about the migration list, and this is a new entry, not an edited one.
 */
const MIGRATION_006_FTS_CATEGORY = `
DROP TRIGGER items_fts_insert;
DROP TRIGGER items_fts_delete;
DROP TRIGGER items_fts_update;
DROP TABLE item_search;

CREATE VIRTUAL TABLE item_search USING fts5(
  name, brand, label_text, notes, category, content='items', content_rowid='rowid'
);

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO item_search(rowid, name, brand, label_text, notes, category)
  VALUES (new.rowid, new.name, new.brand, new.label_text, new.notes, new.category);
END;

CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO item_search(item_search, rowid, name, brand, label_text, notes, category)
  VALUES ('delete', old.rowid, old.name, old.brand, old.label_text, old.notes, old.category);
END;

CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO item_search(item_search, rowid, name, brand, label_text, notes, category)
  VALUES ('delete', old.rowid, old.name, old.brand, old.label_text, old.notes, old.category);
  INSERT INTO item_search(rowid, name, brand, label_text, notes, category)
  VALUES (new.rowid, new.name, new.brand, new.label_text, new.notes, new.category);
END;

INSERT INTO item_search(rowid, name, brand, label_text, notes, category)
  SELECT rowid, name, brand, label_text, notes, category FROM items;
`;

export const MIGRATIONS: readonly string[] = [
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_FTS_TRIGGERS,
  MIGRATION_003_SCAN_USAGE,
  MIGRATION_004_EVENTS,
  MIGRATION_005_DELETED_ITEMS,
  MIGRATION_006_FTS_CATEGORY,
];

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
