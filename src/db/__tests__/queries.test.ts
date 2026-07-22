import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  createBin,
  createLocation,
  createShelf,
  getBin,
  getScan,
  insertItem,
  insertScan,
  itemsForBin,
  listBins,
  listRecentBins,
  updateBinAfterScan,
  updateScanStatus,
} from '../queries';
import { runMigrations } from '../schema';
import { seedIfEmpty } from '../seed';

describe('typed query helpers', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('creates and reads the location → shelf → bin hierarchy', () => {
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-001', shelfId: shelf.id });

    const fetched = getBin(db, bin.id);
    expect(fetched?.name).toBe('Fasteners');
    expect(fetched?.shelf_id).toBe(shelf.id);
    expect(listBins(db)).toHaveLength(1);
  });

  it('stores and lists items for a bin', () => {
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001' });
    insertItem(db, { binId: bin.id, name: 'Driver bits', category: 'bit_blade_accessory' });
    insertItem(db, {
      binId: bin.id,
      name: 'Hole saw',
      category: 'bit_blade_accessory',
      quantity: 2,
      brand: 'Milwaukee',
    });

    const items = itemsForBin(db, bin.id);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name).sort()).toEqual(['Driver bits', 'Hole saw']);
    expect(items.find((i) => i.brand === 'Milwaukee')?.quantity).toBe(2);
  });

  it('walks a scan through its status lifecycle', () => {
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001' });
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///photo.jpg', binId: bin.id });
    expect(getScan(db, scan.id)?.status).toBe('queued');

    updateScanStatus(db, scan.id, 'processing');
    updateScanStatus(db, scan.id, 'review', { rawResponse: '{"items":[]}' });
    const inReview = getScan(db, scan.id);
    expect(inReview?.status).toBe('review');
    expect(inReview?.raw_response).toBe('{"items":[]}');

    updateScanStatus(db, scan.id, 'confirmed', { resolvedAt: '2026-01-02T00:00:00Z' });
    const done = getScan(db, scan.id);
    expect(done?.status).toBe('confirmed');
    expect(done?.resolved_at).toBe('2026-01-02T00:00:00Z');
    // earlier raw_response is preserved by the COALESCE update
    expect(done?.raw_response).toBe('{"items":[]}');
  });

  it('orders recent bins by last activity', () => {
    const a = createBin(db, { name: 'A', shortCode: 'B-001' });
    const b = createBin(db, { name: 'B', shortCode: 'B-002' });
    updateBinAfterScan(db, a.id, { lastScannedAt: '2099-01-01T00:00:00Z', coverPhotoUri: null });

    const recent = listRecentBins(db, 5);
    expect(recent[0].id).toBe(a.id);
    expect(recent[1].id).toBe(b.id);
  });

  it('seeds demo data exactly once', () => {
    expect(seedIfEmpty(db)).toBe(true);
    expect(listBins(db)).toHaveLength(4);
    expect(seedIfEmpty(db)).toBe(false);
    expect(listBins(db)).toHaveLength(4);
  });
});
