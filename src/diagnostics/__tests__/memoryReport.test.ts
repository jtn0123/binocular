import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { backfillEmbeddings, recall, setEmbedder, type Embedder } from '../../vision/visualMemory';
import { buildMemoryReport, describeRecall } from '../memoryReport';

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

describe('memory report (D16/D20)', () => {
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

  it('reports an untouched install without pretending', () => {
    expect(buildMemoryReport(db)).toMatchObject({
      model: null,
      available: false,
      remembered: 0,
      recalls: 0,
      recent: [],
    });
  });

  it('counts the backlog even before any encoder exists', () => {
    item('10 mm socket', 'file:///photos/socket.jpg');
    item('No photo', null);
    const report = buildMemoryReport(db);
    expect(report).toMatchObject({ available: false, remembered: 0, withPhotos: 1 });
  });

  it('separates hits, misses and taps', async () => {
    item('10 mm socket', 'file:///photos/socket.jpg');
    setEmbedder(
      fakeEmbedder({
        'file:///photos/socket.jpg': [1, 0, 0],
        'file:///photos/query.jpg': [1, 0, 0],
        'file:///photos/kayak.jpg': [0, 1, 0],
      }),
    );
    await backfillEmbeddings(db);
    await recall(db, 'file:///photos/query.jpg');
    await recall(db, 'file:///photos/kayak.jpg');

    const report = buildMemoryReport(db);
    expect(report).toMatchObject({
      model: 'fake-v1',
      available: true,
      remembered: 1,
      withPhotos: 1,
      recalls: 2,
      recallsWithHits: 1,
      opened: 0,
      embedFailures: 0,
    });
    // Newest first, and the rejected score survived the miss.
    expect(report.recent[0]).toMatchObject({ hits: 0, top: 0, candidates: 1 });
    expect(report.recent[1]).toMatchObject({ hits: 1, top: 1 });
  });

  it('counts the photos that would not encode', async () => {
    item('Gone', 'file:///photos/missing.jpg');
    setEmbedder(fakeEmbedder({}));
    await backfillEmbeddings(db);
    expect(buildMemoryReport(db).embedFailures).toBe(1);
  });

  it('still names the model after the encoder is unloaded', async () => {
    item('10 mm socket', 'file:///photos/socket.jpg');
    setEmbedder(
      fakeEmbedder({ 'file:///photos/socket.jpg': [1, 0], 'file:///photos/q.jpg': [1, 0] }),
    );
    await backfillEmbeddings(db);
    await recall(db, 'file:///photos/q.jpg');
    setEmbedder(null);

    // History outlives the module state, so a shared bundle still says which
    // encoder produced the scores it contains.
    expect(buildMemoryReport(db)).toMatchObject({ model: 'fake-v1', available: false });
  });

  it('records that a recall was tapped', async () => {
    setEmbedder(fakeEmbedder({}));
    await recall(db, 'file:///photos/q.jpg');
    db.runSync(
      `INSERT INTO events (id, kind, name, detail, duration_ms, scan_id, created_at)
       VALUES ('e1', 'memory', 'memory_recall_opened', '{"rank":0}', NULL, NULL, ?)`,
      [new Date().toISOString()],
    );
    expect(buildMemoryReport(db).opened).toBe(1);
  });

  it('caps how much history it walks', async () => {
    item('10 mm socket', 'file:///photos/socket.jpg');
    setEmbedder(
      fakeEmbedder({ 'file:///photos/socket.jpg': [1, 0], 'file:///photos/q.jpg': [1, 0] }),
    );
    await backfillEmbeddings(db);
    for (let i = 0; i < 10; i++) await recall(db, 'file:///photos/q.jpg');

    expect(buildMemoryReport(db).recalls).toBe(10);
    expect(buildMemoryReport(db, 3).recent).toHaveLength(3);
  });

  describe('describeRecall', () => {
    const line = { time: '10:00:00', hits: 0, top: 0.62, candidates: 12, durationMs: 41 };

    it('says what a miss nearly matched', () => {
      expect(describeRecall(line)).toBe('no match of 12 · best 0.620 · 41ms');
    });

    it('counts a hit', () => {
      expect(describeRecall({ ...line, hits: 1, top: 0.91 })).toContain('1 match of 12');
      expect(describeRecall({ ...line, hits: 2, top: 0.91 })).toContain('2 matches of 12');
    });

    it('distinguishes an empty memory from a missing encoder', () => {
      expect(describeRecall({ ...line, candidates: 0 })).toBe('nothing memorised yet');
      expect(describeRecall({ ...line, hits: null })).toBe('no encoder loaded');
    });
  });
});
