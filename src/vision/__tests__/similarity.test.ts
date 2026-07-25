import { bytesToVector, cosine, nearest, search, vectorToBytes } from '../similarity';

const v = (...values: number[]) => Float32Array.from(values);

describe('cosine similarity', () => {
  it('is 1 for the same direction and -1 for the opposite', () => {
    expect(cosine(v(1, 0), v(1, 0))).toBeCloseTo(1, 6);
    expect(cosine(v(1, 0), v(-1, 0))).toBeCloseTo(-1, 6);
  });

  it('ignores magnitude — only direction matters', () => {
    expect(cosine(v(1, 1), v(10, 10))).toBeCloseTo(1, 6);
  });

  it('is 0 for perpendicular vectors', () => {
    expect(cosine(v(1, 0), v(0, 1))).toBeCloseTo(0, 6);
  });

  it('never exceeds 1 despite floating-point drift', () => {
    const a = v(0.1, 0.2, 0.3, 0.4);
    expect(cosine(a, a)).toBeLessThanOrEqual(1);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it('returns 0 rather than throwing on unusable input', () => {
    // A corrupt stored row should cost one suggestion, not the screen.
    expect(cosine(v(), v())).toBe(0);
    expect(cosine(v(1, 0), v(1, 0, 0))).toBe(0);
    expect(cosine(v(0, 0), v(1, 1))).toBe(0);
  });
});

describe('nearest neighbours', () => {
  const candidates = [
    { itemId: 'socket', vector: v(1, 0, 0) },
    { itemId: 'spanner', vector: v(0.9, 0.1, 0) },
    { itemId: 'paint', vector: v(0, 1, 0) },
    { itemId: 'glue', vector: v(0, 0, 1) },
  ];

  it('ranks the closest first', () => {
    const hits = nearest(v(1, 0, 0), candidates, { k: 2 });
    expect(hits.map((h) => h.itemId)).toEqual(['socket', 'spanner']);
  });

  it('caps at k', () => {
    expect(nearest(v(1, 1, 1), candidates, { k: 2 })).toHaveLength(2);
  });

  it('returns nothing when nothing clears the threshold', () => {
    // D20's promise: an object unlike anything catalogued gets no
    // suggestions, rather than the least-bad match presented confidently.
    expect(nearest(v(0, 0, 1), candidates, { minScore: 0.9 }).map((h) => h.itemId)).toEqual([
      'glue',
    ]);
    expect(nearest(v(1, -1, 0), candidates, { minScore: 0.95 })).toEqual([]);
  });

  it('is stable when scores tie', () => {
    const tied = [
      { itemId: 'zeta', vector: v(1, 0) },
      { itemId: 'alpha', vector: v(1, 0) },
    ];
    expect(nearest(v(1, 0), tied, { k: 2 }).map((h) => h.itemId)).toEqual(['alpha', 'zeta']);
  });

  it('handles an empty memory', () => {
    expect(nearest(v(1, 0), [])).toEqual([]);
  });
});

describe('search: what was rejected', () => {
  const memory = [
    { itemId: 'near', vector: v(1, 0.4) },
    { itemId: 'far', vector: v(0, 1) },
  ];

  it('reports the best score even when nothing cleared the threshold', () => {
    const { matches, best } = search(v(1, 0), memory, { minScore: 0.99 });
    expect(matches).toEqual([]);
    // The whole point: "missed by a hair" is legible, not just "no match".
    expect(best).toBeCloseTo(0.928, 3);
  });

  it('reports the winner when there is one', () => {
    const { matches, best } = search(v(1, 0), memory, { minScore: 0.5 });
    expect(matches.map((m) => m.itemId)).toEqual(['near']);
    expect(best).toBeCloseTo(matches[0].score, 6);
  });

  it('has no best score when there was nothing to compare against', () => {
    expect(search(v(1, 0), [])).toEqual({ matches: [], best: null });
  });

  it('agrees with nearest, which is the same search minus the rejects', () => {
    expect(search(v(1, 0), memory, { minScore: 0.5 }).matches).toEqual(
      nearest(v(1, 0), memory, { minScore: 0.5 }),
    );
  });
});

describe('storage round trip', () => {
  it('survives bytes and back', () => {
    const original = v(0.5, -0.25, 1, 0);
    const restored = bytesToVector(vectorToBytes(original), original.length);
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(original));
  });

  it('refuses a blob that is not a whole number of floats', () => {
    expect(bytesToVector(new Uint8Array([1, 2, 3]), 1)).toBeNull();
  });

  it('refuses a blob whose length disagrees with the recorded dimensions', () => {
    // A truncated row must not become a silently wrong suggestion.
    const bytes = vectorToBytes(v(1, 2, 3, 4));
    expect(bytesToVector(bytes, 8)).toBeNull();
    expect(bytesToVector(bytes, 4)).not.toBeNull();
  });
});
