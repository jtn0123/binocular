import { z } from 'zod';

/** AI vision response contract — blueprint §6.1, changes need a blueprint: commit. */
export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

/**
 * A tag slug (D19). Only the **shape** is a contract the model can be held
 * to — the vocabulary itself is the user's and changes underneath it, so it
 * is resolved separately against the tags table (see §6.1 tag resolution and
 * src/db/tags.ts). A malformed slug still fails the whole response.
 */
export const TagSlug = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/);

/** The stored value on an item: a tag slug, not a member of a fixed set. */
export type ItemCategory = string;

export const DetectedItem = z.object({
  name: z.string().min(1),
  brand: z.string().nullable(),
  category: TagSlug,
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
