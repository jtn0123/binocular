import {
  buildOpenAiRequestBody,
  createOpenAiProvider,
  extractOpenAiOutputText,
  testOpenAiConnection,
  type FetchLike,
} from '../openaiProvider';
import { VisionError } from '../provider';

/** D19: providers are handed the vocabulary; tests supply a small one. */
const TEST_TAGS = ['hand_tool', 'fastener', 'electrical', 'other'];

const VALID_RESULT = {
  items: [
    {
      name: 'Phillips screwdriver',
      brand: null,
      category: 'hand_tool',
      quantity: 1,
      label_text: null,
      confidence: 'high',
    },
  ],
  scene_notes: null,
};

function fakeResponse(init: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: async () => init.json,
    text: async () => init.text ?? '',
  } as unknown as Response;
}

function messageBody(text: string, usage?: { input_tokens: number; output_tokens: number }) {
  return {
    status: 'completed',
    usage,
    output: [
      { type: 'reasoning', content: [] },
      { type: 'message', content: [{ type: 'output_text', text }] },
    ],
  };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (e) {
    return e instanceof VisionError ? e.kind : `unexpected:${String(e)}`;
  }
}

describe('buildOpenAiRequestBody', () => {
  it('shapes a Responses API request with image, prompt, and strict schema', () => {
    const body = buildOpenAiRequestBody(['AAAA'], 'prompt text', TEST_TAGS) as Record<string, any>;
    expect(body.model).toBe('gpt-5.6');
    const content = body.input[0].content;
    expect(content[0]).toEqual({
      type: 'input_image',
      image_url: 'data:image/jpeg;base64,AAAA',
      // Pinned, not 'auto': on gpt-5.6 auto = original = no downscaling (D15).
      detail: 'high',
    });
    expect(content[1]).toEqual({ type: 'input_text', text: 'prompt text' });
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.properties.items).toBeDefined();
  });

  it('carries multiple photos in order before the prompt (D11 array contract)', () => {
    const body = buildOpenAiRequestBody(['one', 'two'], 'p', TEST_TAGS) as Record<string, any>;
    const types = body.input[0].content.map((c: { type: string }) => c.type);
    expect(types).toEqual(['input_image', 'input_image', 'input_text']);
  });
});

describe('extractOpenAiOutputText', () => {
  it('joins output_text from the message item, skipping reasoning items', () => {
    expect(extractOpenAiOutputText(messageBody('{"a":1}'))).toBe('{"a":1}');
  });

  it('throws invalid_response on refusal content', () => {
    const body = {
      output: [{ type: 'message', content: [{ type: 'refusal', text: 'no' }] }],
    };
    expect(() => extractOpenAiOutputText(body)).toThrow(VisionError);
  });

  it('throws invalid_response on an API error body or empty output', () => {
    expect(() => extractOpenAiOutputText({ error: { message: 'filtered' } })).toThrow(VisionError);
    expect(() => extractOpenAiOutputText({ output: [] })).toThrow(VisionError);
  });
});

describe('createOpenAiProvider', () => {
  const getKey = async () => 'sk-test';

  it('returns a validated RecognitionResult plus measured usage on success', async () => {
    const fetchFn: FetchLike = jest.fn(async () =>
      fakeResponse({
        ok: true,
        json: messageBody(JSON.stringify(VALID_RESULT), { input_tokens: 2100, output_tokens: 480 }),
      }),
    );
    const provider = createOpenAiProvider(getKey, fetchFn);
    const { result, usage } = await provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS });
    expect(result.items[0].name).toBe('Phillips screwdriver');
    expect(usage).toEqual({ inputTokens: 2100, outputTokens: 480, model: 'gpt-5.6' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });

  it('repairs once on an invalid first response and sums usage across both calls (§6.1, D15)', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(
        fakeResponse({
          ok: true,
          json: messageBody('not json at all', { input_tokens: 2000, output_tokens: 50 }),
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          ok: true,
          json: messageBody(JSON.stringify(VALID_RESULT), {
            input_tokens: 2200,
            output_tokens: 500,
          }),
        }),
      );
    const provider = createOpenAiProvider(getKey, fetchFn);
    const { result, usage } = await provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS });
    expect(result.items).toHaveLength(1);
    // The scan's true spend includes the failed first attempt.
    expect(usage).toEqual({ inputTokens: 4200, outputTokens: 550, model: 'gpt-5.6' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchFn.mock.calls[1][1].body as string);
    expect(retryBody.input[0].content.at(-1).text).toContain('previous response was invalid');
  });

  it('fails with invalid_response when the repair also fails — never best-efforts', async () => {
    const fetchFn: FetchLike = jest.fn(async () =>
      fakeResponse({ ok: true, json: messageBody('still bad') }),
    );
    const provider = createOpenAiProvider(getKey, fetchFn);
    await expect(kindOf(provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS }))).resolves.toBe(
      'invalid_response',
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('maps HTTP statuses to the VisionError taxonomy', async () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [403, 'auth'],
      [429, 'rate_limit'],
      [500, 'network'],
      [400, 'invalid_response'],
    ];
    for (const [status, kind] of cases) {
      const fetchFn: FetchLike = async () => fakeResponse({ ok: false, status, text: 'detail' });
      const provider = createOpenAiProvider(getKey, fetchFn);
      await expect(kindOf(provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS }))).resolves.toBe(kind);
    }
  });

  it('maps thrown fetch errors to network', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('offline');
    };
    const provider = createOpenAiProvider(getKey, fetchFn);
    await expect(kindOf(provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS }))).resolves.toBe(
      'network',
    );
  });

  it('throws auth immediately when no key is stored (no request made)', async () => {
    const fetchFn = jest.fn();
    const provider = createOpenAiProvider(async () => null, fetchFn as unknown as FetchLike);
    await expect(kindOf(provider.recognize(['img'], { mode: 'bin_audit', tags: TEST_TAGS }))).resolves.toBe('auth');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('testOpenAiConnection', () => {
  it('resolves on 200 and maps 401 to auth', async () => {
    await expect(
      testOpenAiConnection('sk-ok', async () => fakeResponse({ ok: true, json: {} })),
    ).resolves.toBeUndefined();
    await expect(
      kindOf(testOpenAiConnection('sk-bad', async () => fakeResponse({ ok: false, status: 401 }))),
    ).resolves.toBe('auth');
  });
});
