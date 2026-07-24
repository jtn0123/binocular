import { countEmbeddings, listItemsNeedingEmbedding } from '../../db/embeddingQueries';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import {
  backfillEmbeddings,
  isVisualMemoryAvailable,
  recall,
  rememberItem,
  setEmbedder,
  type Embedder,
} from '../visualMemory';

/**
 * A stand-in encoder: each photo uri maps to a fixed vector, so "resembles"
 * is exactly controllable. The real encoder is a native module; what this
 * suite is testing is the retrieval logic around it.
 */
function fakeEmbedder(vectors: Record<string, number[]>, model = 'fake-v1'): Embedder {
  return {
    model,
    embed: async (uri) => {
      const vector = vectors[uri];
      if (!vector) throw new Error(`no fixture vector for ${uri}`);
      return Float32Array.from(vector);
    },
  };
}

describe('visual memory (D20)', () => {
  let db: NodeDbAdapter;
  let binId: string;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    binId = createBin(db, { name: 'Sockets', shortCode: 'B-004', shelfId: shelf.id }).id;
  });
  afterEach(() => {
    db.close();
    setEmbedder(null);
  });

  const item = (name: string, photo: string | null) =>
    insertItem(db, { binId, name, category: 'hand_tool', photoUri: photo });

  describe('when no encoder has been downloaded', () => {
    it('reports itself unavailable rather than pretending', () => {
      expect(isVisualMemoryAvailable()).toBe(false);
    });

    it('recalls nothing, remembers nothing, and backfills nothing', async () => {
      const socket = item('10 mm socket', 'file:///photos/socket.jpg');
      await expect(recall(db, 'file:///photos/query.jpg')).resolves.toEqual([]);
      await expect(rememberItem(db, socket.id, 'file:///photos/socket.jpg')).resolves.toBe(false);
      await expect(backfillEmbeddings(db)).resolves.toBe(0);
    });
  });

  describe('recall', () => {
    it('returns resembling items closest first, with their breadcrumb', async () => {
      const socket = item('10 mm socket', 'file:///photos/socket.jpg');
      const spanner = item('10 mm spanner', 'file:///photos/spanner.jpg');
      item('White paint', 'file:///photos/paint.jpg');

      setEmbedder(
        fakeEmbedder({
          'file:///photos/socket.jpg': [1, 0, 0],
          'file:///photos/spanner.jpg': [0.95, 0.31, 0],
          'file:///photos/paint.jpg': [0, 1, 0],
          'file:///photos/query.jpg': [1, 0, 0],
        }),
      );
      await backfillEmbeddings(db);

      const hits = await recall(db, 'file:///photos/query.jpg');
      expect(hits.map((h) => h.itemId)).toEqual([socket.id, spanner.id]);
      expect(hits[0]).toMatchObject({
        name: '10 mm socket',
        binCode: 'B-004',
        binName: 'Sockets',
        shelfName: 'Shelf A',
        locationName: 'Garage',
      });
    });

    it('returns nothing for an object unlike anything catalogued', async () => {
      // D20's core promise — no least-bad match presented confidently.
      item('10 mm socket', 'file:///photos/socket.jpg');
      setEmbedder(
        fakeEmbedder({
          'file:///photos/socket.jpg': [1, 0, 0],
          'file:///photos/kayak.jpg': [0, 1, 0],
        }),
      );
      await backfillEmbeddings(db);

      await expect(recall(db, 'file:///photos/kayak.jpg')).resolves.toEqual([]);
    });

    it('returns nothing when nothing has been catalogued yet', async () => {
      setEmbedder(fakeEmbedder({ 'file:///photos/query.jpg': [1, 0, 0] }));
      await expect(recall(db, 'file:///photos/query.jpg')).resolves.toEqual([]);
    });

    it('never mixes vectors from a previous encoder', async () => {
      const socket = item('10 mm socket', 'file:///photos/socket.jpg');
      setEmbedder(fakeEmbedder({ 'file:///photos/socket.jpg': [1, 0, 0] }, 'old-model'));
      await backfillEmbeddings(db);
      expect(countEmbeddings(db, 'old-model')).toBe(1);

      // Swapping encoders makes the old vectors invisible, and the item
      // reappears on the backfill work list rather than being compared
      // against numbers from a different model.
      setEmbedder(fakeEmbedder({ 'file:///photos/socket.jpg': [1, 0, 0] }, 'new-model'));
      await expect(recall(db, 'file:///photos/socket.jpg')).resolves.toEqual([]);
      expect(listItemsNeedingEmbedding(db, 'new-model').map((r) => r.id)).toEqual([socket.id]);
    });

    it('honours the requested result count', async () => {
      for (let i = 0; i < 5; i++) item(`Socket ${i}`, `file:///photos/${i}.jpg`);
      const vectors: Record<string, number[]> = { 'file:///photos/q.jpg': [1, 0] };
      for (let i = 0; i < 5; i++) vectors[`file:///photos/${i}.jpg`] = [1, i * 0.001];
      setEmbedder(fakeEmbedder(vectors));
      await backfillEmbeddings(db);

      await expect(recall(db, 'file:///photos/q.jpg', { k: 2 })).resolves.toHaveLength(2);
    });
  });

  describe('backfill', () => {
    it('walks the backlog and stops when there is nothing left', async () => {
      item('A', 'file:///photos/a.jpg');
      item('B', 'file:///photos/b.jpg');
      item('No photo', null);
      setEmbedder(fakeEmbedder({ 'file:///photos/a.jpg': [1, 0], 'file:///photos/b.jpg': [0, 1] }));

      expect(await backfillEmbeddings(db)).toBe(2);
      expect(await backfillEmbeddings(db)).toBe(0);
      expect(countEmbeddings(db, 'fake-v1')).toBe(2);
    });

    it('is bounded, so a big workshop cannot stall a pass', async () => {
      const vectors: Record<string, number[]> = {};
      for (let i = 0; i < 20; i++) {
        item(`Item ${i}`, `file:///photos/${i}.jpg`);
        vectors[`file:///photos/${i}.jpg`] = [1, i];
      }
      setEmbedder(fakeEmbedder(vectors));
      expect(await backfillEmbeddings(db, 5)).toBe(5);
    });

    it('one unreadable photo does not stop the pass', async () => {
      item('Readable', 'file:///photos/ok.jpg');
      item('Gone', 'file:///photos/missing.jpg');
      // The fixture throws for the missing uri, like a deleted file would.
      setEmbedder(fakeEmbedder({ 'file:///photos/ok.jpg': [1, 0] }));

      expect(await backfillEmbeddings(db)).toBe(1);
      expect(countEmbeddings(db, 'fake-v1')).toBe(1);
    });
  });
});
