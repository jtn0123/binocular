import { countEmbeddings, listItemsNeedingEmbedding } from '../../db/embeddingQueries';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { listEvents } from '../../diagnostics/events';
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

  /**
   * D16 instrumentation. What matters here is that the *rejected* score is
   * recorded: a miss is otherwise indistinguishable from an empty memory or a
   * missing encoder, and telling those apart is the whole reason a shared
   * diagnostics bundle is worth reading.
   */
  describe('diagnostics', () => {
    const memoryEvents = (name?: string) =>
      listEvents(db, 100).filter((e) => e.kind === 'memory' && (!name || e.name === name));
    const detailOf = (index = 0) =>
      JSON.parse(memoryEvents('memory_recall')[index].detail ?? '{}') as Record<string, unknown>;

    it('records that there was no encoder at all', async () => {
      await recall(db, 'file:///photos/query.jpg');
      expect(memoryEvents('memory_recall')).toHaveLength(1);
      expect(detailOf()).toEqual({ available: false });
    });

    it('records an empty memory as empty, not as a miss', async () => {
      setEmbedder(fakeEmbedder({ 'file:///photos/query.jpg': [1, 0, 0] }));
      await recall(db, 'file:///photos/query.jpg');
      expect(detailOf()).toEqual({ model: 'fake-v1', candidates: 0 });
    });

    it('records the best score of a miss, so the threshold can be judged', async () => {
      item('10 mm socket', 'file:///photos/socket.jpg');
      setEmbedder(
        fakeEmbedder({
          'file:///photos/socket.jpg': [1, 0, 0],
          'file:///photos/kayak.jpg': [0, 1, 0],
        }),
      );
      await backfillEmbeddings(db);

      expect(await recall(db, 'file:///photos/kayak.jpg')).toEqual([]);
      const detail = detailOf();
      expect(detail).toMatchObject({ model: 'fake-v1', candidates: 1, dims: 3, hits: 0 });
      // Orthogonal vectors: the near-miss is nowhere near, and the log says so.
      expect(detail.top).toBe(0);
      expect(detail.top as number).toBeLessThan(detail.minScore as number);
    });

    it('records a hit with its score above the threshold', async () => {
      item('10 mm socket', 'file:///photos/socket.jpg');
      setEmbedder(
        fakeEmbedder({
          'file:///photos/socket.jpg': [1, 0, 0],
          'file:///photos/query.jpg': [1, 0, 0],
        }),
      );
      await backfillEmbeddings(db);

      expect(await recall(db, 'file:///photos/query.jpg')).toHaveLength(1);
      const detail = detailOf();
      expect(detail).toMatchObject({ hits: 1, top: 1 });
      expect(detail.top as number).toBeGreaterThanOrEqual(detail.minScore as number);
    });

    it('rounds the score rather than logging float noise', async () => {
      item('Nearly', 'file:///photos/near.jpg');
      setEmbedder(
        fakeEmbedder({
          'file:///photos/near.jpg': [1, 0.4],
          'file:///photos/query.jpg': [1, 0],
        }),
      );
      await backfillEmbeddings(db);
      await recall(db, 'file:///photos/query.jpg');

      const top = detailOf().top as number;
      expect(top).toBeCloseTo(0.928, 3);
      expect(String(top).replace('0.', '')).toHaveLength(3);
    });

    it('names the item whose photo would not encode', async () => {
      item('Readable', 'file:///photos/ok.jpg');
      const gone = item('Gone', 'file:///photos/missing.jpg');
      setEmbedder(fakeEmbedder({ 'file:///photos/ok.jpg': [1, 0] }));
      await backfillEmbeddings(db);

      const failures = memoryEvents('memory_embed_failed');
      expect(failures).toHaveLength(1);
      expect(JSON.parse(failures[0].detail ?? '{}')).toMatchObject({ itemId: gone.id });
    });

    it('summarises a backfill pass and what it left behind', async () => {
      for (let i = 0; i < 3; i++) item(`Item ${i}`, `file:///photos/${i}.jpg`);
      setEmbedder(
        fakeEmbedder({
          'file:///photos/0.jpg': [1, 0],
          'file:///photos/1.jpg': [0, 1],
          'file:///photos/2.jpg': [1, 1],
        }),
      );

      await backfillEmbeddings(db, 2);
      const first = memoryEvents('memory_backfill');
      expect(first).toHaveLength(1);
      expect(JSON.parse(first[0].detail ?? '{}')).toMatchObject({
        model: 'fake-v1',
        attempted: 2,
        embedded: 2,
        remaining: 1,
      });
    });

    it('stays silent when a foreground finds nothing to do', async () => {
      setEmbedder(fakeEmbedder({}));
      // Every app resume calls this; an empty pass must not spend a row.
      expect(await backfillEmbeddings(db)).toBe(0);
      expect(memoryEvents()).toHaveLength(0);
    });
  });
});
