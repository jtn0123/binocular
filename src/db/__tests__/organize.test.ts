import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  createBin,
  createBinsBulk,
  getShelf,
  placeBin,
  setShelfCapacity,
  createLocation,
  createShelf,
  deleteBinIfEmpty,
  deleteLocation,
  deleteShelf,
  getBin,
  insertItem,
  insertScan,
  listBins,
  listBinsForShelf,
  listLocations,
  listShelves,
  listUnassignedBins,
  moveBinToShelf,
  nextShortCode,
  renameBin,
  renameLocation,
  renameShelf,
} from '../queries';
import { runMigrations } from '../schema';

describe('organization CRUD (blueprint Stage 2)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  describe('short-code sequencing', () => {
    it('starts at B-001 on an empty database', () => {
      expect(nextShortCode(db)).toBe('B-001');
    });

    it('continues after the highest existing code, ignoring gaps and foreign codes', () => {
      createBin(db, { name: 'a', shortCode: 'B-001' });
      createBin(db, { name: 'b', shortCode: 'B-007' });
      createBin(db, { name: 'c', shortCode: 'X-999' });
      expect(nextShortCode(db)).toBe('B-008');
    });

    it('pads to three digits and keeps counting past 999', () => {
      createBin(db, { name: 'a', shortCode: 'B-999' });
      expect(nextShortCode(db)).toBe('B-1000');
    });
  });

  describe('bulk creation', () => {
    it('creates N bins with sequential unique codes on the target shelf', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
      const created = createBinsBulk(db, { count: 12, shelfId: shelf.id });

      expect(created).toHaveLength(12);
      expect(created[0].short_code).toBe('B-001');
      expect(created[11].short_code).toBe('B-012');
      const codes = new Set(created.map((b) => b.short_code));
      expect(codes.size).toBe(12);
      expect(listBinsForShelf(db, shelf.id)).toHaveLength(12);
    });

    it('continues sequencing across separate bulk runs', () => {
      createBinsBulk(db, { count: 3 });
      const second = createBinsBulk(db, { count: 2 });
      expect(second.map((b) => b.short_code)).toEqual(['B-004', 'B-005']);
    });
  });

  describe('orphan handling', () => {
    it('deleting a shelf unassigns its bins — never deletes them', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
      const bin = createBin(db, { name: 'Bits', shortCode: 'B-001', shelfId: shelf.id });
      insertItem(db, { binId: bin.id, name: 'Driver bit', category: 'bit_blade_accessory' });

      deleteShelf(db, shelf.id);

      expect(listShelves(db, loc.id)).toHaveLength(0);
      const orphan = getBin(db, bin.id);
      expect(orphan).not.toBeNull();
      expect(orphan?.shelf_id).toBeNull();
      expect(listUnassignedBins(db).map((b) => b.id)).toContain(bin.id);
    });

    it('deleting a location removes its shelves but keeps every bin', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelfA = createShelf(db, { locationId: loc.id, name: 'A' });
      const shelfB = createShelf(db, { locationId: loc.id, name: 'B' });
      const bin1 = createBin(db, { name: 'x', shortCode: 'B-001', shelfId: shelfA.id });
      const bin2 = createBin(db, { name: 'y', shortCode: 'B-002', shelfId: shelfB.id });

      deleteLocation(db, loc.id);

      expect(listLocations(db)).toHaveLength(0);
      expect(listBins(db)).toHaveLength(2);
      expect(getBin(db, bin1.id)?.shelf_id).toBeNull();
      expect(getBin(db, bin2.id)?.shelf_id).toBeNull();
    });
  });

  describe('move mode (§8.5)', () => {
    it('re-homes a bin between shelves and to unassigned', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelfA = createShelf(db, { locationId: loc.id, name: 'A' });
      const shelfB = createShelf(db, { locationId: loc.id, name: 'B' });
      const bin = createBin(db, { name: 'x', shortCode: 'B-001', shelfId: shelfA.id });

      moveBinToShelf(db, bin.id, shelfB.id);
      expect(getBin(db, bin.id)?.shelf_id).toBe(shelfB.id);

      moveBinToShelf(db, bin.id, null);
      expect(getBin(db, bin.id)?.shelf_id).toBeNull();
    });
  });

  describe('deletion safety', () => {
    it('refuses to delete a bin that still has items', () => {
      const bin = createBin(db, { name: 'x', shortCode: 'B-001' });
      insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
      expect(deleteBinIfEmpty(db, bin.id)).toBe(false);
      expect(getBin(db, bin.id)).not.toBeNull();
    });

    it('deletes an empty bin and detaches its scan history', () => {
      const bin = createBin(db, { name: 'x', shortCode: 'B-001' });
      const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///p.jpg', binId: bin.id });
      expect(deleteBinIfEmpty(db, bin.id)).toBe(true);
      expect(getBin(db, bin.id)).toBeNull();
      // scan row survives as audit trail, no longer pointing at the bin
      const remaining = db.getFirstSync<{ bin_id: string | null }>(
        'SELECT bin_id FROM scans WHERE id = ?',
        [scan.id],
      );
      expect(remaining?.bin_id).toBeNull();
    });
  });

  describe('map arrangement (D21)', () => {
    it('new bins join the end of their shelf, in creation order', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'A' });
      // Codes deliberately out of order: the stored order must win.
      createBin(db, { name: 'x', shortCode: 'B-007', shelfId: shelf.id });
      createBin(db, { name: 'y', shortCode: 'B-002', shelfId: shelf.id });
      expect(listBinsForShelf(db, shelf.id).map((b) => b.short_code)).toEqual(['B-007', 'B-002']);
    });

    it('placeBin rewrites a shelf order', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'A' });
      const [a, b, c] = createBinsBulk(db, { count: 3, shelfId: shelf.id });
      placeBin(db, { binId: c.id, shelfId: shelf.id, orderedIds: [c.id, a.id, b.id] });
      expect(listBinsForShelf(db, shelf.id).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    });

    it('placeBin re-homes a bin across shelves at the dropped position', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelfA = createShelf(db, { locationId: loc.id, name: 'A' });
      const shelfB = createShelf(db, { locationId: loc.id, name: 'B' });
      const [a1, a2] = createBinsBulk(db, { count: 2, shelfId: shelfA.id });
      const [b1] = createBinsBulk(db, { count: 1, shelfId: shelfB.id });

      placeBin(db, { binId: a1.id, shelfId: shelfB.id, orderedIds: [a1.id, b1.id] });

      expect(getBin(db, a1.id)?.shelf_id).toBe(shelfB.id);
      expect(listBinsForShelf(db, shelfB.id).map((x) => x.id)).toEqual([a1.id, b1.id]);
      // The shelf left behind keeps its own order without rewriting.
      expect(listBinsForShelf(db, shelfA.id).map((x) => x.id)).toEqual([a2.id]);
    });

    it('moveBinToShelf appends to the destination order, not the front', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelfA = createShelf(db, { locationId: loc.id, name: 'A' });
      const shelfB = createShelf(db, { locationId: loc.id, name: 'B' });
      const [a1] = createBinsBulk(db, { count: 1, shelfId: shelfA.id });
      const [b1, b2] = createBinsBulk(db, { count: 2, shelfId: shelfB.id });

      moveBinToShelf(db, a1.id, shelfB.id);
      expect(listBinsForShelf(db, shelfB.id).map((x) => x.id)).toEqual([b1.id, b2.id, a1.id]);
    });

    it('shelf capacity is set, read back, and cleared', () => {
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'A' });
      expect(getShelf(db, shelf.id)?.capacity).toBeNull();
      setShelfCapacity(db, shelf.id, 8);
      expect(getShelf(db, shelf.id)?.capacity).toBe(8);
      setShelfCapacity(db, shelf.id, null);
      expect(getShelf(db, shelf.id)?.capacity).toBeNull();
    });

    it('bins that predate the arrangement migration keep their short-code order', () => {
      // Simulate migration-010 rows: everything at sort_order 0.
      const loc = createLocation(db, { name: 'Garage' });
      const shelf = createShelf(db, { locationId: loc.id, name: 'A' });
      createBin(db, { name: 'x', shortCode: 'B-002', shelfId: shelf.id });
      createBin(db, { name: 'y', shortCode: 'B-001', shelfId: shelf.id });
      db.runSync('UPDATE bins SET sort_order = 0');
      expect(listBinsForShelf(db, shelf.id).map((b) => b.short_code)).toEqual(['B-001', 'B-002']);
    });
  });

  it('renames propagate', () => {
    const loc = createLocation(db, { name: 'Garge' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shlef A' });
    const bin = createBin(db, { name: 'Bts', shortCode: 'B-001' });
    renameLocation(db, loc.id, 'Garage');
    renameShelf(db, shelf.id, 'Shelf A');
    renameBin(db, bin.id, 'Bits');
    expect(listLocations(db)[0].name).toBe('Garage');
    expect(listShelves(db, loc.id)[0].name).toBe('Shelf A');
    expect(getBin(db, bin.id)?.name).toBe('Bits');
  });
});
