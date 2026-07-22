import type { DbAdapter } from '../../db/adapter';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  getScan,
  insertScan,
  listQueuedScans,
  updateScanStatus,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import type { ScanFlowResult } from '../../scan/scanFlow';
import { pruneOldScanPhotos, recoverInterruptedScans, ScanQueue } from '../scanQueue';

describe('scan queue (blueprint §9)', () => {
  let db: NodeDbAdapter;
  let now: number;

  const clock = () => now;

  beforeEach(() => {
    jest.useFakeTimers();
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    now = 1_000_000;
  });
  afterEach(() => {
    jest.useRealTimers();
    db.close();
  });

  function makeQueuedScan(createdAt?: string): string {
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///q.jpg' });
    if (createdAt) db.runSync('UPDATE scans SET created_at = ? WHERE id = ?', [createdAt, scan.id]);
    return scan.id;
  }

  function successProcess() {
    return jest.fn(async (adapter: DbAdapter, scanId: string): Promise<ScanFlowResult> => {
      updateScanStatus(adapter, scanId, 'review', { rawResponse: '{}' });
      return { scanId, outcome: 'review' };
    });
  }

  function offlineProcess() {
    return jest.fn(async (_adapter: DbAdapter, scanId: string): Promise<ScanFlowResult> => {
      // scanFlow leaves the scan queued on network errors
      return { scanId, outcome: 'queued', error: 'offline' };
    });
  }

  it('drains queued scans oldest-first until none are eligible', async () => {
    const older = makeQueuedScan('2026-01-01T00:00:00Z');
    const newer = makeQueuedScan('2026-01-02T00:00:00Z');
    const process = successProcess();
    const queue = new ScanQueue(db, { process, now: clock });

    await queue.drain();

    expect(process.mock.calls.map((c) => c[1])).toEqual([older, newer]);
    expect(listQueuedScans(db)).toHaveLength(0);
  });

  it('never runs two drains concurrently', async () => {
    makeQueuedScan();
    let inFlight = 0;
    let maxInFlight = 0;
    const process = jest.fn(async (_a: DbAdapter, scanId: string): Promise<ScanFlowResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      updateScanStatus(db, scanId, 'review');
      return { scanId, outcome: 'review' };
    });
    const queue = new ScanQueue(db, { process, now: clock });

    await Promise.all([queue.drain(), queue.drain(), queue.drain()]);
    expect(maxInFlight).toBe(1);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('backs off 30s, 2m, 10m and then waits for manual retry', async () => {
    const scanId = makeQueuedScan();
    const process = offlineProcess();
    const queue = new ScanQueue(db, { process, now: clock });

    await queue.drain(); // attempt 1
    expect(process).toHaveBeenCalledTimes(1);
    expect(queue.waitMsFor(scanId)).toBe(30_000);

    // Too early — not retried.
    now += 10_000;
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(1);

    now += 20_000; // 30s reached — attempt 2
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(2);
    expect(queue.waitMsFor(scanId)).toBe(120_000);

    now += 120_000; // attempt 3
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(3);
    expect(queue.waitMsFor(scanId)).toBe(600_000);

    now += 600_000; // attempt 4 -> exhausted, manual only
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(4);
    expect(queue.waitMsFor(scanId)).toBeNull();

    now += 24 * 60 * 60 * 1000;
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(4); // still manual only

    // Manual retry clears the backoff immediately.
    await queue.retryNow(scanId);
    expect(process).toHaveBeenCalledTimes(5);
  });

  it('a scan that succeeds after backoff clears its state and settles', async () => {
    const scanId = makeQueuedScan();
    const process = jest
      .fn<Promise<ScanFlowResult>, [DbAdapter, string]>()
      .mockResolvedValueOnce({ scanId, outcome: 'queued', error: 'offline' })
      .mockImplementationOnce(async (adapter, id) => {
        updateScanStatus(adapter, id, 'review');
        return { scanId: id, outcome: 'review' };
      });
    const queue = new ScanQueue(db, { process, now: clock });

    await queue.drain();
    now += 30_000;
    await queue.drain();
    expect(getScan(db, scanId)?.status).toBe('review');
    expect(queue.waitMsFor(scanId)).toBe(0);
  });

  it('five offline scans all resolve after reconnect, in order, no duplicates (stage-4 AC)', async () => {
    const ids = [
      makeQueuedScan('2026-01-01T00:00:01Z'),
      makeQueuedScan('2026-01-01T00:00:02Z'),
      makeQueuedScan('2026-01-01T00:00:03Z'),
      makeQueuedScan('2026-01-01T00:00:04Z'),
      makeQueuedScan('2026-01-01T00:00:05Z'),
    ];
    // First pass: everything offline.
    const process = jest.fn(async (_adapter: DbAdapter, scanId: string): Promise<ScanFlowResult> => {
      return { scanId, outcome: 'queued', error: 'offline' };
    });
    const queue = new ScanQueue(db, { process, now: clock });
    await queue.drain();
    expect(process).toHaveBeenCalledTimes(5);

    // Reconnect after the backoff window: all succeed.
    process.mockImplementation(async (adapter: DbAdapter, scanId: string) => {
      updateScanStatus(adapter, scanId, 'review');
      return { scanId, outcome: 'review' };
    });
    now += 30_000;
    await queue.drain();

    const processedOrder = process.mock.calls.slice(5).map((c) => c[1]);
    expect(processedOrder).toEqual(ids);
    expect(listQueuedScans(db)).toHaveLength(0);
    expect(process).toHaveBeenCalledTimes(10);
  });

  it('boot recovery resumes interrupted scans as queued (kill-test AC)', () => {
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///k.jpg' });
    updateScanStatus(db, scan.id, 'processing');

    const recovered = recoverInterruptedScans(db);
    expect(recovered).toBe(1);
    expect(getScan(db, scan.id)?.status).toBe('queued');
  });

  describe('photo pruning', () => {
    it('prunes only discarded/failed scans older than 30 days', () => {
      const bin = createBin(db, { name: 'x', shortCode: 'B-001' });
      const oldDiscarded = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///old1.jpg', binId: bin.id });
      updateScanStatus(db, oldDiscarded.id, 'discarded');
      const oldFailed = insertScan(db, { mode: 'check_in', photoUri: 'file:///old2.jpg' });
      updateScanStatus(db, oldFailed.id, 'failed');
      const oldConfirmed = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///keep1.jpg', binId: bin.id });
      updateScanStatus(db, oldConfirmed.id, 'confirmed');
      const freshFailed = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///keep2.jpg' });
      updateScanStatus(db, freshFailed.id, 'failed');

      const past = '2020-01-01T00:00:00Z';
      for (const id of [oldDiscarded.id, oldFailed.id, oldConfirmed.id]) {
        db.runSync('UPDATE scans SET created_at = ? WHERE id = ?', [past, id]);
      }

      const deleted: string[] = [];
      const pruned = pruneOldScanPhotos(db, (uri) => deleted.push(uri));

      expect(pruned).toBe(2);
      expect(deleted.sort()).toEqual(['file:///old1.jpg', 'file:///old2.jpg']);
      expect(getScan(db, oldDiscarded.id)?.photo_uri).toBe('');
      expect(getScan(db, oldConfirmed.id)?.photo_uri).toBe('file:///keep1.jpg');
      expect(getScan(db, freshFailed.id)?.photo_uri).toBe('file:///keep2.jpg');
    });

    it('still clears the reference when the file is already gone', () => {
      const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///gone.jpg' });
      updateScanStatus(db, scan.id, 'discarded');
      db.runSync('UPDATE scans SET created_at = ? WHERE id = ?', ['2020-01-01T00:00:00Z', scan.id]);

      const pruned = pruneOldScanPhotos(db, () => {
        throw new Error('ENOENT');
      });
      expect(pruned).toBe(1);
      expect(getScan(db, scan.id)?.photo_uri).toBe('');
    });
  });
});
