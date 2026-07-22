import type { DbAdapter } from '../db/adapter';
import {
  getBin,
  getScan,
  insertScan,
  itemsForBin,
  updateScanStatus,
  type ScanMode,
} from '../db/queries';
import { newId } from '../lib/id';
import { nowIso } from '../lib/time';
import { resolveVisionProvider } from '../vision';
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
  return scanId;
}

/** Runs recognition for a queued/failed scan and settles its status. */
export async function processScan(db: DbAdapter, scanId: string): Promise<ScanFlowResult> {
  const scan = getScan(db, scanId);
  if (!scan) return { scanId, outcome: 'failed', error: 'Scan not found' };

  updateScanStatus(db, scanId, 'processing');
  try {
    const bin = scan.bin_id ? getBin(db, scan.bin_id) : null;
    const existingItems = scan.bin_id ? itemsForBin(db, scan.bin_id).map((i) => i.name) : [];
    const provider = await resolveVisionProvider();
    const photoBase64 = await makeUploadBase64(scan.photo_uri);
    const result = await provider.recognize([photoBase64], {
      mode: scan.mode,
      binName: bin?.name,
      existingItems: existingItems.length > 0 ? existingItems : undefined,
    });
    updateScanStatus(db, scanId, 'review', { rawResponse: JSON.stringify(result) });
    return { scanId, outcome: 'review' };
  } catch (err) {
    if (err instanceof VisionError && (err.kind === 'network' || err.kind === 'rate_limit')) {
      // Retryable: back to queued so the photo survives offline (§9).
      updateScanStatus(db, scanId, 'queued');
      return { scanId, outcome: 'queued', error: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    updateScanStatus(db, scanId, 'failed', { error: message, resolvedAt: nowIso() });
    return { scanId, outcome: 'failed', error: message };
  }
}
