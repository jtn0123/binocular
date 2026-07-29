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

  it('migration 006 indexes tags, on upgrade, without losing what was indexed', () => {
    // A database stopped at version 5 — the shape on a field-test phone
    // before this build, with items already in it.
    db.withTransactionSync(() => {
      for (let i = 0; i < 5; i++) db.execSync(MIGRATIONS[i]);
      db.execSync('PRAGMA user_version = 5');
    });
    db.runSync(
      "INSERT INTO bins (id, short_code, name, created_at) VALUES ('b1', 'B-001', 'Fixings', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO items (id, bin_id, name, brand, category, quantity, notes, created_at, updated_at) VALUES ('i1', 'b1', 'Deck screws', 'Spax', 'fastener', 40, 'galvanised', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    // Before: the tag is invisible to search.
    expect(
      db.getAllSync("SELECT name FROM item_search WHERE item_search MATCH 'fastener'"),
    ).toHaveLength(0);

    runMigrations(db);

    // After: the tag is searchable...
    expect(
      db.getAllSync<{ name: string }>(
        "SELECT name FROM item_search WHERE item_search MATCH 'fastener'",
      ),
    ).toEqual([{ name: 'Deck screws' }]);
    // ...and every column that was already indexed still is.
    for (const query of ['deck*', 'spax', 'galvanised']) {
      expect(
        db.getAllSync('SELECT name FROM item_search WHERE item_search MATCH ?', [query]),
      ).toHaveLength(1);
    }
  });

  it('migration 010 adds the D21 arrangement columns on upgrade', () => {
    // A database stopped at version 9 (pre-arrangement), with rows in it...
    db.withTransactionSync(() => {
      for (let i = 0; i < 9; i++) db.execSync(MIGRATIONS[i]);
      db.execSync('PRAGMA user_version = 9');
    });
    db.runSync(
      "INSERT INTO locations (id, name, created_at) VALUES ('l1', 'Garage', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO shelves (id, location_id, name, created_at) VALUES ('s1', 'l1', 'Shelf A', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO bins (id, shelf_id, short_code, name, created_at) VALUES ('b1', 's1', 'B-001', 'Bits', '2026-01-01T00:00:00Z')",
    );

    runMigrations(db);

    // ...which gain a zero order and an unsized capacity, not junk.
    expect(
      db.getFirstSync<{ sort_order: number }>('SELECT sort_order FROM bins WHERE id = ?', ['b1'])
        ?.sort_order,
    ).toBe(0);
    expect(
      db.getFirstSync<{ capacity: number | null }>('SELECT capacity FROM shelves WHERE id = ?', [
        's1',
      ])?.capacity,
    ).toBeNull();
  });

  /**
   * Migration 011, the one that gave the wall an order.
   *
   * An existing workshop has no wall order to preserve — it was drawn
   * alphabetically — so the backfill has to reproduce exactly that, or someone
   * who has walked the same wall for months opens the app after an update and
   * finds their racks rearranged. There is no undo for that and no way to tell
   * them what the old order was.
   */
  describe('migration 011, on a workshop that already exists', () => {
    /** A database stopped at version 10, before the wall had an order. */
    const atVersion10 = () => {
      db.withTransactionSync(() => {
        for (let i = 0; i < 10; i++) db.execSync(MIGRATIONS[i]);
        db.execSync('PRAGMA user_version = 10');
      });
    };
    const location = (id: string, name: string) =>
      db.runSync("INSERT INTO locations (id, name, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')", [
        id,
        name,
      ]);
    const shelf = (id: string, locationId: string, name: string) =>
      db.runSync(
        "INSERT INTO shelves (id, location_id, name, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')",
        [id, locationId, name],
      );
    const orderOf = (table: 'locations' | 'shelves') =>
      db
        .getAllSync<{ name: string }>(`SELECT name FROM ${table} ORDER BY sort_order, name`)
        .map((r) => r.name);

    it('leaves the wall in the order it was already being drawn in', () => {
      atVersion10();
      // Inserted out of order on purpose: insertion order is what a naive
      // backfill would capture, and it is not what was on the screen.
      location('l2', 'Shed');
      location('l1', 'Garage');
      location('l3', 'Workshop');

      runMigrations(db);

      expect(orderOf('locations')).toEqual(['Garage', 'Shed', 'Workshop']);
      expect(
        db
          .getAllSync<{ sort_order: number }>('SELECT sort_order FROM locations ORDER BY sort_order')
          .map((r) => r.sort_order),
      ).toEqual([0, 1, 2]);
    });

    it('numbers shelves within their own rack, not across the wall', () => {
      // Shelves are ordered inside a rack. Numbering them globally would put
      // rack two's top shelf below rack one's bottom one.
      atVersion10();
      location('l1', 'Garage');
      location('l2', 'Shed');
      shelf('s2', 'l1', 'B top');
      shelf('s1', 'l1', 'A top');
      shelf('s3', 'l2', 'A shed');

      runMigrations(db);

      const rows = db.getAllSync<{ id: string; sort_order: number }>(
        'SELECT id, sort_order FROM shelves ORDER BY location_id, sort_order',
      );
      expect(rows).toEqual([
        { id: 's1', sort_order: 0 },
        { id: 's2', sort_order: 1 },
        { id: 's3', sort_order: 0 },
      ]);
    });

    it('gives two racks with the same name a stable order rather than a tie', () => {
      // Nothing stops two racks being called the same thing. A tie in the
      // backfill would let SQLite return them in either order on each read,
      // so the wall would shuffle between launches.
      atVersion10();
      location('l2', 'Bench');
      location('l1', 'Bench');

      runMigrations(db);

      const orders = db
        .getAllSync<{ sort_order: number }>('SELECT sort_order FROM locations')
        .map((r) => r.sort_order)
        .sort();
      expect(orders).toEqual([0, 1]);
    });

    it('is safe to run twice, as the runner may well do', () => {
      atVersion10();
      location('l1', 'Garage');
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();
      expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
    });
  });

  it('keeps the rebuilt FTS triggers in step on update and delete', () => {
    runMigrations(db);
    db.runSync(
      "INSERT INTO bins (id, short_code, name, created_at) VALUES ('b1', 'B-001', 'Fixings', '2026-01-01T00:00:00Z')",
    );
    db.runSync(
      "INSERT INTO items (id, bin_id, name, category, quantity, created_at, updated_at) VALUES ('i1', 'b1', 'Deck screws', 'fastener', 40, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    db.runSync("UPDATE items SET category = 'hardware' WHERE id = 'i1'");
    expect(
      db.getAllSync("SELECT name FROM item_search WHERE item_search MATCH 'fastener'"),
    ).toHaveLength(0);
    expect(
      db.getAllSync("SELECT name FROM item_search WHERE item_search MATCH 'hardware'"),
    ).toHaveLength(1);

    db.runSync("DELETE FROM items WHERE id = 'i1'");
    expect(
      db.getAllSync("SELECT name FROM item_search WHERE item_search MATCH 'hardware'"),
    ).toHaveLength(0);
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
