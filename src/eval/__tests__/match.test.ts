import { detectionMatches, normalizeTokens, scoreCase } from '../match';

describe('eval matcher (dogfood #2 — scoring is mechanical, never model-graded)', () => {
  it('normalizes case, punctuation, and simple plurals', () => {
    expect(normalizeTokens('Wire-Nuts!')).toEqual(['wire', 'nut']);
    expect(normalizeTokens('GRK R4 #9 x 2-1/2 in')).toEqual(['grk', 'r4', '9', 'x', '2', '1', '2', 'in']);
    // short words keep their s (avoid "gas" -> "ga")
    expect(normalizeTokens('gas')).toEqual(['gas']);
  });

  it('matches when an alias token-covers the detection (either direction)', () => {
    const expected = { name: 'wire nuts', aliases: ['wire connectors', 'twist-on connectors'] };
    expect(detectionMatches('Wire nut', expected)).toBe(true);
    expect(detectionMatches('orange wire connectors', expected)).toBe(true);
    expect(detectionMatches('twist-on connector', expected)).toBe(true);
    expect(detectionMatches('needle-nose pliers', expected)).toBe(false);
    expect(detectionMatches('nuts', expected)).toBe(false); // "nuts" alone ≠ "wire nuts"
  });

  const CASE = {
    id: 'test',
    photo: 'x.jpg',
    binName: 'Bin',
    expected: [
      { name: 'wrenches', aliases: ['spanner'] },
      { name: 'spirit level', aliases: ['level'] },
      { name: 'cable ties' },
    ],
  };

  function result(names: string[]) {
    return {
      items: names.map((name) => ({
        name,
        brand: null,
        category: 'other' as const,
        quantity: 1,
        label_text: null,
        confidence: 'high' as const,
      })),
      scene_notes: null,
    };
  }

  it('scores recall and precision mechanically', () => {
    const score = scoreCase(CASE, result(['Combination wrench', 'Level', 'Rubber duck']));
    expect(score.matchedExpected).toEqual(['wrenches', 'spirit level']);
    expect(score.unmatchedDetected).toEqual(['Rubber duck']);
    expect(score.missedExpected).toEqual(['cable ties']);
    expect(score.recall).toBeCloseTo(2 / 3, 5);
    expect(score.precision).toBeCloseTo(2 / 3, 5);
  });

  it('empty detections: recall 0, precision vacuously 1', () => {
    const score = scoreCase(CASE, result([]));
    expect(score.recall).toBe(0);
    expect(score.precision).toBe(1);
  });

  it('wrench alias matches through the plural normalizer', () => {
    const score = scoreCase(CASE, result(['wrench']));
    expect(score.matchedExpected).toContain('wrenches');
  });
});
