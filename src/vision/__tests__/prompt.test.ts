import { buildVisionPrompt } from '../prompt';

describe('buildVisionPrompt (blueprint §6.2)', () => {
  it('contains the load-bearing contract language', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit' });
    expect(prompt).toContain('inventory assistant for a home workshop');
    expect(prompt).toContain('Do not guess brands from color schemes');
    expect(prompt).toContain('Do not invent items to seem thorough');
    expect(prompt).toContain('Respond with ONLY a JSON object');
    // the rubric, verbatim categories
    expect(prompt).toContain('high:');
    expect(prompt).toContain('medium:');
    expect(prompt).toContain('low:');
    expect(prompt).toContain('bit_blade_accessory');
  });

  it('omits context lines when no hints are given', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit' });
    expect(prompt).not.toContain('this bin is labeled');
    expect(prompt).not.toContain('previously recorded');
  });

  it('interpolates the bin name hint', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', binName: 'Electrical connectors' });
    expect(prompt).toContain('Context: this bin is labeled "Electrical connectors".');
  });

  it('interpolates existing items for merge audits', () => {
    const prompt = buildVisionPrompt({
      mode: 'bin_audit',
      existingItems: ['Wire nuts', 'Spade terminals'],
    });
    expect(prompt).toContain('Wire nuts, Spade terminals');
    expect(prompt).toContain('may or may not still');
  });

  it('treats an empty existingItems array as no hint', () => {
    const prompt = buildVisionPrompt({ mode: 'bin_audit', existingItems: [] });
    expect(prompt).not.toContain('previously recorded');
  });
});
