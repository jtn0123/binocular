import type { ScanMode } from '../db/queries';

/**
 * D18 "shoot and walk": a capture can either block on recognition and open
 * the review screen, or enqueue and leave the camera up so the next bin can
 * be photographed straight away.
 *
 * The choice is a preference, but it is not available in every mode —
 * `find_it` exists to answer "where is this?" right now, so deferring it
 * would leave the user holding an item and no answer. Keeping that rule
 * here (rather than in the camera screen) makes it testable and keeps the
 * screen honest about which modes it may offer the toggle for.
 */
export type CaptureFlow = 'review_now' | 'keep_shooting';

export const DEFAULT_CAPTURE_FLOW: CaptureFlow = 'review_now';

/** Modes where deferring review makes sense (D18). */
export function supportsKeepShooting(mode: ScanMode): boolean {
  return mode === 'bin_audit' || mode === 'check_in';
}

/** The flow actually used for a capture, after mode restrictions. */
export function flowForMode(mode: ScanMode, preferred: CaptureFlow): CaptureFlow {
  return supportsKeepShooting(mode) ? preferred : 'review_now';
}
