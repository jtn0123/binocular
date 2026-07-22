import { z } from 'zod';

/** AI vision response contract — blueprint §6.1, changes need a blueprint: commit. */
export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

export const ItemCategory = z.enum([
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
]);
export type ItemCategory = z.infer<typeof ItemCategory>;

export const DetectedItem = z.object({
  name: z.string().min(1),
  brand: z.string().nullable(),
  category: ItemCategory,
  quantity: z.number().int().min(1),
  label_text: z.string().nullable(),
  confidence: Confidence,
});
export type DetectedItem = z.infer<typeof DetectedItem>;

export const RecognitionResult = z.object({
  items: z.array(DetectedItem),
  scene_notes: z.string().nullable(),
});
export type RecognitionResult = z.infer<typeof RecognitionResult>;
