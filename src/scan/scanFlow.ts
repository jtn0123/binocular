import type { DbAdapter } from '../db/adapter';
import {
  getBin,
  getScan,
  insertScan,
  itemsForBin,
  recordScanUsage,
  updateScanStatus,
  type ScanMode,
} from '../db/queries';
import { logEvent } from '../diagnostics/events';
import { newId } from '../lib/id';
import { nowIso } from '../lib/time';
import { getProviderChoice } from '../settings/settings';
import { resolveVisionProvider } from '../vision';
import { costForUsage } from '../vision/cost';
import { VisionError } from '../vision/provider';

import { makeUploadBase64, persistPhoto } from './photos';

/**
 * Scan lifecycle (blueprint §9 shape, inline for Stage 1 — the drain loop
 * with backoff arrives in Stage 4):
 *   queued -> processing -> review | failed, or back to queued on
 *   network/rate_limit so nothing is ever lost offline.
 */
export type ScanOutcome = 'review' | 'queued' | 'failed';

export interface ScanFlowResult {
  scanId: string;
  outcome: ScanOutcome;
  error?: string;
}

/** Persists the photo and creates the queued scan row — never loses a capture. */
export function enqueueScan(
  db: DbAdapter,
  input: { mode: ScanMode; binId?: string | null; tempPhotoUri: string },
): string {
  const scanId = newId();
  const photoUri = persistPhoto(input.tempPhotoUri, scanId);
  insertScan(db, { id: scanId, mode: input.mode, binId: input.binId ?? null, photoUri });
  logEvent(db, {
    kind: 'scan',
    name: 'scan_enqueued',
    scanId,
    detail: { mode: input.mode, hasBin: Boolean(input.binId) },
  });
  return scanId;
}

/** Runs recognition for a queued/failed scan and settles its status. */
export async function processScan(db: DbAdapter, scanId: string): Promise<ScanFlowResult> {
  const scan = getScan(db, scanId);
  if (!scan) return { scanId, outcome: 'failed', error: 'Scan not found' };
  if (scan.status === 'processing') {
    // Another caller (queue drain vs manual retry) already owns this scan.
    return { scanId, outcome: 'failed', error: 'Scan is already being processed' };
  }

  updateScanStatus(db, scanId, 'processing');
  const startedAt = Date.now();
  try {
    const bin = scan.bin_id ? getBin(db, scan.bin_id) : null;
    const existingItems = scan.bin_id ? itemsForBin(db, scan.bin_id).map((i) => i.name) : [];
    const provider = await resolveVisionProvider();
    const photoBase64 = await makeUploadBase64(scan.photo_uri);
    const { result, usage } = await provider.recognize([photoBase64], {
      mode: scan.mode,
      binName: bin?.name,
      existingItems: existingItems.length > 0 ? existingItems : undefined,
    });
    updateScanStatus(db, scanId, 'review', { rawResponse: JSON.stringify(result) });
    // D15: record which engine ran and, when the API metered it, the spend.
    const engine = await getProviderChoice();
    recordScanUsage(db, scanId, {
      engine,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd:
        usage && (engine === 'claude' || engine === 'openai')
          ? costForUsage(engine, usage)
          : null,
    });
    // D16: how long recognition actually took, and on which engine.
    logEvent(db, {
      kind: 'scan',
      name: 'scan_settled',
      scanId,
      durationMs: Date.now() - startedAt,
      detail: { outcome: 'review', engine, mode: scan.mode, items: result.items.length },
    });
    return { scanId, outcome: 'review' };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const kind = err instanceof VisionError ? err.kind : 'unknown';
    if (err instanceof VisionError && (err.kind === 'network' || err.kind === 'rate_limit')) {
      // Retryable: back to queued so the photo survives offline (§9).
      updateScanStatus(db, scanId, 'queued');
      logEvent(db, {
        kind: 'scan',
        name: 'scan_settled',
        scanId,
        durationMs,
        detail: { outcome: 'queued', errorKind: kind, mode: scan.mode },
      });
      return { scanId, outcome: 'queued', error: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    updateScanStatus(db, scanId, 'failed', { error: message, resolvedAt: nowIso() });
    logEvent(db, {
      kind: 'scan',
      name: 'scan_settled',
      scanId,
      durationMs,
      detail: { outcome: 'failed', errorKind: kind, mode: scan.mode, message },
    });
    return { scanId, outcome: 'failed', error: message };
  }
}
