import type { Candidate } from '../vision/similarity';

/**
 * Calibration for visual memory's match threshold (blueprint D20, D16).
 *
 * `DEFAULT_MIN_SCORE` was set to 0.75 by judgement and its own comment admits
 * it. This measures it instead, using the one labelled test set that already
 * exists: the workshop itself. Every pair of remembered items is scored, and
 * pairs that share a bin are the ones that *should* match — an imperfect
 * stand-in for "correct", but an honest one, and free.
 *
 * Pure and synchronous so it can be unit-tested with hand-built vectors, and
 * so the screen has nothing to mock. Scores appear here and nowhere outside
 * diagnostics (§11 invariant 2).
 */

export interface CalibrationItem extends Candidate {
  /** Null bins never count as "same bin" — unfiled is not a claim. */
  binId: string | null;
}

export interface Bucket {
  /** Inclusive lower edge of the score range. */
  from: number;
  same: number;
  other: number;
}

export interface CalibrationPair {
  a: string;
  b: string;
  score: number;
  sameBin: boolean;
}

export interface Calibration {
  buckets: Bucket[];
  /** Every pair worth showing, best first. Below FLOOR is never displayed. */
  pairs: CalibrationPair[];
  /** The cutoff that gets the most pairs right, or null with nothing to judge. */
  best: number | null;
  /** Items actually compared, and how many were remembered in total. */
  compared: number;
  total: number;
  comparisons: number;
}

/** Thresholds below this are not worth offering; nothing sane sits there. */
export const FLOOR = 0.4;
export const BUCKET = 0.03;

/**
 * Comparing every pair is O(N²). A few hundred items is instant; a few
 * thousand is 500k comparisons over 512 dimensions, which would freeze the
 * screen. Above the cap a slice is used — a sample answers "is it working"
 * just as well, and the screen says so rather than quietly measuring less
 * than it claims.
 */
export const MAX_ITEMS = 300;

/** Keeps the pair list bounded on a big workshop; only the strip uses it. */
const MAX_PAIRS = 1500;

/**
 * Pre-normalises so each comparison is a plain dot product rather than a
 * cosine with two square roots — the difference between a snappy screen and
 * a stuttering one once the pair count climbs.
 */
function normalised(vector: Float32Array): Float32Array | null {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  if (sum === 0) return null;
  const norm = Math.sqrt(sum);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

export function calibrate(items: readonly CalibrationItem[]): Calibration {
  const usable = items.slice(0, MAX_ITEMS);
  const prepared: { id: string; binId: string | null; v: Float32Array }[] = [];
  for (const item of usable) {
    const v = normalised(item.vector);
    if (v) prepared.push({ id: item.itemId, binId: item.binId, v });
  }

  const count = Math.round((1 - FLOOR) / BUCKET) + 1;
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    from: Number((FLOOR + i * BUCKET).toFixed(2)),
    same: 0,
    other: 0,
  }));
  const pairs: CalibrationPair[] = [];
  let comparisons = 0;

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      const dims = Math.min(a.v.length, b.v.length);
      let dot = 0;
      for (let k = 0; k < dims; k++) dot += a.v[k] * b.v[k];
      const score = Math.max(-1, Math.min(1, dot));
      comparisons += 1;
      if (score < FLOOR) continue;

      const sameBin = a.binId !== null && a.binId === b.binId;
      const slot = Math.min(buckets.length - 1, Math.floor((score - FLOOR) / BUCKET));
      if (sameBin) buckets[slot].same += 1;
      else buckets[slot].other += 1;
      pairs.push({ a: a.id, b: b.id, score, sameBin });
    }
  }

  pairs.sort((x, y) => y.score - x.score);
  return {
    buckets,
    pairs: pairs.slice(0, MAX_PAIRS),
    best: bestThreshold(buckets),
    compared: prepared.length,
    total: items.length,
    comparisons,
  };
}

/**
 * The cutoff that gets the most pairs right: same-bin pairs kept plus
 * different-bin pairs dropped. Plain accuracy — no weighting — because the
 * point is to replace a guess with a defensible number, not to optimise a
 * metric nobody can explain.
 */
export function bestThreshold(buckets: readonly Bucket[]): number | null {
  const judged = buckets.reduce((n, b) => n + b.same + b.other, 0);
  if (judged === 0) return null;

  let best = buckets[0].from;
  let bestRight = -1;
  for (const candidate of buckets) {
    let right = 0;
    for (const b of buckets) {
      if (b.from >= candidate.from) right += b.same;
      else right += b.other;
    }
    if (right > bestRight) {
      bestRight = right;
      best = candidate.from;
    }
  }
  return best;
}

export interface ThresholdSummary {
  shown: number;
  correct: number;
  missed: number;
  /** Whole percent, or null when the cutoff would show nothing at all. */
  percent: number | null;
}

/** What a given cutoff would do, in the terms the screen states. */
export function summarise(buckets: readonly Bucket[], threshold: number): ThresholdSummary {
  let correct = 0;
  let wrong = 0;
  let missed = 0;
  for (const b of buckets) {
    if (b.from >= threshold) {
      correct += b.same;
      wrong += b.other;
    } else {
      missed += b.same;
    }
  }
  const shown = correct + wrong;
  return { shown, correct, missed, percent: shown === 0 ? null : Math.round((correct / shown) * 100) };
}

/** The pairs sitting closest to the cutoff — the ones it actually decides. */
export function pairsNear(
  pairs: readonly CalibrationPair[],
  threshold: number,
  limit = 4,
): CalibrationPair[] {
  return [...pairs]
    .sort((x, y) => Math.abs(x.score - threshold) - Math.abs(y.score - threshold))
    .slice(0, limit)
    .sort((x, y) => y.score - x.score);
}
