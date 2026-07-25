import { normalisePhotoUri } from '../photos';

/**
 * The exact string from the field report, which killed every capture:
 * expo-file-system handed back a uri with four slashes, expo-image rendered
 * it happily, and expo-image-manipulator could not load it at all.
 */
const BROKEN = 'file:////data/user/0/com.anonymous.binocular/files/photos/8609882d.jpg';
const FIXED = 'file:///data/user/0/com.anonymous.binocular/files/photos/8609882d.jpg';

describe('repairing a photo uri', () => {
  it('fixes the four-slash uri recognition choked on', () => {
    expect(normalisePhotoUri(BROKEN)).toBe(FIXED);
  });

  it('leaves a correct uri exactly as it is', () => {
    expect(normalisePhotoUri(FIXED)).toBe(FIXED);
  });

  it('collapses however many slashes turn up', () => {
    expect(normalisePhotoUri('file://////data/x.jpg')).toBe('file:///data/x.jpg');
  });

  it('keeps the two-slash form valid rather than mangling it', () => {
    // `file://` + `/data` is already the canonical three; nothing to do.
    expect(normalisePhotoUri('file://data/x.jpg')).toBe('file:///data/x.jpg');
  });

  it('does not touch slashes anywhere but the scheme', () => {
    // A doubled slash mid-path is a different bug and not this one's to fix;
    // silently rewriting the path could point at the wrong file.
    expect(normalisePhotoUri('file:///data//photos/x.jpg')).toBe('file:///data//photos/x.jpg');
  });

  it('leaves a bare path alone', () => {
    // No scheme, nothing to normalise — and prepending one would be a guess.
    expect(normalisePhotoUri('/data/user/0/x.jpg')).toBe('/data/user/0/x.jpg');
  });

  it('will not touch a scheme that has an authority', () => {
    // These put a host between the slashes and the path. Collapsing them
    // would move the authority into the path and repoint the uri at
    // something else entirely — so only `file:` is ever rewritten.
    expect(normalisePhotoUri('content://media/external/images/1')).toBe(
      'content://media/external/images/1',
    );
    expect(normalisePhotoUri('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
  });
});
