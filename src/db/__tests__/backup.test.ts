import { dumpAll, isDatabaseEmpty, parseBackupDump, restoreAll } from '../backupQueries';
import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  checkOutItem,
  createBin,
  returnItem,
  createLocation,
  createShelf,
  insertItem,
  insertScan,
  listCheckedOutItems,
  listLowStockItems,
  setItemQuantity,
  setLowStockThreshold,
  updateScanStatus,
} from '../queries';
import { runMigrations } from '../schema';

describe('backup dump/restore (stage 6 exit criteria)', () => {
  let source: NodeDbAdapter;
  let target: NodeDbAdapter;

  beforeEach(() => {
    source = createNodeAdapter(':memory:');
    target = createNodeAdapter(':memory:');
    runMigrations(source);
    runMigrations(target);
  });
  afterEach(() => {
    source.close();
    target.close();
  });

  function populate() {
    const loc = createLocation(source, { name: 'Garage' });
    const shelf = createShelf(source, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(source, { name: 'Fasteners', shortCode: 'B-001', shelfId: shelf.id });
    const scan = insertScan(source, {
      mode: 'bin_audit',
      photoUri: 'file:///old/photos/scan-1.jpg',
      binId: bin.id,
    });
    updateScanStatus(source, scan.id, 'confirmed', { rawResponse: '{"items":[]}' });
    insertItem(source, {
      binId: bin.id,
      name: 'Deck screws',
      category: 'fastener',
      quantity: 200,
      labelText: 'GRK R4',
      sourceScanId: scan.id,
    });
    return { bin, scan };
  }

  it('export -> import into an empty db restores an identical database', () => {
    populate();
    const dump = dumpAll(source, '2026-07-22T00:00:00Z');

    restoreAll(target, dump);
    const restored = dumpAll(target, '2026-07-22T00:00:00Z');

    expect(restored).toEqual(dump);
  });

  it('refuses to import into a non-empty database — imports never merge', () => {
    populate();
    const dump = dumpAll(source, '2026-07-22T00:00:00Z');
    createLocation(target, { name: 'Existing' });

    expect(() => restoreAll(target, dump)).toThrow(/not empty/i);
    expect(isDatabaseEmpty(target)).toBe(false);
  });

  it('rewrites photo uris through the provided mapper', () => {
    const { bin } = populate();
    source.runSync('UPDATE bins SET cover_photo_uri = ? WHERE id = ?', [
      'file:///old/photos/cover.jpg',
      bin.id,
    ]);
    const dump = dumpAll(source, '2026-07-22T00:00:00Z');

    restoreAll(target, dump, (uri) => (uri ? uri.replace('file:///old/', 'file:///new/') : uri));
    const restored = dumpAll(target, 'x');
    expect(restored.bins[0].cover_photo_uri).toBe('file:///new/photos/cover.jpg');
    expect(restored.scans[0].photo_uri).toBe('file:///new/photos/scan-1.jpg');
  });

  it('rejects unknown backup versions', () => {
    const dump = dumpAll(source, 'x');
    expect(() =>
      restoreAll(target, { ...dump, version: 2 as unknown as 1 }),
    ).toThrow(/version/i);
  });
});

describe('checkout and low stock (stage 6)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('checkout surfaces the item with its bin and return clears it', () => {
    const bin = createBin(db, { name: 'Hand tools', shortCode: 'B-003' });
    const item = insertItem(db, { binId: bin.id, name: 'Impact driver', category: 'power_tool' });

    checkOutItem(db, item.id, 'Sam');
    const out = listCheckedOutItems(db);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Impact driver', checked_out_to: 'Sam', bin_code: 'B-003' });

    // one-tap return
    returnItem(db, item.id);
    expect(listCheckedOutItems(db)).toHaveLength(0);
  });

  it('low-stock lists consumables at or below their threshold only', () => {
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-002' });
    const screws = insertItem(db, {
      binId: bin.id,
      name: 'Deck screws',
      category: 'fastener',
      quantity: 100,
    });
    insertItem(db, { binId: bin.id, name: 'Nails', category: 'fastener', quantity: 3 });

    setLowStockThreshold(db, screws.id, 50);
    expect(listLowStockItems(db)).toHaveLength(0); // 100 > 50, nails have no threshold

    setItemQuantity(db, screws.id, 40);
    const low = listLowStockItems(db);
    expect(low).toHaveLength(1);
    expect(low[0].name).toBe('Deck screws');
  });
});

describe('import manifest validation (D9 trust boundary, dogfood fuzz)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  function validDump() {
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-001', shelfId: shelf.id });
    insertItem(db, { binId: bin.id, name: 'Deck screws', category: 'fastener' });
    return JSON.parse(JSON.stringify(dumpAll(db, '2026-07-22T00:00:00Z'))) as unknown;
  }

  it('accepts a genuine dump unchanged (round-trip through JSON)', () => {
    const dump = validDump();
    expect(() => parseBackupDump(dump)).not.toThrow();
  });

  it('accepts a pre-D15 dump missing the usage keys, defaulting them to null', () => {
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///s.jpg' });
    void scan;
    const dump = JSON.parse(JSON.stringify(dumpAll(db, 'x'))) as {
      scans: Record<string, unknown>[];
    };
    for (const s of dump.scans) {
      delete s.engine;
      delete s.input_tokens;
      delete s.output_tokens;
      delete s.cost_usd;
    }
    const parsed = parseBackupDump(dump);
    expect(parsed.scans[0].engine).toBeNull();
    expect(parsed.scans[0].cost_usd).toBeNull();
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['empty object', {}],
    ['wrong version', { version: 2 }],
    ['version as string', { version: '1' }],
  ])('rejects %s with a friendly error', (_label, junk) => {
    expect(() => parseBackupDump(junk)).toThrow(/not a valid Binocular backup/i);
  });

  it('rejects a dump whose rows have hostile shapes, naming the path', () => {
    const clean = validDump();
    const dump = JSON.parse(JSON.stringify(clean)) as { items: Record<string, unknown>[] };
    dump.items[0].quantity = 'lots'; // string where an int belongs
    expect(() => parseBackupDump(dump)).toThrow(/items\.0\.quantity/);

    const dump2 = JSON.parse(JSON.stringify(clean)) as { scans: unknown };
    dump2.scans = { sneaky: true }; // object where an array belongs
    expect(() => parseBackupDump(dump2)).toThrow(/not a valid Binocular backup/i);
  });

  it('rejects an unknown item category instead of writing it to the db', () => {
    const dump = validDump() as { items: Record<string, unknown>[] };
    dump.items[0].category = 'contraband';
    expect(() => parseBackupDump(dump)).toThrow(/category/);
  });
});
