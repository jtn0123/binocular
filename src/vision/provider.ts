import type { RecognitionResult } from './types';

/** Blueprint §5. Screens never touch providers directly — the scan flow does. */
export interface ScanContext {
  mode: 'bin_audit' | 'check_in' | 'find_it';
  /** Hint only — the model may use it for context. */
  binName?: string;
  /** bin_audit merge mode: names already recorded in the bin. */
  existingItems?: string[];
}

export interface VisionProvider {
  /**
   * Resolves with a validated RecognitionResult or throws VisionError.
   * v1 always sends exactly one photo (blueprint D11); the array type
   * keeps multi-photo/video additive later.
   */
  recognize(photosBase64: string[], ctx: ScanContext): Promise<RecognitionResult>;
}

export type VisionErrorKind = 'network' | 'auth' | 'invalid_response' | 'rate_limit';

export class VisionError extends Error {
  constructor(
    message: string,
    public readonly kind: VisionErrorKind,
  ) {
    super(message);
    this.name = 'VisionError';
  }
}
