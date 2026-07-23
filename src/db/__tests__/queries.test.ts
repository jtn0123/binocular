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
  listSpendTotals,
  recordScanUsage,
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

  it('records scan usage and totals spend per engine (D15)', () => {
    const mk = (engine: string, cost: number | null, tokens: [number, number] | null) => {
      const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///x.jpg' });
      recordScanUsage(db, scan.id, {
        engine,
        inputTokens: tokens?.[0],
        outputTokens: tokens?.[1],
        costUsd: cost,
      });
      return scan.id;
    };
    const id = mk('openai', 0.02, [2000, 500]);
    mk('openai', 0.03, [3000, 600]);
    mk('claude', 0.04, [2500, 700]);
    mk('fixture', null, null); // free engines never appear in spend totals

    const scan = getScan(db, id);
    expect(scan?.engine).toBe('openai');
    expect(scan?.cost_usd).toBeCloseTo(0.02, 9);

    // Ordered by spend, biggest first.
    const totals = listSpendTotals(db);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toMatchObject({ engine: 'openai', scans: 2, input_tokens: 5000, output_tokens: 1100 });
    expect(totals[0].cost_usd).toBeCloseTo(0.05, 9);
    expect(totals[1]).toMatchObject({ engine: 'claude', scans: 1 });
    expect(totals[1].cost_usd).toBeCloseTo(0.04, 9);

    // Since-filter: nothing is that recent in this db (created_at is now).
    expect(listSpendTotals(db, '2999-01-01T00:00:00Z')).toHaveLength(0);
  });
});
