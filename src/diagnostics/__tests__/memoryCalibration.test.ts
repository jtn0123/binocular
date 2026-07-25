import {
  bestThreshold,
  calibrate,
  FLOOR,
  MAX_ITEMS,
  pairsNear,
  summarise,
  type CalibrationItem,
} from '../memoryCalibration';

const item = (id: string, binId: string | null, ...v: number[]): CalibrationItem => ({
  itemId: id,
  binId,
  vector: Float32Array.from(v),
});

describe('calibrating the match threshold (D20)', () => {
  it('has nothing to say about an empty memory', () => {
    const c = calibrate([]);
    expect(c).toMatchObject({ best: null, compared: 0, comparisons: 0, pairs: [] });
    expect(c.buckets.every((b) => b.same === 0 && b.other === 0)).toBe(true);
  });

  it('says nothing from a single item — one thing has no pairs', () => {
    expect(calibrate([item('a', 'bin1', 1, 0)])).toMatchObject({ comparisons: 0, best: null });
  });

  it('scores a pair by direction, not by length', () => {
    // The same photo at twice the magnitude is still the same photo.
    const c = calibrate([item('a', 'bin1', 1, 0), item('b', 'bin1', 2, 0)]);
    expect(c.pairs).toHaveLength(1);
    expect(c.pairs[0].score).toBeCloseTo(1, 6);
    expect(c.pairs[0].sameBin).toBe(true);
  });

  it('ignores pairs too far apart to ever matter', () => {
    // Orthogonal: score 0, below FLOOR, so it is never offered as a match.
    const c = calibrate([item('a', 'bin1', 1, 0), item('b', 'bin2', 0, 1)]);
    expect(c.comparisons).toBe(1);
    expect(c.pairs).toEqual([]);
  });

  it('does not call two unfiled items "same bin"', () => {
    // Both binId null. Null is absence, not a claim of shared location.
    const c = calibrate([item('a', null, 1, 0), item('b', null, 1, 0)]);
    expect(c.pairs[0].sameBin).toBe(false);
  });

  it('survives a zero vector instead of dividing by its length', () => {
    const c = calibrate([item('a', 'bin1', 0, 0), item('b', 'bin1', 1, 0)]);
    expect(c.compared).toBe(1);
    expect(c.comparisons).toBe(0);
  });

  it('caps the work on a workshop too big to compare exhaustively', () => {
    const many = Array.from({ length: MAX_ITEMS + 40 }, (_, i) => item(`i${i}`, 'bin1', 1, i / 1000));
    const c = calibrate(many);
    expect(c.compared).toBe(MAX_ITEMS);
    expect(c.total).toBe(MAX_ITEMS + 40);
    // Sampled, and the numbers say so rather than implying full coverage.
    expect(c.comparisons).toBe((MAX_ITEMS * (MAX_ITEMS - 1)) / 2);
  });

  it('files each pair in the bucket its score falls in', () => {
    const c = calibrate([item('a', 'bin1', 1, 0), item('b', 'bin1', 1, 0)]);
    const hit = c.buckets.filter((b) => b.same > 0);
    expect(hit).toHaveLength(1);
    // A perfect 1.0 lands in the last bucket, not off the end of the array.
    expect(hit[0].from).toBe(c.buckets[c.buckets.length - 1].from);
  });
});

describe('picking the best cutoff', () => {
  const buckets = (...rows: [number, number, number][]) =>
    rows.map(([from, same, other]) => ({ from, same, other }));

  it('puts the line where same-bin and different-bin pairs separate', () => {
    const b = buckets([0.5, 0, 40], [0.6, 1, 20], [0.7, 5, 4], [0.8, 30, 1], [0.9, 40, 0]);
    // 0.70 keeps 75 same-bin and drops 60 different-bin = 135 right.
    // 0.80 keeps 70 and drops 64 = 134. The looser line wins by one, which
    // is the rule doing its job rather than eyeballing where the bars cross.
    expect(bestThreshold(b)).toBe(0.7);
  });

  it('tightens the line when loosening it would let junk through', () => {
    const b = buckets([0.5, 0, 40], [0.6, 0, 30], [0.7, 1, 25], [0.8, 30, 2], [0.9, 40, 0]);
    expect(bestThreshold(b)).toBe(0.8);
  });

  it('declines to guess when there is nothing to judge', () => {
    expect(bestThreshold(buckets([0.5, 0, 0], [0.9, 0, 0]))).toBeNull();
  });

  it('goes wide open when every pair really does belong together', () => {
    expect(bestThreshold(buckets([0.5, 8, 0], [0.9, 9, 0]))).toBe(0.5);
  });
});

describe('what a cutoff would do', () => {
  const b = [
    { from: 0.6, same: 2, other: 30 },
    { from: 0.8, same: 25, other: 3 },
    { from: 0.9, same: 40, other: 1 },
  ];

  it('counts what is shown, what is right, and what is lost', () => {
    expect(summarise(b, 0.8)).toEqual({ shown: 69, correct: 65, missed: 2, percent: 94 });
  });

  it('counts the good matches a strict cutoff throws away', () => {
    expect(summarise(b, 0.95)).toMatchObject({ shown: 0, missed: 67, percent: null });
  });

  it('reports null rather than 0% when nothing would ever match', () => {
    // 0% reads as "always wrong"; nothing shown is a different statement.
    expect(summarise(b, 1).percent).toBeNull();
  });
});

describe('the pairs the line decides', () => {
  const pairs = [0.95, 0.88, 0.81, 0.77, 0.71, 0.64].map((score, i) => ({
    a: `a${i}`,
    b: `b${i}`,
    score,
    sameBin: true,
  }));

  it('picks the ones straddling the cutoff, best first', () => {
    expect(pairsNear(pairs, 0.79, 4).map((p) => p.score)).toEqual([0.88, 0.81, 0.77, 0.71]);
  });

  it('still fills the strip when the cutoff sits past everything', () => {
    expect(pairsNear(pairs, 0.99, 2).map((p) => p.score)).toEqual([0.95, 0.88]);
  });

  it('never returns more than asked for', () => {
    expect(pairsNear(pairs, FLOOR, 3)).toHaveLength(3);
  });
});
