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

  it('rejects empty names', () => {
    expect(DetectedItem.safeParse({ ...validItem, name: '' }).success).toBe(false);
  });

  it('rejects a malformed tag slug — shape is still a contract (D19)', () => {
    for (const category of ['', 'Hand Tool', 'hand-tool', 'hand tool', 'a'.repeat(41), 'Ünicode']) {
      expect(DetectedItem.safeParse({ ...validItem, category }).success).toBe(false);
    }
  });

  it('accepts a well-formed tag it does not recognise (D19)', () => {
    // The vocabulary is the user's and changes underneath the model, so an
    // unknown-but-legal slug passes the schema and is resolved to `other`
    // later — failing a forty-item scan over it would be the wrong trade.
    expect(DetectedItem.safeParse({ ...validItem, category: 'marine' }).success).toBe(true);
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(DetectedItem.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
    expect(DetectedItem.safeParse({ ...validItem, quantity: 1.5 }).success).toBe(false);
  });
});
