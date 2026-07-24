import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  createLocation,
  createShelf,
  getBin,
  getBinPlace,
  insertItem,
  insertScan,
  itemsForBin,
  listAllShelves,
  listDeletedItems,
  listItemPhotoUris,
  listLocations,
  moveItemToBin,
  purgeDeletedItems,
  restoreDeletedItem,
  setBinCoverPhoto,
  softDeleteItem,
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

describe('round-5: trash (D17), move, place, cover', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('softDeleteItem snapshots then really deletes; restore round-trips', () => {
    const bin = quickCreateBin(db);
    const item = insertItem(db, {
      binId: bin.id,
      name: 'Old batteries',
      category: 'electrical',
      quantity: 4,
      notes: 'half dead',
    });
    softDeleteItem(db, item.id);
    expect(itemsForBin(db, bin.id)).toHaveLength(0);
    expect(listDeletedItems(db)).toHaveLength(1);

    expect(restoreDeletedItem(db, item.id)).toBe(true);
    const restored = itemsForBin(db, bin.id);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(item.id);
    expect(restored[0].notes).toBe('half dead');
    expect(listDeletedItems(db)).toHaveLength(0);
  });

  it('restore into an explicit target bin when the original is gone', () => {
    const binA = quickCreateBin(db);
    const binB = quickCreateBin(db);
    const item = insertItem(db, { binId: binA.id, name: 'Widget', category: 'other' });
    softDeleteItem(db, item.id);
    expect(restoreDeletedItem(db, item.id, binB.id)).toBe(true);
    expect(itemsForBin(db, binB.id)).toHaveLength(1);
  });

  it('purgeDeletedItems removes only entries older than the cutoff', () => {
    const bin = quickCreateBin(db);
    const item = insertItem(db, { binId: bin.id, name: 'Old', category: 'other' });
    softDeleteItem(db, item.id);
    db.runSync('UPDATE deleted_items SET deleted_at = ? WHERE id = ?', [
      '2020-01-01T00:00:00.000Z',
      item.id,
    ]);
    const fresh = insertItem(db, { binId: bin.id, name: 'Fresh', category: 'other' });
    softDeleteItem(db, fresh.id);
    purgeDeletedItems(db, 30);
    const remaining = listDeletedItems(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(fresh.id);
  });

  it('moveItemToBin re-homes an item', () => {
    const binA = quickCreateBin(db);
    const binB = quickCreateBin(db);
    const item = insertItem(db, { binId: binA.id, name: 'Wrench', category: 'hand_tool' });
    moveItemToBin(db, item.id, binB.id);
    expect(itemsForBin(db, binA.id)).toHaveLength(0);
    expect(itemsForBin(db, binB.id).map((i) => i.id)).toEqual([item.id]);
  });

  it('getBinPlace returns the shelf and location names', () => {
    const bin = quickCreateBin(db);
    expect(getBinPlace(db, bin.id)).toEqual({ shelfName: 'Shelf A', locationName: 'Workshop' });
  });

  it('setBinCoverPhoto sets the cover without touching last_scanned_at', () => {
    const bin = quickCreateBin(db);
    setBinCoverPhoto(db, bin.id, 'file:///cover.jpg');
    const fresh = getBin(db, bin.id);
    expect(fresh?.cover_photo_uri).toBe('file:///cover.jpg');
    expect(fresh?.last_scanned_at).toBeNull();
  });
});
