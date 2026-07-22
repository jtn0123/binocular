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

/** Copies a temporary camera capture into permanent app storage. */
export function persistPhoto(tempUri: string, scanId: string): string {
  const dest = new File(photosDir(), `${scanId}.jpg`);
  new File(tempUri).copy(dest);
  return dest.uri;
}

/** Renders the resized/compressed base64 JPEG the provider uploads. */
export async function makeUploadBase64(photoUri: string): Promise<string> {
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
