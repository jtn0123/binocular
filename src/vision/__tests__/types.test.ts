import { DetectedItem, RecognitionResult } from '../types';

const validItem = {
  name: 'Phillips screwdriver',
  brand: null,
  category: 'hand_tool',
  quantity: 3,
  label_text: null,
  confidence: 'high',
};

describe('RecognitionResult schema (blueprint §6.1)', () => {
  it('parses a valid response', () => {
    const parsed = RecognitionResult.safeParse({ items: [validItem], scene_notes: null });
    expect(parsed.success).toBe(true);
  });

  it('rejects malformed JSON shapes outright', () => {
    expect(RecognitionResult.safeParse({ items: 'nope', scene_notes: null }).success).toBe(false);
    expect(RecognitionResult.safeParse({}).success).toBe(false);
    expect(RecognitionResult.safeParse(null).success).toBe(false);
  });

  it('rejects numeric or percentage confidence — enum only (D5)', () => {
    expect(DetectedItem.safeParse({ ...validItem, confidence: 0.87 }).success).toBe(false);
    expect(DetectedItem.safeParse({ ...validItem, confidence: '87%' }).success).toBe(false);
  });

  it('rejects unknown categories and empty names', () => {
    expect(DetectedItem.safeParse({ ...validItem, category: 'kitchen' }).success).toBe(false);
    expect(DetectedItem.safeParse({ ...validItem, name: '' }).success).toBe(false);
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(DetectedItem.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
    expect(DetectedItem.safeParse({ ...validItem, quantity: 1.5 }).success).toBe(false);
  });
});
