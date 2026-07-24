import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  insertItem,
  insertScan,
  softDeleteItem,
  updateBinAfterScan,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import {
  formatBytes,
  orphans,
  referencedPhotoNames,
  summarizeStorage,
  type StoredPhoto,
} from '../storage';

describe('photo storage accounting', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('counts every reference: bin covers, item photos and scan photos', () => {
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001' });
    updateBinAfterScan(db, bin.id, {
      lastScannedAt: '2026-01-01T00:00:00Z',
      coverPhotoUri: 'file:///photos/cover.jpg',
    });
    insertItem(db, { binId: bin.id, name: 'Hole saw', category: 'hand_tool' });
    insertScan(db, { mode: 'bin_audit', photoUri: 'file:///photos/scan.jpg', binId: bin.id });

    const names = referencedPhotoNames(db);
    expect(names.has('cover.jpg')).toBe(true);
    expect(names.has('scan.jpg')).toBe(true);
  });

  it('protects the photo of a recently deleted item (D17 restore window)', () => {
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001' });
    const item = insertItem(db, {
      binId: bin.id,
      name: 'Hole saw',
      category: 'hand_tool',
      photoUri: 'file:///photos/holesaw.jpg',
    });
    softDeleteItem(db, item.id);

    // The item is gone from `items`, but restoring it in the next 30 days
    // must not restore a picture that a cleanup deleted in the meantime.
    const names = referencedPhotoNames(db);
    expect(names.has('holesaw.jpg')).toBe(true);
    expect(orphans([{ name: 'holesaw.jpg', size: 100 }], names)).toEqual([]);
  });

  it('finds only files nothing points at', () => {
    const photos: StoredPhoto[] = [
      { name: 'kept.jpg', size: 1000 },
      { name: 'loose.jpg', size: 250 },
    ];
    const referenced = new Set(['kept.jpg']);
    expect(orphans(photos, referenced).map((p) => p.name)).toEqual(['loose.jpg']);
  });

  it('summarizes totals and what is reclaimable', () => {
    const photos: StoredPhoto[] = [
      { name: 'a.jpg', size: 1000 },
      { name: 'b.jpg', size: 2000 },
      { name: 'c.jpg', size: 500 },
    ];
    expect(summarizeStorage(photos, new Set(['a.jpg']))).toEqual({
      files: 3,
      bytes: 3500,
      orphanFiles: 2,
      orphanBytes: 2500,
    });
  });

  it('reports nothing reclaimable when every file is referenced', () => {
    const photos: StoredPhoto[] = [{ name: 'a.jpg', size: 10 }];
    expect(summarizeStorage(photos, new Set(['a.jpg']))).toMatchObject({
      orphanFiles: 0,
      orphanBytes: 0,
    });
  });

  it('formats sizes the way a person reads them', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
  });
});
