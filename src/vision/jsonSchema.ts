/**
 * JSON Schema mirror of the zod contract in types.ts (blueprint §6.1),
 * shared by both cloud engines (D14): Claude enforces it via structured
 * outputs, OpenAI via strict structured outputs. Both require
 * `additionalProperties: false` with every field required; nullables use
 * type arrays. zod remains the trust boundary regardless.
 *
 * The category enum is built from the caller's tag vocabulary (D19) rather
 * than hardcoded, so the schema the model is held to matches the tags that
 * actually exist. `other` is always included — it is the fallback the app
 * resolves to, so the model must be allowed to pick it even if a caller
 * somehow passes a list without it.
 */
export function recognitionJsonSchema(tags: readonly string[]) {
  const categories = tags.includes('other') ? [...tags] : [...tags, 'other'];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'scene_notes'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'brand', 'category', 'quantity', 'label_text', 'confidence'],
          properties: {
            name: { type: 'string' },
            brand: { type: ['string', 'null'] },
            category: { type: 'string', enum: categories },
            quantity: { type: 'integer' },
            label_text: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      scene_notes: { type: ['string', 'null'] },
    },
  } as const;
}
