/**
 * Cost transparency (blueprint D15). Two distinct jobs, never conflated:
 *
 *  - ESTIMATES (pre-scan UI): documented tokenizer math + a bundled price
 *    table. Clearly approximate.
 *  - MEASURED COST (post-scan): computed from the API's `usage` field —
 *    the same honesty rule as D5: we price what the API metered, we never
 *    invent token counts after the fact.
 *
 * Pure module: no provider imports, no SDKs, safe everywhere.
 */

export type CloudEngine = 'claude' | 'openai';

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Prices researched 2026-07; re-verify on key day (see docs/POLISH.md). */
export const PRICES_AS_OF = '2026-07';

const OPENAI_PRICES: Record<string, ModelPrice> = {
  'gpt-5.6': { inputPerMTok: 5, outputPerMTok: 30 },
  'gpt-5.6-sol': { inputPerMTok: 5, outputPerMTok: 30 },
  'gpt-5.6-terra': { inputPerMTok: 2.5, outputPerMTok: 15 },
  'gpt-5.6-luna': { inputPerMTok: 1, outputPerMTok: 6 },
  'gpt-5.5': { inputPerMTok: 5, outputPerMTok: 30 },
};

const CLAUDE_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
};

const DEFAULT_MODEL: Record<CloudEngine, string> = {
  openai: 'gpt-5.6',
  claude: 'claude-opus-4-8',
};

export function priceForModel(engine: CloudEngine, model?: string): ModelPrice | null {
  const table = engine === 'openai' ? OPENAI_PRICES : CLAUDE_PRICES;
  return table[model ?? DEFAULT_MODEL[engine]] ?? table[DEFAULT_MODEL[engine]] ?? null;
}

// ------------------------------------------------------------ image tokens

export type OpenAiDetail = 'low' | 'high' | 'auto' | 'original';

/**
 * gpt-5.x patch budget for `detail: high` (documented as e.g. 2,500 for
 * gpt-5.5; oversized images are scaled down to fit the budget). This cap is
 * exactly why our provider pins `high`: on gpt-5.6, `auto` behaves like
 * `original` and skips downscaling entirely.
 */
const OPENAI_HIGH_DETAIL_PATCH_BUDGET = 2500;
const OPENAI_PATCH_PX = 32;
const OPENAI_LOW_DETAIL_PX = 512;

/** OpenAI image input tokens: 32px-square patches over the image. */
export function openAiImageTokens(
  width: number,
  height: number,
  detail: OpenAiDetail = 'high',
): number {
  if (detail === 'low') {
    const side = Math.ceil(OPENAI_LOW_DETAIL_PX / OPENAI_PATCH_PX);
    return side * side;
  }
  const patches = Math.ceil(width / OPENAI_PATCH_PX) * Math.ceil(height / OPENAI_PATCH_PX);
  return detail === 'high' ? Math.min(patches, OPENAI_HIGH_DETAIL_PATCH_BUDGET) : patches;
}

/** Anthropic auto-resizes past 1568px long edge, then ≈ (w × h) / 750. */
const CLAUDE_MAX_LONG_EDGE = 1568;
const CLAUDE_PX_PER_TOKEN = 750;

export function claudeImageTokens(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  const scale = longEdge > CLAUDE_MAX_LONG_EDGE ? CLAUDE_MAX_LONG_EDGE / longEdge : 1;
  return Math.ceil((width * scale * (height * scale)) / CLAUDE_PX_PER_TOKEN);
}

// -------------------------------------------------------------- estimates

/** Upload pipeline cap is 1568px long edge; a 4:3 capture lands here. */
export const TYPICAL_UPLOAD = { width: 1568, height: 1176 } as const;

/** §6.2 prompt + hints, rough token count. */
const PROMPT_TOKENS_ESTIMATE = 550;
/** Typical items-array JSON reply. */
const OUTPUT_TOKENS_ESTIMATE = 700;

export interface ScanCostEstimate {
  imageTokens: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/** Pre-scan estimate for one photo at the given dimensions. */
export function estimateScanCost(
  engine: CloudEngine,
  width: number = TYPICAL_UPLOAD.width,
  height: number = TYPICAL_UPLOAD.height,
): ScanCostEstimate {
  const imageTokens =
    engine === 'openai' ? openAiImageTokens(width, height, 'high') : claudeImageTokens(width, height);
  const inputTokens = imageTokens + PROMPT_TOKENS_ESTIMATE;
  const outputTokens = OUTPUT_TOKENS_ESTIMATE;
  const price = priceForModel(engine);
  const usd = price
    ? (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
    : 0;
  return { imageTokens, inputTokens, outputTokens, usd };
}

// ---------------------------------------------------------- measured cost

export interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

/** Dollar cost of measured usage, or null when the model has no price row. */
export function costForUsage(engine: CloudEngine, usage: MeasuredUsage): number | null {
  const price = priceForModel(engine, usage.model);
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000
  );
}

// ------------------------------------------------------------- formatting

/** "<0.1¢", "1.6¢", "45¢", "$1.23" — cents below a dollar, honest below that. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '0¢';
  if (usd < 0.001) return '<0.1¢';
  if (usd < 0.1) return `${(usd * 100).toFixed(1)}¢`;
  if (usd < 1) return `${Math.round(usd * 100)}¢`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}
