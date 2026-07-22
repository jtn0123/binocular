import { categoryForLabel, mapLabelsToResult, type MlKitLabel } from '../localProvider';
import { RecognitionResult } from '../types';

describe('local engine label mapping (D10 / Q4 capability contract)', () => {
  it('maps labels to the §6.1 schema with nulls for brand and label_text', () => {
    const result = mapLabelsToResult([
      { text: 'Screwdriver', confidence: 0.92 },
      { text: 'Tape measure', confidence: 0.55 },
    ]);
    expect(RecognitionResult.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.brand).toBeNull();
      expect(item.label_text).toBeNull();
      expect(item.quantity).toBe(1);
    }
  });

  it('caps confidence at medium — a generic labeler never claims high', () => {
    const result = mapLabelsToResult([
      { text: 'Hammer', confidence: 0.99 },
      { text: 'Wrench', confidence: 0.5 },
    ]);
    expect(result.items[0].confidence).toBe('medium');
    expect(result.items[1].confidence).toBe('low');
    expect(result.items.some((i) => (i.confidence as string) === 'high')).toBe(false);
  });

  it('drops weak labels, dedupes case-insensitively, and bounds the list', () => {
    const labels: MlKitLabel[] = [
      { text: 'Tool', confidence: 0.9 },
      { text: 'tool', confidence: 0.8 },
      { text: 'Noise', confidence: 0.2 },
      ...Array.from({ length: 20 }, (_, i) => ({ text: `Thing ${i}`, confidence: 0.7 })),
    ];
    const result = mapLabelsToResult(labels);
    expect(result.items.filter((i) => i.name.toLowerCase() === 'tool')).toHaveLength(1);
    expect(result.items.some((i) => i.name === 'Noise')).toBe(false);
    expect(result.items.length).toBeLessThanOrEqual(12);
  });

  it('explains itself in scene_notes, including the empty case', () => {
    expect(mapLabelsToResult([{ text: 'Saw', confidence: 0.8 }]).scene_notes).toMatch(/on-device/i);
    expect(mapLabelsToResult([]).scene_notes).toMatch(/found nothing/i);
  });

  it('categorizes generic labels sensibly', () => {
    expect(categoryForLabel('Screwdriver')).toBe('hand_tool');
    expect(categoryForLabel('Power drill')).toBe('power_tool');
    expect(categoryForLabel('Wood screw')).toBe('fastener');
    expect(categoryForLabel('Cable')).toBe('electrical');
    expect(categoryForLabel('Duct tape')).toBe('adhesive_finish');
    expect(categoryForLabel('Safety goggles')).toBe('safety');
    expect(categoryForLabel('Banana')).toBe('other');
  });
});
