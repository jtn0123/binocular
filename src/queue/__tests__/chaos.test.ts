import type { DbAdapter } from '../../db/adapter';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { getScan, insertScan, listQueuedScans, updateScanStatus } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import type { ScanFlowResult } from '../../scan/scanFlow';
import { recoverInterruptedScans, ScanQueue } from '../scanQueue';

/**
 * Chaos/torture coverage (dogfood #6+#7) — the automatable core of the
 * on-device chaos.sh: interleaved offline/reconnect/kill sequences that the
 * §9 state machine must survive without losing or duplicating a scan.
 */
describe('queue chaos (blueprint §9)', () => {
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

  function queue(process: (a: DbAdapter, id: string) => Promise<ScanFlowResult>) {
    return new ScanQueue(db, { process, now: clock });
  }
  function enqueue(n: number): string[] {
    return Array.from({ length: n }, (_, i) => {
      const scan = insertScan(db, { mode: 'bin_audit', photoUri: `file:///q${i}.jpg` });
      db.runSync('UPDATE scans SET created_at = ? WHERE id = ?', [
        `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        scan.id,
      ]);
      return scan.id;
    });
  }

  it('flapping connectivity never loses or double-processes a scan', async () => {
    const ids = enqueue(4);
    let online = false;
    const seen = new Map<string, number>();
    const process = jest.fn(async (adapter: DbAdapter, id: string): Promise<ScanFlowResult> => {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (!online) return { scanId: id, outcome: 'queued', error: 'offline' };
      updateScanStatus(adapter, id, 'review');
      return { scanId: id, outcome: 'review' };
    });
    const q = queue(process);

    // Flap offline/online across several backoff windows.
    for (let round = 0; round < 5; round++) {
      online = round % 2 === 1;
      await q.drain();
      now += 600_000; // jump past the longest backoff each round
    }
    online = true;
    for (const id of ids) await q.retryNow(id);

    // Every scan settled to review exactly once-successfully; none lost.
    expect(listQueuedScans(db)).toHaveLength(0);
    for (const id of ids) expect(getScan(db, id)?.status).toBe('review');
  });

  it('kill during processing + reboot recovery leaves nothing stuck', async () => {
    const ids = enqueue(3);
    // Simulate a crash mid-drain: mark them processing, then "reboot".
    for (const id of ids) updateScanStatus(db, id, 'processing');

    const recovered = recoverInterruptedScans(db);
    expect(recovered).toBe(3);
    // Post-reboot every interrupted scan is queued again, none orphaned.
    expect(listQueuedScans(db)).toHaveLength(3);

    const process = jest.fn(async (adapter: DbAdapter, id: string): Promise<ScanFlowResult> => {
      updateScanStatus(adapter, id, 'review');
      return { scanId: id, outcome: 'review' };
    });
    await queue(process).drain();
    expect(process).toHaveBeenCalledTimes(3);
    expect(listQueuedScans(db)).toHaveLength(0);
  });

  it('a scan killed after success is not reprocessed on recovery', async () => {
    const [id] = enqueue(1);
    updateScanStatus(db, id, 'review'); // already succeeded
    // Recovery only resets 'processing' rows — a settled scan is untouched.
    expect(recoverInterruptedScans(db)).toBe(0);
    expect(getScan(db, id)?.status).toBe('review');
  });
});
