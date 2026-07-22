import type { DbAdapter } from '../db/adapter';
import {
  clearScanPhoto,
  listPrunableScans,
  listQueuedScans,
  resetInterruptedScans,
} from '../db/queries';
import { processScan, type ScanFlowResult } from '../scan/scanFlow';

/**
 * Offline queue (blueprint §9), backed entirely by the scans table:
 * 1. enqueue writes photo + scans row (scanFlow.enqueueScan).
 * 2. A single drain loop — kicked on app foreground and connectivity
 *    change — picks the oldest 'queued' scan and processes it.
 * 3. network/rate_limit send a scan back to 'queued' with capped
 *    exponential backoff (30s, 2m, 10m, then manual retry only).
 * 4. Photos of discarded/failed scans older than 30 days are pruned.
 */
const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
export const PRUNE_AFTER_DAYS = 30;

export interface QueueDeps {
  process: (db: DbAdapter, scanId: string) => Promise<ScanFlowResult>;
  now: () => number;
}

export class ScanQueue {
  private attempts = new Map<string, number>();
  private eligibleAt = new Map<string, number>();
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: DbAdapter,
    private readonly deps: QueueDeps = { process: processScan, now: Date.now },
  ) {}

  /** Single drain loop: never runs concurrently with itself. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const next = this.nextEligible();
        if (!next) break;
        const result = await this.deps.process(this.db, next);
        if (result.outcome === 'queued') {
          // Retryable failure — back off; anything else settles the scan.
          const n = (this.attempts.get(next) ?? 0) + 1;
          this.attempts.set(next, n);
          this.eligibleAt.set(
            next,
            n <= BACKOFF_MS.length
              ? this.deps.now() + BACKOFF_MS[n - 1]
              : Number.POSITIVE_INFINITY,
          );
        } else {
          this.attempts.delete(next);
          this.eligibleAt.delete(next);
        }
      }
    } finally {
      this.draining = false;
    }
    this.scheduleNextWake();
  }

  /** Manual retry: clears backoff for the scan and drains immediately. */
  async retryNow(scanId: string): Promise<void> {
    this.attempts.delete(scanId);
    this.eligibleAt.delete(scanId);
    await this.drain();
  }

  /** How long until the given scan is auto-retried; null = manual only. */
  waitMsFor(scanId: string): number | null {
    const at = this.eligibleAt.get(scanId);
    if (at === undefined) return 0;
    if (!Number.isFinite(at)) return null;
    return Math.max(0, at - this.deps.now());
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private nextEligible(): string | null {
    const now = this.deps.now();
    for (const scan of listQueuedScans(this.db)) {
      const at = this.eligibleAt.get(scan.id) ?? 0;
      if (at <= now) return scan.id;
    }
    return null;
  }

  private scheduleNextWake(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.deps.now();
    let earliest = Number.POSITIVE_INFINITY;
    for (const scan of listQueuedScans(this.db)) {
      const at = this.eligibleAt.get(scan.id) ?? 0;
      if (Number.isFinite(at)) earliest = Math.min(earliest, Math.max(at, now));
    }
    if (Number.isFinite(earliest)) {
      this.timer = setTimeout(() => {
        void this.drain();
      }, Math.max(250, earliest - now));
    }
  }
}

/** Boot recovery: interrupted scans resume as queued (§8.1 kill-test AC). */
export function recoverInterruptedScans(db: DbAdapter): number {
  return resetInterruptedScans(db);
}

/** Prunes photos of old discarded/failed scans; file deletion injected. */
export function pruneOldScanPhotos(
  db: DbAdapter,
  deleteFile: (uri: string) => void,
  now: () => number = Date.now,
): number {
  const cutoff = new Date(now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let pruned = 0;
  for (const scan of listPrunableScans(db, cutoff)) {
    try {
      deleteFile(scan.photo_uri);
    } catch {
      // File already gone — still clear the reference.
    }
    clearScanPhoto(db, scan.id);
    pruned += 1;
  }
  return pruned;
}

// -------------------------------------------------------------- app wiring

let activeQueue: ScanQueue | null = null;

export function initScanQueue(db: DbAdapter): ScanQueue {
  activeQueue?.dispose();
  activeQueue = new ScanQueue(db);
  return activeQueue;
}

export function getScanQueue(): ScanQueue | null {
  return activeQueue;
}
