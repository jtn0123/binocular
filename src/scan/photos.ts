import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { newId } from '../lib/id';

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

/**
 * Copies a temporary camera capture into permanent app storage.
 *
 * The filename is unique per *capture*, not per subject. It used to be
 * `${key}.jpg`, and callers pass a subject key — `cover-<binId>`,
 * `item-<itemId>` — so retaking a photo aimed the second capture at a path
 * that already existed. `File.copy` refuses that: no `overwrite` option is
 * passed, and the default is false. On the bin cover it surfaced as the raw
 * "Destination already exists"; on the item retake it was an unhandled
 * rejection inside an async onPress, so the sheet simply went on showing the
 * old picture. Retaking a bad photo is the most repeated corrective action in
 * the app, and it could not succeed twice.
 *
 * A unique name rather than `overwrite: true` because the uri is also a cache
 * key: expo-image renders these everywhere, and rewriting the bytes behind an
 * unchanged path is how you get a photo that "saved" but still looks wrong.
 * Backups address photos by basename in both directions (backup.ts:46, :110)
 * and nothing derives a path from an id, so the name carries no meaning.
 *
 * Pass `replacing` with the superseded uri so the old file does not linger.
 */
export function persistPhoto(tempUri: string, key: string, replacing?: string | null): string {
  const dest = new File(photosDir(), `${key}-${newId()}.jpg`);
  new File(normalisePhotoUri(tempUri)).copy(dest);
  if (replacing) discardPhoto(replacing);
  return normalisePhotoUri(dest.uri);
}

/** Removes a stored photo. Best-effort — a file we cannot delete is clutter. */
export function discardPhoto(uri: string): void {
  try {
    const file = new File(normalisePhotoUri(uri));
    if (file.exists) file.delete();
  } catch {
    // Never let tidying up fail the thing the user actually asked for.
  }
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
