import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';

import type { DbAdapter } from '../db/adapter';
import { dumpAll, parseBackupDump, restoreAll, type BackupDump } from '../db/backupQueries';
import { nowIso } from '../lib/time';

import { inventoryCsv } from './csv';

/**
 * Backup & restore (blueprint Stage 6): a zip holding the full JSON dump
 * plus every referenced photo, shared through the system share sheet.
 * Import only ever restores into an empty database.
 */
function basename(uri: string): string {
  return uri.split('/').pop() ?? uri;
}

function collectPhotoUris(dump: BackupDump): string[] {
  const uris = new Set<string>();
  for (const bin of dump.bins) if (bin.cover_photo_uri) uris.add(bin.cover_photo_uri);
  for (const item of dump.items) if (item.photo_uri) uris.add(item.photo_uri);
  for (const scan of dump.scans) if (scan.photo_uri) uris.add(scan.photo_uri);
  return [...uris];
}

export async function exportBackupZip(db: DbAdapter): Promise<void> {
  const dump = dumpAll(db, nowIso());
  const zip = new JSZip();
  zip.file('binocular.json', JSON.stringify(dump, null, 2));

  for (const uri of collectPhotoUris(dump)) {
    try {
      const file = new File(uri);
      if (file.exists) zip.file(`photos/${basename(uri)}`, file.bytes());
    } catch {
      // A missing photo never blocks the backup of the data itself.
    }
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const stamp = nowIso().slice(0, 10);
  const out = new File(Paths.cache, `binocular-backup-${stamp}.zip`);
  if (out.exists) out.delete();
  out.write(bytes);
  await Sharing.shareAsync(out.uri, { mimeType: 'application/zip' });
}

export async function exportInventoryCsv(db: DbAdapter): Promise<void> {
  const csv = inventoryCsv(db);
  const out = new File(Paths.cache, 'binocular-inventory.csv');
  if (out.exists) out.delete();
  out.write(csv);
  await Sharing.shareAsync(out.uri, { mimeType: 'text/csv' });
}

export interface ImportSummary {
  bins: number;
  items: number;
  photos: number;
}

/** Restores a backup zip (picked by the user) into an empty database. */
export async function importBackupZip(db: DbAdapter, zipUri: string): Promise<ImportSummary> {
  const zip = await JSZip.loadAsync(new File(zipUri).bytes());
  const manifest = zip.file('binocular.json');
  if (!manifest) throw new Error('Not a Binocular backup — binocular.json is missing.');
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await manifest.async('string'));
  } catch {
    throw new Error('This backup is damaged — binocular.json is not valid JSON.');
  }
  // Trust boundary (D9): full zod validation before anything touches the db.
  const dump = parseBackupDump(manifestJson);

  const photosDir = new Directory(Paths.document, 'photos');
  if (!photosDir.exists) photosDir.create({ intermediates: true });

  let photos = 0;
  const restoredNames = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith('photos/')) continue;
    const name = basename(entry.name);
    const dest = new File(photosDir, name);
    if (dest.exists) dest.delete();
    dest.write(await entry.async('uint8array'));
    restoredNames.add(name);
    photos += 1;
  }

  restoreAll(db, dump, (uri) => {
    if (!uri) return uri;
    const name = basename(uri);
    return restoredNames.has(name) ? new File(photosDir, name).uri : null;
  });

  return { bins: dump.bins.length, items: dump.items.length, photos };
}
