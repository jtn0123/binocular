import { createFixtureProvider } from '../fixtureProvider';
import { RecognitionResult } from '../types';

/** D19: providers are handed the vocabulary; tests supply a small one. */
const TEST_TAGS = ['hand_tool', 'fastener', 'electrical', 'other'];

describe('fixtureProvider', () => {
  const provider = createFixtureProvider({ delayMs: 0 });

  it.each(['bin_audit', 'check_in', 'find_it'] as const)(
    'returns a schema-valid result for %s',
    async (mode) => {
      const { result } = await provider.recognize(['fake-base64'], { mode, tags: TEST_TAGS });
      expect(RecognitionResult.safeParse(result).success).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    },
  );

  it('includes a low-confidence item in bin_audit (exercises the review default)', async () => {
    const { result } = await provider.recognize(['fake-base64'], { mode: 'bin_audit', tags: TEST_TAGS });
    expect(result.items.some((i) => i.confidence === 'low')).toBe(true);
  });

  it('reports no usage — nothing was metered (D15)', async () => {
    const outcome = await provider.recognize(['fake-base64'], { mode: 'find_it', tags: TEST_TAGS });
    expect(outcome.usage).toBeUndefined();
  });
});
