import type { ItemRow } from '../../db/queries';
import { FALLBACK_TAG } from '../../db/tags';
import type { RecognitionResult } from '../../vision/types';
import { buildDetectedChips } from '../ReviewScreen';

const KNOWN = new Set(['hand_tool', 'electrical', 'fastener', FALLBACK_TAG]);

function result(items: Partial<RecognitionResult['items'][number]>[]): RecognitionResult {
  return {
    items: items.map((item) => ({
      name: 'Thing',
      brand: null,
      category: FALLBACK_TAG,
      quantity: 1,
      label_text: null,
      confidence: 'medium' as const,
      ...item,
    })),
    scene_notes: null,
  };
}

describe('turning a recognition result into review chips', () => {
  it('keeps a tag the vocabulary recognises', () => {
    const chips = buildDetectedChips(result([{ category: 'electrical' }]), [], KNOWN);
    expect(chips[0].category).toBe('electrical');
  });

  it('falls back when the tag is gone from the vocabulary (D19)', () => {
    const chips = buildDetectedChips(result([{ category: 'marine' }]), [], KNOWN);
    expect(chips[0].category).toBe(FALLBACK_TAG);
  });

  it('asks history when the tag lands on the fallback', () => {
    // The on-device engine returns `other` routinely, which is exactly where
    // this workshop's own naming habits are worth more than the model.
    const chips = buildDetectedChips(
      result([{ name: 'Wire nuts', category: FALLBACK_TAG }]),
      [],
      KNOWN,
      (name) => (name.toLowerCase().includes('wire') ? 'electrical' : null),
    );
    expect(chips[0].category).toBe('electrical');
  });

  it('does not override a tag the engine got right', () => {
    const suggest = jest.fn(() => 'fastener');
    const chips = buildDetectedChips(
      result([{ name: 'Wire nuts', category: 'electrical' }]),
      [],
      KNOWN,
      suggest,
    );
    expect(chips[0].category).toBe('electrical');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('stays on the fallback when history has nothing to say', () => {
    const chips = buildDetectedChips(result([{ name: 'Kayak paddle' }]), [], KNOWN, () => null);
    expect(chips[0].category).toBe(FALLBACK_TAG);
  });

  it('still matches existing items and applies the §6.3 selection rule', () => {
    const existing = [{ id: 'i1', name: 'wire nuts' } as ItemRow];
    const chips = buildDetectedChips(
      result([
        { name: 'Wire nuts', category: 'electrical', confidence: 'low' },
        { name: 'Unseen thing', category: 'electrical', confidence: 'low' },
      ]),
      existing,
      KNOWN,
    );
    // A chip matching something already in the bin defaults to keep...
    expect(chips[0]).toMatchObject({ matchedExistingId: 'i1', selected: true });
    // ...while a new low-confidence chip still requires an explicit tap.
    expect(chips[1]).toMatchObject({ matchedExistingId: null, selected: false });
  });
});
