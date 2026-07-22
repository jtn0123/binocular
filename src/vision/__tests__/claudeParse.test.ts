import { parseRecognitionText } from '../claudeProvider';
import { VisionError } from '../provider';

const validPayload = JSON.stringify({
  items: [
    {
      name: 'Phillips screwdriver',
      brand: null,
      category: 'hand_tool',
      quantity: 2,
      label_text: null,
      confidence: 'high',
    },
  ],
  scene_notes: null,
});

describe('parseRecognitionText (§6.1 trust boundary)', () => {
  it('parses a schema-valid payload', () => {
    const result = parseRecognitionText(validPayload);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].confidence).toBe('high');
  });

  it('throws invalid_response on non-JSON text', () => {
    expect(() => parseRecognitionText('Sure! Here are the items…')).toThrow(VisionError);
    try {
      parseRecognitionText('nope');
    } catch (e) {
      expect((e as VisionError).kind).toBe('invalid_response');
    }
  });

  it('throws invalid_response on schema-invalid JSON — never best-efforts it', () => {
    const bad = JSON.stringify({ items: [{ name: 'x', confidence: '87%' }], scene_notes: null });
    expect(() => parseRecognitionText(bad)).toThrow(VisionError);
  });
});
