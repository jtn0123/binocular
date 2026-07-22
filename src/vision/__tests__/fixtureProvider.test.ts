import { createFixtureProvider } from '../fixtureProvider';
import { RecognitionResult } from '../types';

describe('fixtureProvider', () => {
  const provider = createFixtureProvider({ delayMs: 0 });

  it.each(['bin_audit', 'check_in', 'find_it'] as const)(
    'returns a schema-valid result for %s',
    async (mode) => {
      const result = await provider.recognize(['fake-base64'], { mode });
      expect(RecognitionResult.safeParse(result).success).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    },
  );

  it('includes a low-confidence item in bin_audit (exercises the review default)', async () => {
    const result = await provider.recognize(['fake-base64'], { mode: 'bin_audit' });
    expect(result.items.some((i) => i.confidence === 'low')).toBe(true);
  });
});
