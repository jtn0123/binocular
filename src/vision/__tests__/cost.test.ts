import {
  claudeImageTokens,
  costForUsage,
  estimateScanCost,
  formatUsd,
  openAiImageTokens,
  priceForModel,
} from '../cost';

describe('cost estimation (blueprint D15)', () => {
  describe('openAiImageTokens — 32px patch math', () => {
    it('our 1568px upload costs ~1.8k tokens', () => {
      // ceil(1568/32)=49, ceil(1176/32)=37 -> 1813
      expect(openAiImageTokens(1568, 1176, 'high')).toBe(1813);
    });

    it('a raw 20MP phone photo on auto/original detail is ~10x the upload', () => {
      // 5472x3648: ceil(5472/32)=171, ceil(3648/32)=114 -> 19,494 patches
      const raw = openAiImageTokens(5472, 3648, 'original');
      expect(raw).toBe(19_494);
      expect(raw / openAiImageTokens(1568, 1176, 'high')).toBeGreaterThan(10);
      // `auto` behaves like `original` on gpt-5.6 — same no-resize count.
      expect(openAiImageTokens(5472, 3648, 'auto')).toBe(raw);
    });

    it('high detail is capped by the patch budget, low is a fixed thumbnail', () => {
      expect(openAiImageTokens(5472, 3648, 'high')).toBe(2500);
      expect(openAiImageTokens(5472, 3648, 'low')).toBe(256);
      expect(openAiImageTokens(100, 100, 'low')).toBe(256);
    });

    it('rounds partial patches up', () => {
      expect(openAiImageTokens(33, 33, 'high')).toBe(4);
      expect(openAiImageTokens(32, 32, 'high')).toBe(1);
    });
  });

  describe('claudeImageTokens — px^2/750 with 1568 auto-resize', () => {
    it('our 1568px upload costs ~2.5k tokens', () => {
      expect(claudeImageTokens(1568, 1176)).toBe(Math.ceil((1568 * 1176) / 750)); // 2459
    });

    it('oversized images are priced at the server-resized dimensions', () => {
      const resized = claudeImageTokens(1568, 1045); // 5472x3648 scaled to 1568 long edge
      const raw = claudeImageTokens(5472, 3648);
      expect(Math.abs(raw - resized)).toBeLessThanOrEqual(2); // rounding only
      expect(raw).toBeLessThan(2200);
    });
  });

  describe('measured cost from usage (never estimated)', () => {
    it('prices OpenAI usage by model row', () => {
      const usd = costForUsage('openai', {
        inputTokens: 2000,
        outputTokens: 500,
        model: 'gpt-5.6',
      });
      // 2000*$5/M + 500*$30/M = $0.01 + $0.015
      expect(usd).toBeCloseTo(0.025, 6);
    });

    it('prices Claude usage and falls back to the default model row', () => {
      const usd = costForUsage('claude', { inputTokens: 3000, outputTokens: 700 });
      // 3000*$5/M + 700*$25/M = $0.015 + $0.0175
      expect(usd).toBeCloseTo(0.0325, 6);
      expect(costForUsage('claude', { inputTokens: 3000, outputTokens: 700, model: 'unknown' })).toBe(
        usd,
      );
    });

    it('knows the cheaper gpt-5.6 tiers', () => {
      expect(priceForModel('openai', 'gpt-5.6-luna')?.inputPerMTok).toBe(1);
      expect(priceForModel('openai', 'gpt-5.6-terra')?.inputPerMTok).toBe(2.5);
    });
  });

  describe('estimateScanCost — pre-scan UI estimate', () => {
    it('a typical cloud scan is single-digit cents on both engines', () => {
      const openai = estimateScanCost('openai');
      const claude = estimateScanCost('claude');
      expect(openai.imageTokens).toBe(1813);
      expect(claude.imageTokens).toBe(2459);
      expect(openai.usd).toBeGreaterThan(0.005);
      expect(openai.usd).toBeLessThan(0.06);
      expect(claude.usd).toBeGreaterThan(0.005);
      expect(claude.usd).toBeLessThan(0.06);
    });
  });

  describe('formatUsd', () => {
    it.each([
      [0, '0¢'],
      [0.0004, '<0.1¢'],
      [0.005, '0.5¢'],
      [0.033, '3.3¢'],
      [0.45, '45¢'],
      [1.234, '$1.23'],
    ])('%f -> %s', (usd, label) => {
      expect(formatUsd(usd)).toBe(label);
    });
  });
});
