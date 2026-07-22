/**
 * JSON Schema mirror of the zod contract in types.ts (blueprint §6.1),
 * shared by both cloud engines (D14): Claude enforces it via structured
 * outputs, OpenAI via strict structured outputs. Both require
 * `additionalProperties: false` with every field required; nullables use
 * type arrays. zod remains the trust boundary regardless.
 */
export const RECOGNITION_JSON_SCHEMA = {
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
          category: {
            type: 'string',
            enum: [
              'hand_tool',
              'power_tool',
              'fastener',
              'electrical',
              'plumbing',
              'adhesive_finish',
              'safety',
              'measuring',
              'bit_blade_accessory',
              'hardware',
              'material',
              'other',
            ],
          },
          quantity: { type: 'integer' },
          label_text: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    scene_notes: { type: ['string', 'null'] },
  },
} as const;
