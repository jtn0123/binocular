import type { DetectedChip } from './ReviewScreen';

/**
 * In-memory working state for a review in progress (field-test finding):
 * leaving the review screen — the QR-label detour, the queue round-trip,
 * plain back — used to destroy the component and with it every manual
 * addition, edit, toggle, and the picked destination bin. Detected items
 * rebuild from the scan's raw_response, but user work does not.
 *
 * Drafts are keyed by scan id, restored on mount, and cleared on save or
 * discard. Deliberately in-memory only: it survives all navigation churn;
 * process death loses only unconfirmed edits (the AI result itself is
 * always recoverable from the DB).
 */
export interface ReviewDraft {
  chips: DetectedChip[];
  keepExisting: Record<string, boolean>;
  mode: 'merge' | 'replace';
  destBinId: string | null;
}

const MAX_DRAFTS = 20;
const drafts = new Map<string, ReviewDraft>();

export function saveReviewDraft(scanId: string, draft: ReviewDraft): void {
  if (!drafts.has(scanId) && drafts.size >= MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
  drafts.set(scanId, draft);
}

export function loadReviewDraft(scanId: string): ReviewDraft | null {
  return drafts.get(scanId) ?? null;
}

export function clearReviewDraft(scanId: string): void {
  drafts.delete(scanId);
}
