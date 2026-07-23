import type { RecognitionResult } from './types';

/** Blueprint §5. Screens never touch providers directly — the scan flow does. */
export interface ScanContext {
  mode: 'bin_audit' | 'check_in' | 'find_it';
  /** Hint only — the model may use it for context. */
  binName?: string;
  /** bin_audit merge mode: names already recorded in the bin. */
  existingItems?: string[];
}

/** Token usage measured by the API's `usage` field — never estimated (D15). */
export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Model ID that produced the measurement, for price lookup. */
  model?: string;
}

export interface RecognitionOutcome {
  result: RecognitionResult;
  /** Absent on free engines (fixture, local); totals across repair retries. */
  usage?: VisionUsage;
}

export interface VisionProvider {
  /**
   * Resolves with a validated RecognitionResult (plus measured usage for
   * cloud engines, D15) or throws VisionError. v1 always sends exactly one
   * photo (blueprint D11); the array type keeps multi-photo/video additive
   * later.
   */
  recognize(photosBase64: string[], ctx: ScanContext): Promise<RecognitionOutcome>;
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
