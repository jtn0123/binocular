import { buildQrSvg, labelSheetHtml, type LabelSpec } from '../labels';

function makeLabels(n: number): LabelSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    payload: { type: 'bin' as const, id: `bin-${i}` },
    code: `B-${String(i + 1).padStart(3, '0')}`,
    name: `Bin ${i + 1}`,
  }));
}

describe('label sheet (blueprint §7, Avery 5163)', () => {
  it('renders a scannable-looking QR svg with a quiet zone', () => {
    const svg = buildQrSvg('binoc:v1:bin:test');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    expect(svg).toContain('fill="#000"');
    // deterministic for the same input
    expect(buildQrSvg('binoc:v1:bin:test')).toBe(svg);
    // different payloads yield different codes
    expect(buildQrSvg('binoc:v1:bin:other')).not.toBe(svg);
  });

  it('lays out 10 labels per page and breaks onto new pages', () => {
    const html = labelSheetHtml(makeLabels(23));
    expect(html.match(/class="page"/g)).toHaveLength(3);
    expect(html.match(/class="label"/g)).toHaveLength(23);
    expect(html.match(/<svg/g)).toHaveLength(23);
  });

  it('shows the human-readable short code next to every QR', () => {
    const html = labelSheetHtml(makeLabels(2));
    expect(html).toContain('B-001');
    expect(html).toContain('B-002');
  });

  it('escapes HTML in user-supplied names', () => {
    const html = labelSheetHtml([
      {
        payload: { type: 'bin', id: 'x' },
        code: 'B-001',
        name: 'Screws <5mm> & "misc"',
      },
    ]);
    expect(html).toContain('Screws &lt;5mm&gt; &amp; &quot;misc&quot;');
    expect(html).not.toContain('<5mm>');
  });
});
