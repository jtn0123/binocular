import type { ItemRow } from '../../db/queries';
import { FALLBACK_TAG } from '../../db/tags';
import type { RecognitionResult } from '../../vision/types';
import { buildDetectedChips, identifiedSomething } from '../ReviewScreen';

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

/**
 * §6.3.4 — the scan-level rule. The on-device engine is capped at `medium`
 * (§5), so before this existed its every pass arrived as a list of generic
 * labels pre-selected for saving.
 */
describe('a scan that identified nothing (§6.3.4)', () => {
  const HIGH = { name: 'Makita 18V drill', category: 'power_tool', confidence: 'high' } as const;

  it('recognises a scan that saw something specific', () => {
    expect(identifiedSomething(result([HIGH, { confidence: 'low' }]))).toBe(true);
  });

  it('recognises one that did not, however many guesses it made', () => {
    expect(
      identifiedSomething(
        result([
          { name: 'Drill', confidence: 'medium' },
          { name: 'Metal', confidence: 'medium' },
          { name: 'Tool', confidence: 'medium' },
        ]),
      ),
    ).toBe(false);
  });

  it('treats an empty result as identifying nothing', () => {
    expect(identifiedSomething(result([]))).toBe(false);
  });

  it('pre-selects nothing when the scan identified nothing', () => {
    const chips = buildDetectedChips(
      result([
        { name: 'Drill', confidence: 'medium' },
        { name: 'Metal', confidence: 'medium' },
      ]),
      [],
      KNOWN,
    );
    expect(chips.map((c) => c.selected)).toEqual([false, false]);
  });

  it('still pre-selects medium chips once anything was identified', () => {
    // The per-chip table is unchanged for scans that actually recognised
    // something — one `high` vouches for the rest being worth a glance.
    const chips = buildDetectedChips(
      result([HIGH, { name: 'Drill bit', confidence: 'medium' }, { confidence: 'low' }]),
      [],
      KNOWN,
    );
    expect(chips.map((c) => c.selected)).toEqual([true, true, false]);
  });

  it('keeps an already-catalogued item selected even on a scan that saw nothing', () => {
    // Unchecking a matched chip means deleting a real item, so a bad scan
    // must not quietly stage every existing item for removal.
    const existing = [{ id: 'i1', name: 'wire nuts' } as ItemRow];
    const chips = buildDetectedChips(
      result([
        { name: 'Wire nuts', confidence: 'medium' },
        { name: 'Metal', confidence: 'medium' },
      ]),
      existing,
      KNOWN,
    );
    expect(chips[0]).toMatchObject({ matchedExistingId: 'i1', selected: true });
    expect(chips[1]).toMatchObject({ matchedExistingId: null, selected: false });
  });
});
