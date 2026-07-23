import { encodeQrPayload, parseQrPayload } from '../payload';

describe('QR payload codec (blueprint §7, D13)', () => {
  it.each(['bin', 'shelf', 'location'] as const)('round-trips a %s payload', (type) => {
    const raw = encodeQrPayload({ type, id: 'abc-123' });
    expect(raw).toBe(`binoc:v1:${type}:abc-123`);
    expect(parseQrPayload(raw)).toEqual({ type, id: 'abc-123' });
  });

  it.each([
    ['a grocery barcode', '0123456789012'],
    ['a URL', 'https://example.com/whatever'],
    ['wrong prefix', 'other:v1:bin:abc'],
    ['wrong version', 'binoc:v2:bin:abc'],
    ['unknown type', 'binoc:v1:drawer:abc'],
    ['missing id', 'binoc:v1:bin:'],
    ['too few parts', 'binoc:v1:bin'],
    ['empty string', ''],
  ])('rejects %s', (_label, raw) => {
    expect(parseQrPayload(raw)).toBeNull();
  });

  it.each([
    ['extra parts (id smuggling a colon)', 'binoc:v1:bin:abc:def'],
    ['uppercase prefix', 'BINOC:v1:bin:abc'],
    ['uppercase type', 'binoc:v1:BIN:abc'],
    ['whitespace-only id', 'binoc:v1:bin:   '],
    ['single-space id', 'binoc:v1:bin: '],
    ['emoji type noise', 'binoc:v1:\u{1F527}:abc'],
    ['very long garbage', 'binoc:v1:bin:' + ':'.repeat(2000)],
  ])('fuzz: rejects %s', (_label, raw) => {
    expect(parseQrPayload(raw)).toBeNull();
  });

  it('tolerates scanner whitespace — padding and trailing newlines still parse', () => {
    expect(parseQrPayload(' binoc:v1:bin:abc ')).toEqual({ type: 'bin', id: 'abc' });
    expect(parseQrPayload('binoc:v1:shelf:abc\n')).toEqual({ type: 'shelf', id: 'abc' });
  });
});
