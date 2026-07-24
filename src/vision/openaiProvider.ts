import { recognitionJsonSchema } from './jsonSchema';
import { buildVisionPrompt } from './prompt';
import { VisionError, type ScanContext, type VisionProvider } from './provider';
import { RecognitionResult } from './types';

/**
 * The ONLY file that knows the OpenAI API (blueprint §3 hard boundary,
 * D14). Implemented with raw fetch against the Responses API — no SDK
 * dependency. Same §6.2 prompt, same §6.1 schema (enforced server-side
 * via strict structured outputs), same parse + one-repair-retry rule.
 */
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const VISION_MODEL = 'gpt-5.6';
const MAX_OUTPUT_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 60_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Minimal slice of the /v1/responses response body the provider reads. */
interface ResponsesApiBody {
  status?: string;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  output?: {
    type: string;
    content?: { type: string; text?: string }[];
  }[];
}

/** Extracts the text payload and runs it through the §6.1 trust boundary. */
export function parseOpenAiRecognitionText(text: string): RecognitionResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new VisionError('Model response was not valid JSON', 'invalid_response');
  }
  const parsed = RecognitionResult.safeParse(json);
  if (!parsed.success) {
    throw new VisionError(
      `Model response failed validation: ${parsed.error.message}`,
      'invalid_response',
    );
  }
  return parsed.data;
}

/** Pulls the assistant text out of a /v1/responses body, or throws. */
export function extractOpenAiOutputText(body: ResponsesApiBody): string {
  if (body.error) {
    throw new VisionError(
      `OpenAI error: ${body.error.message ?? body.error.code ?? 'unknown'}`,
      'invalid_response',
    );
  }
  const message = body.output?.find((item) => item.type === 'message');
  const refusal = message?.content?.find((c) => c.type === 'refusal');
  if (refusal) {
    throw new VisionError('The model declined to analyze this photo', 'invalid_response');
  }
  const text = (message?.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');
  if (!text) throw new VisionError('Model returned no text content', 'invalid_response');
  return text;
}

function errorFromStatus(status: number, detail: string): VisionError {
  if (status === 401 || status === 403) {
    return new VisionError('OpenAI API key was rejected — check Settings', 'auth');
  }
  if (status === 429) return new VisionError('Rate limited by the OpenAI API', 'rate_limit');
  if (status >= 500) return new VisionError(`OpenAI service error (${status})`, 'network');
  return new VisionError(`OpenAI request rejected (${status}): ${detail}`, 'invalid_response');
}

export function buildOpenAiRequestBody(
  photosBase64: string[],
  promptText: string,
  tags: readonly string[],
): object {
  return {
    model: VISION_MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: [
      {
        role: 'user',
        content: [
          ...photosBase64.map((data) => ({
            type: 'input_image',
            image_url: `data:image/jpeg;base64,${data}`,
            // Pinned cost ceiling (D15): on gpt-5.6, `auto` = `original`,
            // which skips downscaling — an unresized 20MP photo would be
            // ~10x the tokens. `high` keeps the documented patch budget.
            detail: 'high',
          })),
          { type: 'input_text', text: promptText },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'recognition_result',
        schema: recognitionJsonSchema(tags),
        strict: true,
      },
    },
  };
}

async function postResponses(
  fetchFn: FetchLike,
  apiKey: string,
  body: object,
): Promise<ResponsesApiBody> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetchFn(`${OPENAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    throw new VisionError(
      `Network error reaching OpenAI: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw errorFromStatus(res.status, detail.slice(0, 300));
  }
  return (await res.json()) as ResponsesApiBody;
}

export function createOpenAiProvider(
  getApiKey: () => Promise<string | null>,
  fetchFn: FetchLike = fetch,
): VisionProvider {
  async function requestText(
    apiKey: string,
    photosBase64: string[],
    promptText: string,
    tags: readonly string[],
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const body = buildOpenAiRequestBody(photosBase64, promptText, tags);
    const responseBody = await postResponses(fetchFn, apiKey, body);
    return {
      text: extractOpenAiOutputText(responseBody),
      inputTokens: responseBody.usage?.input_tokens ?? 0,
      outputTokens: responseBody.usage?.output_tokens ?? 0,
    };
  }

  return {
    async recognize(photosBase64, ctx: ScanContext) {
      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new VisionError('No OpenAI API key configured — add one in Settings', 'auth');
      }
      const prompt = buildVisionPrompt(ctx);
      // Usage accumulates across the repair retry — the scan's true spend (D15).
      let inputTokens = 0;
      let outputTokens = 0;
      const usage = () => ({ inputTokens, outputTokens, model: VISION_MODEL });
      const first = await requestText(apiKey, photosBase64, prompt, ctx.tags);
      inputTokens += first.inputTokens;
      outputTokens += first.outputTokens;
      try {
        return { result: parseOpenAiRecognitionText(first.text), usage: usage() };
      } catch (firstFailure) {
        if (!(firstFailure instanceof VisionError) || firstFailure.kind !== 'invalid_response') {
          throw firstFailure;
        }
        // One repair retry with the validation errors appended (§6.1).
        const repaired = await requestText(
          apiKey,
          photosBase64,
          `${prompt}\n\nYour previous response was invalid: ${firstFailure.message}\n` +
            'Respond again with ONLY a corrected JSON object.',
          ctx.tags,
        );
        inputTokens += repaired.inputTokens;
        outputTokens += repaired.outputTokens;
        return { result: parseOpenAiRecognitionText(repaired.text), usage: usage() };
      }
    },
  };
}

/** Settings "test connection": cheap authenticated call, no tokens spent. */
export async function testOpenAiConnection(
  apiKey: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn(`${OPENAI_BASE_URL}/models/${VISION_MODEL}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new VisionError(
      `Network error reaching OpenAI: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw errorFromStatus(res.status, detail.slice(0, 300));
  }
}
