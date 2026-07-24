import { nearest } from '../../vision/similarity';
import {
  clearEmbeddings,
  countEmbeddings,
  countItemsWithPhotos,
  getEmbedding,
  listCandidates,
  listItemsNeedingEmbedding,
  putEmbedding,
} from '../embeddingQueries';
import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import { createBin, insertItem } from '../queries';
import { runMigrations } from '../schema';

const MODEL = 'clip-test-v1';
const v = (...values: number[]) => Float32Array.from(values);

describe('visual memory storage (D20, migration 009)', () => {
  let db: NodeDbAdapter;
  let binId: string;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    binId = createBin(db, { name: 'Tools', shortCode: 'B-001' }).id;
  });
  afterEach(() => {
    db.close();
  });

  const item = (name: string, photo: string | null = 'file:///photos/x.jpg') =>
    insertItem(db, { binId, name, category: 'hand_tool', photoUri: photo });

  it('round-trips a vector through SQLite unchanged', () => {
    const socket = item('10 mm socket');
    putEmbedding(db, socket.id, v(0.5, -0.25, 1), MODEL);
    expect(Array.from(getEmbedding(db, socket.id, MODEL)!)).toEqual([0.5, -0.25, 1]);
  });

  it('replaces rather than duplicates when an item is re-encoded', () => {
    const socket = item('10 mm socket');
    putEmbedding(db, socket.id, v(1, 0), MODEL);
    putEmbedding(db, socket.id, v(0, 1), MODEL);
    expect(countEmbeddings(db, MODEL)).toBe(1);
    expect(Array.from(getEmbedding(db, socket.id, MODEL)!)).toEqual([0, 1]);
  });

  it('never mixes vectors from different encoders', () => {
    // Vectors from two models are not comparable; returning both would
    // produce confident nonsense.
    const socket = item('10 mm socket');
    putEmbedding(db, socket.id, v(1, 0), MODEL);
    expect(listCandidates(db, 'some-other-model')).toEqual([]);
    expect(getEmbedding(db, socket.id, 'some-other-model')).toBeNull();
  });

  it('feeds nearest() directly', () => {
    const socket = item('10 mm socket');
    const paint = item('White paint');
    putEmbedding(db, socket.id, v(1, 0, 0), MODEL);
    putEmbedding(db, paint.id, v(0, 1, 0), MODEL);

    const hits = nearest(v(0.99, 0.01, 0), listCandidates(db, MODEL), { k: 1 });
    expect(hits[0].itemId).toBe(socket.id);
  });

  it('skips a corrupt row instead of failing the lookup', () => {
    const socket = item('10 mm socket');
    const paint = item('White paint');
    putEmbedding(db, socket.id, v(1, 0), MODEL);
    putEmbedding(db, paint.id, v(0, 1), MODEL);
    // Simulate a truncated blob: dims says 2, bytes hold 1 float.
    db.runSync('UPDATE item_embeddings SET dims = 8 WHERE item_id = ?', [paint.id]);

    const candidates = listCandidates(db, MODEL);
    expect(candidates.map((c) => c.itemId)).toEqual([socket.id]);
  });

  describe('the backfill work list', () => {
    it('lists items with a photo but no vector', () => {
      const socket = item('10 mm socket');
      item('No photo here', null);

      expect(listItemsNeedingEmbedding(db, MODEL).map((r) => r.id)).toEqual([socket.id]);

      putEmbedding(db, socket.id, v(1, 0), MODEL);
      expect(listItemsNeedingEmbedding(db, MODEL)).toEqual([]);
    });

    it('treats a vector from another encoder as missing', () => {
      const socket = item('10 mm socket');
      putEmbedding(db, socket.id, v(1, 0), 'old-model');
      expect(listItemsNeedingEmbedding(db, MODEL).map((r) => r.id)).toEqual([socket.id]);
    });

    it('is bounded, so a big workshop cannot stall a pass', () => {
      for (let i = 0; i < 25; i++) item(`Item ${i}`);
      expect(listItemsNeedingEmbedding(db, MODEL, 10)).toHaveLength(10);
    });
  });

  it('reports progress for the Settings screen', () => {
    const socket = item('10 mm socket');
    item('Second thing');
    item('No photo', null);

    expect(countItemsWithPhotos(db)).toBe(2);
    expect(countEmbeddings(db, MODEL)).toBe(0);
    putEmbedding(db, socket.id, v(1, 0), MODEL);
    expect(countEmbeddings(db, MODEL)).toBe(1);
  });

  it('clears everything when the feature is turned off', () => {
    const socket = item('10 mm socket');
    putEmbedding(db, socket.id, v(1, 0), MODEL);
    clearEmbeddings(db);
    expect(countEmbeddings(db, MODEL)).toBe(0);
  });

  it('upgrades a database that predates migration 009', () => {
    const old = createNodeAdapter(':memory:');
    try {
      // Everything up to 008 — the shape on a phone running build-10.
      const { MIGRATIONS } = jest.requireActual<typeof import('../schema')>('../schema');
      old.withTransactionSync(() => {
        for (let i = 0; i < 8; i++) old.execSync(MIGRATIONS[i]);
        old.execSync('PRAGMA user_version = 8');
      });
      const bin = createBin(old, { name: 'Tools', shortCode: 'B-001' });
      insertItem(old, {
        binId: bin.id,
        name: 'Existing item',
        category: 'hand_tool',
        photoUri: 'file:///photos/e.jpg',
      });

      runMigrations(old);

      // The existing item is simply waiting to be encoded.
      expect(listItemsNeedingEmbedding(old, MODEL).map((r) => r.id)).toHaveLength(1);
    } finally {
      old.close();
    }
  });
});
