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
});
