/**
 * Vector maths for visual memory (blueprint D20).
 *
 * Pure and dependency-free on purpose: the encoder that produces vectors is a
 * heavyweight native module, but *comparing* them is arithmetic, so the part
 * that decides what the user sees is fully testable without a model, a
 * device, or a download.
 *
 * Brute force is the right algorithm here. A workshop has hundreds to a few
 * thousand items, and a dot product over 512 floats is trivial — a vector
 * index would be a dependency and a correctness risk bought for nothing.
 */

export interface Candidate {
  itemId: string;
  vector: Float32Array;
}

export interface Match {
  itemId: string;
  /**
   * Cosine similarity, -1..1. Deliberately NOT surfaced to the user: D5
   * forbids numeric confidence, and a cosine is exactly that kind of false
   * precision. It exists to order and threshold, nothing else.
   */
  score: number;
}

/**
 * Cosine similarity. Returns 0 for mismatched or empty vectors rather than
 * throwing — a corrupt stored row should cost one suggestion, not the screen.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 0;
  const score = dot / (Math.sqrt(aa) * Math.sqrt(bb));
  // Floating-point drift can push an identical pair a hair past 1.
  return Math.max(-1, Math.min(1, score));
}

/**
 * The `k` closest candidates above `minScore`, best first.
 *
 * The threshold is what keeps D20's "never name something it has not been
 * shown" promise: without it, the least-bad match of an unrelated object
 * always wins and the feature confidently invents things.
 */
export function nearest(
  query: Float32Array,
  candidates: readonly Candidate[],
  { k = 3, minScore = 0 }: { k?: number; minScore?: number } = {},
): Match[] {
  const scored: Match[] = [];
  for (const candidate of candidates) {
    const score = cosine(query, candidate.vector);
    if (score >= minScore) scored.push({ itemId: candidate.itemId, score });
  }
  // Ties break on item id so the order is stable between renders.
  scored.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId));
  return scored.slice(0, Math.max(0, k));
}

/** Little-endian Float32 bytes for SQLite storage. */
export function vectorToBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(
    vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength),
  );
}

/**
 * Reads a stored vector back. Returns null on a length that is not a whole
 * number of floats, or on a mismatch with the recorded dimensions — a
 * truncated blob must not become a silently wrong suggestion.
 */
export function bytesToVector(bytes: Uint8Array, dims: number): Float32Array | null {
  if (bytes.byteLength !== dims * 4) return null;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}
