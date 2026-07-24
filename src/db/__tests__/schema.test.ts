import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import { getSchemaVersion, MIGRATIONS, runMigrations } from '../schema';

describe('migration runner', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('creates every table from a fresh database', () => {
    runMigrations(db);
    const names = db
      .getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
      )
      .map((r) => r.name);
    for (const table of ['locations', 'shelves', 'bins', 'items', 'scans', 'item_search']) {
      expect(names).toContain(table);
    }
  });

  it('sets user_version to the migration count', () => {
    expect(getSchemaVersion(db)).toBe(0);
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('is idempotent — running twice applies nothing new', () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('supports FTS5 queries — the stage-3 triggers index new items automatically', () => {
    runMigrations(db);
    db.runSync(
      "INSERT INTO bins (id, short_code, name, created_at) VALUES ('b1', 'B-001', 'Hand tools', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO items (id, bin_id, name, brand, category, quantity, created_at, updated_at) VALUES ('i1', 'b1', 'Phillips screwdriver', NULL, 'hand_tool', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    const hits = db.getAllSync<{ name: string }>(
      "SELECT name FROM item_search WHERE item_search MATCH 'scre*'",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Phillips screwdriver');
  });

  it('migration 003 adds the D15 usage columns to scans, including on upgrade', () => {
    // A database stopped at version 2 (pre-cost-transparency)...
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[0]);
      db.execSync(MIGRATIONS[1]);
      db.execSync('PRAGMA user_version = 2');
    });
    db.runSync(
      "INSERT INTO scans (id, mode, photo_uri, status, created_at) VALUES ('s1', 'bin_audit', 'file:///x.jpg', 'confirmed', '2026-01-01T00:00:00Z')",
    );
    runMigrations(db);
    // ...gains the columns with NULLs for pre-existing scans.
    const row = db.getFirstSync<{
      engine: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      cost_usd: number | null;
    }>('SELECT engine, input_tokens, output_tokens, cost_usd FROM scans WHERE id = ?', ['s1']);
    expect(row).toEqual({ engine: null, input_tokens: null, output_tokens: null, cost_usd: null });
  });

  it('migration 004 adds the D16 events table on upgrade from version 3', () => {
    // A database stopped at version 3 (pre-diagnostics)...
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[0]);
      db.execSync(MIGRATIONS[1]);
      db.execSync(MIGRATIONS[2]);
      db.execSync('PRAGMA user_version = 3');
    });
    expect(() => db.getAllSync('SELECT * FROM events')).toThrow();

    runMigrations(db);
    // ...gains an empty, queryable events table.
    expect(db.getAllSync('SELECT * FROM events')).toEqual([]);
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('backfills the FTS index for items that predate migration 002', () => {
    // Apply only migration 001, insert an item, then run the rest.
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[0]);
      db.execSync('PRAGMA user_version = 1');
    });
    db.runSync(
      "INSERT INTO bins (id, short_code, name, created_at) VALUES ('b1', 'B-001', 'Bits', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO items (id, bin_id, name, brand, category, quantity, created_at, updated_at) VALUES ('i1', 'b1', 'Torx bit set', NULL, 'bit_blade_accessory', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    runMigrations(db);
    const hits = db.getAllSync<{ name: string }>(
      "SELECT name FROM item_search WHERE item_search MATCH 'torx*'",
    );
    expect(hits).toHaveLength(1);
  });
});
