import Anthropic from '@anthropic-ai/sdk';

import { RECOGNITION_JSON_SCHEMA } from './jsonSchema';
import { buildVisionPrompt } from './prompt';
import { VisionError, type ScanContext, type VisionProvider } from './provider';
import { RecognitionResult } from './types';

/**
 * The ONLY file that may import or reference the Anthropic API (blueprint
 * §3 hard boundary). Everything else talks to VisionProvider.
 */
const VISION_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 2048;

/** Extracts the text payload and runs it through the §6.1 trust boundary. */
export function parseRecognitionText(text: string): RecognitionResult {
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

function toVisionError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new VisionError('API key was rejected — check Settings', 'auth');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new VisionError('Rate limited by the API', 'rate_limit');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new VisionError(`Request rejected: ${err.message}`, 'invalid_response');
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIError) {
    return new VisionError(`Network or service error: ${(err as Error).message}`, 'network');
  }
  return new VisionError(`Unexpected error: ${String(err)}`, 'network');
}

function textFromResponse(msg: Anthropic.Message): string {
  if (msg.stop_reason === 'refusal') {
    throw new VisionError('The model declined to analyze this photo', 'invalid_response');
  }
  const text = msg.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text) throw new VisionError('Model returned no text content', 'invalid_response');
  return text;
}

export function createClaudeProvider(getApiKey: () => Promise<string | null>): VisionProvider {
  async function request(
    client: Anthropic,
    photosBase64: string[],
    promptText: string,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const msg = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        format: { type: 'json_schema', schema: RECOGNITION_JSON_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...photosBase64.map(
              (data): Anthropic.ImageBlockParam => ({
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data },
              }),
            ),
            { type: 'text', text: promptText },
          ],
        },
      ],
    });
    return {
      text: textFromResponse(msg),
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    };
  }

  return {
    async recognize(photosBase64, ctx: ScanContext) {
      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new VisionError('No API key configured — add one in Settings', 'auth');
      }
      const client = new Anthropic({
        apiKey,
        timeout: 60_000,
        dangerouslyAllowBrowser: true,
      });
      const prompt = buildVisionPrompt(ctx);
      // Usage accumulates across the repair retry — the scan's true spend (D15).
      let inputTokens = 0;
      let outputTokens = 0;
      const usage = () => ({ inputTokens, outputTokens, model: VISION_MODEL });
      try {
        const first = await request(client, photosBase64, prompt);
        inputTokens += first.inputTokens;
        outputTokens += first.outputTokens;
        try {
          return { result: parseRecognitionText(first.text), usage: usage() };
        } catch (firstFailure) {
          if (!(firstFailure instanceof VisionError) || firstFailure.kind !== 'invalid_response') {
            throw firstFailure;
          }
          // One repair retry with the validation errors appended (§6.1);
          // a second failure surfaces as invalid_response.
          const repaired = await request(
            client,
            photosBase64,
            `${prompt}\n\nYour previous response was invalid: ${firstFailure.message}\n` +
              'Respond again with ONLY a corrected JSON object.',
          );
          inputTokens += repaired.inputTokens;
          outputTokens += repaired.outputTokens;
          return { result: parseRecognitionText(repaired.text), usage: usage() };
        }
      } catch (err) {
        throw toVisionError(err);
      }
    },
  };
}

/** Settings "test connection": cheap authenticated call, no tokens spent. */
export async function testClaudeConnection(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, timeout: 20_000, dangerouslyAllowBrowser: true });
  try {
    await client.models.retrieve(VISION_MODEL);
  } catch (err) {
    throw toVisionError(err);
  }
}
