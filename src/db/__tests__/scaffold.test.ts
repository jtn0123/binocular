import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  createLocation,
  createShelf,
  getBin,
  insertItem,
  insertScan,
  itemsForBin,
  listAllShelves,
  listItemPhotoUris,
  listLocations,
  updateItem,
} from '../queries';
import { ensureDefaultShelf, quickCreateBin } from '../scaffold';
import { runMigrations } from '../schema';

describe('first-run scaffolding (field-test finding: no-QR bin creation)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('creates Workshop / Shelf A on a completely empty database', () => {
    const shelf = ensureDefaultShelf(db);
    expect(shelf.name).toBe('Shelf A');
    const locations = listLocations(db);
    expect(locations).toHaveLength(1);
    expect(locations[0].name).toBe('Workshop');
    expect(shelf.location_id).toBe(locations[0].id);
  });

  it('reuses an existing shelf instead of scaffolding a duplicate', () => {
    const location = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: location.id, name: 'Top shelf' });
    expect(ensureDefaultShelf(db).id).toBe(shelf.id);
    expect(listLocations(db)).toHaveLength(1);
    expect(listAllShelves(db)).toHaveLength(1);
  });

  it('quickCreateBin makes a shelved bin with the next sequential code', () => {
    const first = quickCreateBin(db);
    expect(first.short_code).toBe('B-001');
    expect(first.name).toBe('Bin B-001');
    expect(first.shelf_id).not.toBeNull();

    const second = quickCreateBin(db);
    expect(second.short_code).toBe('B-002');
    // Same default shelf, no duplicate scaffolding.
    expect(second.shelf_id).toBe(first.shelf_id);
    expect(listLocations(db)).toHaveLength(1);
    expect(getBin(db, second.id)).not.toBeNull();
  });
});

describe('round-3 field feedback queries', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('updateItem rewrites identity fields and clamps quantity at zero', () => {
    const bin = quickCreateBin(db);
    const item = insertItem(db, { binId: bin.id, name: 'Batteries', category: 'electrical' });
    updateItem(db, item.id, {
      name: 'Old batteries',
      brand: 'Duracell',
      category: 'other',
      quantity: -3,
      labelText: 'AA 24-pack',
    });
    const rows = itemsForBin(db, bin.id);
    expect(rows[0].name).toBe('Old batteries');
    expect(rows[0].brand).toBe('Duracell');
    expect(rows[0].category).toBe('other');
    expect(rows[0].quantity).toBe(0);
    expect(rows[0].label_text).toBe('AA 24-pack');
  });

  it('listItemPhotoUris returns distinct source-scan photos, empty when none', () => {
    const bin = quickCreateBin(db);
    expect(listItemPhotoUris(db, bin.id)).toEqual([]);
    const scan = insertScan(db, { mode: 'check_in', photoUri: 'file:///a.jpg' });
    insertItem(db, { binId: bin.id, name: 'One', category: 'other', sourceScanId: scan.id });
    insertItem(db, { binId: bin.id, name: 'Two', category: 'other', sourceScanId: scan.id });
    // Two items from the same scan -> one distinct photo.
    expect(listItemPhotoUris(db, bin.id)).toEqual(['file:///a.jpg']);
    // Manual items (no source scan) contribute nothing.
    insertItem(db, { binId: bin.id, name: 'Manual', category: 'other' });
    expect(listItemPhotoUris(db, bin.id)).toHaveLength(1);
  });
});
