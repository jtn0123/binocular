import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

import type { DbAdapter } from '../db/adapter';
import { getBin, setBinCoverPhoto } from '../db/queries';

/**
 * Dev-only: gives the seeded demo bins realistic cover photos (bundled
 * Wikimedia Commons images — see assets/demo/LICENSES.md) so screens have
 * real-looking content. No-ops for bins that already have a cover.
 */
const DEMO_COVERS: [string, number][] = [
  ['seed-bin-1', require('../../assets/demo/bin-electrical.jpg')],
  ['seed-bin-2', require('../../assets/demo/bin-fasteners.jpg')],
  ['seed-bin-3', require('../../assets/demo/bin-handtools.jpg')],
  ['seed-bin-4', require('../../assets/demo/bin-adhesives.jpg')],
];

export async function applyDemoCovers(db: DbAdapter): Promise<void> {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true });

  for (const [binId, moduleId] of DEMO_COVERS) {
    const bin = getBin(db, binId);
    if (!bin || bin.cover_photo_uri) continue;
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    if (!asset.localUri) continue;
    const dest = new File(dir, `demo-${binId}.jpg`);
    if (!dest.exists) new File(asset.localUri).copy(dest);
    setBinCoverPhoto(db, binId, dest.uri);
  }
}
