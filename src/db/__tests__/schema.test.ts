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

  it('supports FTS5 queries against item_search', () => {
    runMigrations(db);
    db.runSync(
      "INSERT INTO bins (id, short_code, name, created_at) VALUES ('b1', 'B-001', 'Hand tools', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO items (id, bin_id, name, brand, category, quantity, created_at, updated_at) VALUES ('i1', 'b1', 'Phillips screwdriver', NULL, 'hand_tool', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO item_search (rowid, name, brand, label_text, notes) SELECT rowid, name, brand, label_text, notes FROM items WHERE id = 'i1'",
    );
    const hits = db.getAllSync<{ name: string }>(
      "SELECT name FROM item_search WHERE item_search MATCH 'scre*'",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Phillips screwdriver');
  });
});
