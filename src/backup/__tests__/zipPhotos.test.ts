import JSZip from 'jszip';

/**
 * The export died on its own photos (field-test finding).
 *
 * `File.bytes()` returns a *promise*, and JSZip accepts promises — so passing
 * it meant no photo was read when it was added. The read was deferred to
 * `generateAsync`, by which point the File's native handle had been released,
 * and it failed with "Cannot use shared object that was already released".
 * Worse, it threw from `generateAsync` rather than from `addPhotosToZip`, so
 * it escaped the per-photo try/catch and took the whole export down.
 *
 * These mocks make that difference observable without a device: `bytes()`
 * rejects the way a released handle does, `bytesSync()` reads there and then.
 * Reading synchronously is therefore the assertion, not a style preference.
 */
// `mock`-prefixed so jest's module factory may reference it.
const mockReleased = 'Cannot use shared object that was already released';

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return !this.uri.includes('missing');
    }
    /** What the old code called: settles late, after the handle is gone. */
    bytes(): Promise<Uint8Array> {
      return Promise.reject(new Error(mockReleased));
    }
    bytesSync(): Uint8Array {
      return new Uint8Array([1, 2, 3, 4]);
    }
  },
  Directory: class {},
  Paths: { cache: '/cache', document: '/documents' },
}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

// Imported after the mocks so the module picks them up.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addPhotosToZip, basename } = require('../backup') as typeof import('../backup');

describe('adding photos to an export zip', () => {
  it('reads each photo immediately, so the zip can still be generated', async () => {
    const zip = new JSZip();
    const added = addPhotosToZip(zip, ['file:///photos/a.jpg', 'file:///photos/b.jpg']);
    expect(added).toBe(2);

    // The regression: with a deferred read this rejects with RELEASED.
    const out = await zip.generateAsync({ type: 'uint8array' });
    expect(out.byteLength).toBeGreaterThan(0);
  });

  it('puts each photo under photos/ by its basename', async () => {
    const zip = new JSZip();
    addPhotosToZip(zip, ['file:///photos/cover.jpg']);
    const entry = zip.file('photos/cover.jpg');
    expect(entry).not.toBeNull();
    await expect(entry!.async('uint8array')).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('skips a photo that is not there without failing the export', async () => {
    const zip = new JSZip();
    const added = addPhotosToZip(zip, ['file:///photos/missing.jpg', 'file:///photos/a.jpg']);
    expect(added).toBe(1);
    await expect(zip.generateAsync({ type: 'uint8array' })).resolves.toBeDefined();
  });

  it('names entries from the last path segment', () => {
    expect(basename('file:///a/b/c.jpg')).toBe('c.jpg');
    expect(basename('bare.jpg')).toBe('bare.jpg');
  });
});
