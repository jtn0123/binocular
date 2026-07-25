import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Photo pipeline (blueprint §6.4): originals live in app storage; the
 * upload variant is capped at 1568px on the long edge, JPEG ~q80 —
 * beyond that resolution the model gains nothing.
 */
const MAX_LONG_EDGE = 1568;
const UPLOAD_QUALITY = 0.8;

function photosDir(): Directory {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Collapses a run of slashes after the scheme down to one path root.
 *
 * Field report: recognition died on every capture with
 *
 *   Could not load the image: file:////data/user/0/…/photos/<id>.jpg
 *   → java.lang.Exception: Loading bitmap failed
 *
 * Four slashes. A local file URI is `file://` plus an absolute path, so
 * exactly three. expo-image is forgiving and renders it anyway — which is
 * why photos looked fine everywhere and only recognition broke — but
 * expo-image-manipulator hands the string to Android, which cannot resolve
 * `//data`. The malformed uri comes out of expo-file-system's native side
 * and gets stored, so it is repaired on the way in *and* on the way out:
 * new captures are written clean, and rows already saved still work.
 *
 * Deliberately `file:` only. Every other scheme puts an *authority* between
 * the slashes and the path — `content://media/1`, `https://example.com/x` —
 * so collapsing those would silently repoint the uri at something else. A
 * local file is the one case where the authority is empty by convention.
 */
export function normalisePhotoUri(uri: string): string {
  return uri.replace(/^file:\/{2,}/, 'file:///');
}

/** Copies a temporary camera capture into permanent app storage. */
export function persistPhoto(tempUri: string, scanId: string): string {
  const dest = new File(photosDir(), `${scanId}.jpg`);
  new File(normalisePhotoUri(tempUri)).copy(dest);
  return normalisePhotoUri(dest.uri);
}

/** Renders the resized/compressed base64 JPEG the provider uploads. */
export async function makeUploadBase64(rawUri: string): Promise<string> {
  const photoUri = normalisePhotoUri(rawUri);
  const probe = await ImageManipulator.manipulate(photoUri).renderAsync();
  const context = ImageManipulator.manipulate(photoUri);
  if (Math.max(probe.width, probe.height) > MAX_LONG_EDGE) {
    context.resize(
      probe.width >= probe.height ? { width: MAX_LONG_EDGE } : { height: MAX_LONG_EDGE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: UPLOAD_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  probe.release();
  image.release();
  if (!saved.base64) throw new Error('Image encoding produced no base64 payload');
  return saved.base64;
}
