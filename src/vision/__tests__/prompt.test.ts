import { buildVisionPrompt } from '../prompt';

/** D19: providers are handed the vocabulary; tests supply a small one. */
const TEST_TAGS = ['hand_tool', 'fastener', 'electrical', 'other'];

describe('buildVisionPrompt (blueprint §6.2)', () => {
  it('contains the load-bearing contract language', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', tags: TEST_TAGS });
    expect(prompt).toContain('inventory assistant for a home workshop');
    expect(prompt).toContain('Do not guess brands from color schemes');
    expect(prompt).toContain('Do not invent items to seem thorough');
    expect(prompt).toContain('Respond with ONLY a JSON object');
    // the rubric, verbatim categories
    expect(prompt).toContain('high:');
    expect(prompt).toContain('medium:');
    expect(prompt).toContain('low:');
  });

  it('lists the caller’s tag vocabulary, not a hardcoded one (D19)', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', tags: ['marine', 'rigging', 'other'] });
    expect(prompt).toContain('marine, rigging, other');
    // The old fixed list must not leak back in from anywhere.
    expect(prompt).not.toContain('bit_blade_accessory');
    // `other` is always the escape hatch, so the model is told to use it.
    expect(prompt).toContain('Use "other" when none of them fits');
  });

  it('omits context lines when no hints are given', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', tags: TEST_TAGS });
    expect(prompt).not.toContain('this bin is labeled');
    expect(prompt).not.toContain('previously recorded');
  });

  it('interpolates the bin name hint', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', tags: TEST_TAGS, binName: 'Electrical connectors' });
    expect(prompt).toContain('Context: this bin is labeled "Electrical connectors".');
  });

  it('interpolates existing items for merge audits', () => {
    const prompt = buildVisionPrompt({
      mode: 'bin_audit',
      tags: TEST_TAGS,
      existingItems: ['Wire nuts', 'Spade terminals'],
    });
    expect(prompt).toContain('Wire nuts, Spade terminals');
    expect(prompt).toContain('may or may not still');
  });

  it('treats an empty existingItems array as no hint', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', tags: TEST_TAGS, existingItems: [] });
    expect(prompt).not.toContain('previously recorded');
  });
});
