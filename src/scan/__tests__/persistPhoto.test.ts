/**
 * Retaking a photo is the most repeated corrective action in the app, and it
 * could not succeed twice.
 *
 * Callers pass a *subject* key — `cover-<binId>`, `item-<itemId>` — and the
 * old implementation wrote `${key}.jpg`, so the second capture of any subject
 * aimed at a path that already existed. `File.copy` refuses that by default.
 * On the bin cover the raw "Destination already exists" reached the user; on
 * the item retake it was an unhandled rejection inside an async onPress and
 * nothing happened at all.
 *
 * The filesystem mock below reproduces exactly that refusal, so these tests
 * fail against the old implementation rather than merely describing the new
 * one.
 */
import { discardPhoto, persistPhoto } from '../photos';
const mockFiles = new Map<string, string>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;

    constructor(base: unknown, name?: string) {
      this.uri =
        name === undefined
          ? String(base)
          : `${(base as { uri: string }).uri}/${name}`;
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }

    copy(dest: MockFile): void {
      // The real expo-file-system default: no overwrite, and it throws.
      if (mockFiles.has(dest.uri)) throw new Error('Destination already exists');
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? 'jpeg-bytes');
    }

    delete(): void {
      mockFiles.delete(this.uri);
    }
  }

  class MockDirectory {
    uri: string;

    constructor(base: unknown, name: string) {
      this.uri = `${String(base)}/${name}`;
    }

    get exists(): boolean {
      return true;
    }

    create(): void {}
  }

  return { File: MockFile, Directory: MockDirectory, Paths: { document: 'file:///doc' } };
});

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));

const CAMERA = 'file:///cache/camera-shot.jpg';

describe('persisting a captured photo', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockFiles.set(CAMERA, 'jpeg-bytes');
  });

  it('stores the first capture of a subject', () => {
    const stored = persistPhoto(CAMERA, 'cover-bin-1');
    expect(stored.startsWith('file:///doc/photos/cover-bin-1-')).toBe(true);
    expect(mockFiles.has(stored)).toBe(true);
  });

  it('lets you retake the same subject — the bug', () => {
    const first = persistPhoto(CAMERA, 'cover-bin-1');
    // Second capture of the SAME bin. This threw before.
    const second = persistPhoto(CAMERA, 'cover-bin-1');

    expect(second).not.toBe(first);
    expect(mockFiles.has(second)).toBe(true);
  });

  it('retakes an item photo as many times as it takes', () => {
    const uris = [1, 2, 3, 4].map(() => persistPhoto(CAMERA, 'item-abc'));
    expect(new Set(uris).size).toBe(4);
  });

  it('gives a retake a new uri, so a cached bitmap cannot outlive it', () => {
    // expo-image renders these everywhere and caches on the uri, so rewriting
    // the bytes behind an unchanged path would "save" a photo that still
    // looks wrong.
    const first = persistPhoto(CAMERA, 'cover-bin-1');
    const second = persistPhoto(CAMERA, 'cover-bin-1', first);
    expect(second).not.toBe(first);
  });

  it('removes the photo it replaces', () => {
    const first = persistPhoto(CAMERA, 'cover-bin-1');
    const second = persistPhoto(CAMERA, 'cover-bin-1', first);

    expect(mockFiles.has(first)).toBe(false);
    expect(mockFiles.has(second)).toBe(true);
  });

  it('keeps the old photo when nothing is being replaced', () => {
    const first = persistPhoto(CAMERA, 'item-abc');
    const second = persistPhoto(CAMERA, 'item-abc');

    expect(mockFiles.has(first)).toBe(true);
    expect(mockFiles.has(second)).toBe(true);
  });

  it('normalises the four-slash uri on the way in', () => {
    mockFiles.set('file:///cache/x.jpg', 'jpeg-bytes');
    const stored = persistPhoto('file:////cache/x.jpg', 'item-abc');
    expect(mockFiles.get(stored)).toBe('jpeg-bytes');
  });

  it('never lets tidying up throw', () => {
    expect(() => discardPhoto('file:///doc/photos/not-there.jpg')).not.toThrow();
  });
});
