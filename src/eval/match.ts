import type { RecognitionResult } from '../vision/types';

/**
 * Ground-truth scoring (dogfood #2). Accuracy here is MEASURED: a detected
 * item counts only if it matches a hand-written expected label. No model
 * ever grades itself (D5/D15 honesty rule).
 */
export interface ExpectedItem {
  name: string;
  aliases?: string[];
}

export interface EvalCase {
  id: string;
  photo: string;
  binName: string;
  expected: ExpectedItem[];
}

export interface CaseScore {
  caseId: string;
  expectedCount: number;
  detectedCount: number;
  matchedExpected: string[];
  missedExpected: string[];
  unmatchedDetected: string[];
  /** matched / expected — did it find what's really there? */
  recall: number;
  /** matched detections / all detections — did it invent things? */
  precision: number;
}

function singularize(token: string): string {
  // wrenches -> wrench, boxes -> box; then plain plural s (nuts -> nut).
  if (token.length > 4 && /(ches|shes|xes|sses|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** lowercase, strip punctuation, singularize each token. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map(singularize);
}

/**
 * One-way containment: EVERY alias token must appear in the detection.
 * "orange wire connectors" covers alias "wire connectors"; a bare "nuts"
 * does NOT cover "wire nuts" — generosity belongs in the alias list, not
 * the matcher.
 */
export function detectionMatches(detectedName: string, expected: ExpectedItem): boolean {
  const detected = new Set(normalizeTokens(detectedName));
  if (detected.size === 0) return false;
  const candidates = [expected.name, ...(expected.aliases ?? [])];
  return candidates.some((alias) => {
    const aliasTokens = normalizeTokens(alias);
    return aliasTokens.length > 0 && aliasTokens.every((t) => detected.has(t));
  });
}

export function scoreCase(evalCase: EvalCase, result: RecognitionResult): CaseScore {
  const matchedExpected: string[] = [];
  const missedExpected: string[] = [];
  const matchedDetected = new Set<number>();

  for (const expected of evalCase.expected) {
    const hit = result.items.findIndex((item) => detectionMatches(item.name, expected));
    if (hit >= 0) {
      matchedExpected.push(expected.name);
      matchedDetected.add(hit);
    } else {
      missedExpected.push(expected.name);
    }
  }
  // Detections that matched nothing expected (false positives / noise).
  const unmatchedDetected = result.items
    .filter((item, idx) => {
      if (matchedDetected.has(idx)) return false;
      return !evalCase.expected.some((expected) => detectionMatches(item.name, expected));
    })
    .map((item) => item.name);

  const expectedCount = evalCase.expected.length;
  const detectedCount = result.items.length;
  return {
    caseId: evalCase.id,
    expectedCount,
    detectedCount,
    matchedExpected,
    missedExpected,
    unmatchedDetected,
    recall: expectedCount === 0 ? 1 : matchedExpected.length / expectedCount,
    precision: detectedCount === 0 ? 1 : (detectedCount - unmatchedDetected.length) / detectedCount,
  };
}
