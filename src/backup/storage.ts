import { Directory, File, Paths } from 'expo-file-system';

import type { DbAdapter } from '../db/adapter';

import { basename } from './backup';

/**
 * What the app is costing the phone, and what can safely be reclaimed.
 *
 * Round 6 put a photo on every item, on top of every scan photo and every
 * bin cover, so a field test that runs for a few weekends will fill a phone
 * quietly. Blueprint Q3 assumed re-encodes rather than originals; either way
 * the number has to be visible before it becomes a problem.
 *
 * "Reclaimable" means orphaned: a file in the photo store that no row points
 * at any more. Referenced photos are never candidates — including the ones
 * held by `deleted_items`, which are inside D17's 30-day restore window and
 * would otherwise come back as a restored item with a missing picture.
 */
export interface StoredPhoto {
  name: string;
  size: number;
}

export interface StorageReport {
  files: number;
  bytes: number;
  orphanFiles: number;
  orphanBytes: number;
}

/** Every photo filename the database still points at. */
export function referencedPhotoNames(db: DbAdapter): Set<string> {
  const names = new Set<string>();
  const add = (uri: string | null) => {
    if (uri) names.add(basename(uri));
  };
  for (const row of db.getAllSync<{ uri: string | null }>(
    'SELECT cover_photo_uri AS uri FROM bins WHERE cover_photo_uri IS NOT NULL',
  )) {
    add(row.uri);
  }
  for (const row of db.getAllSync<{ uri: string | null }>(
    'SELECT photo_uri AS uri FROM items WHERE photo_uri IS NOT NULL',
  )) {
    add(row.uri);
  }
  for (const row of db.getAllSync<{ uri: string | null }>(
    "SELECT photo_uri AS uri FROM scans WHERE photo_uri IS NOT NULL AND photo_uri != ''",
  )) {
    add(row.uri);
  }
  // D17 safety net: a deleted item is restorable for 30 days, and it should
  // come back with its photo.
  for (const row of db.getAllSync<{ uri: string | null }>(
    'SELECT photo_uri AS uri FROM deleted_items WHERE photo_uri IS NOT NULL',
  )) {
    add(row.uri);
  }
  return names;
}

export function orphans(
  photos: readonly StoredPhoto[],
  referenced: ReadonlySet<string>,
): StoredPhoto[] {
  return photos.filter((photo) => !referenced.has(photo.name));
}

export function summarizeStorage(
  photos: readonly StoredPhoto[],
  referenced: ReadonlySet<string>,
): StorageReport {
  const loose = orphans(photos, referenced);
  return {
    files: photos.length,
    bytes: photos.reduce((sum, photo) => sum + photo.size, 0),
    orphanFiles: loose.length,
    orphanBytes: loose.reduce((sum, photo) => sum + photo.size, 0),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Lists the photo store; a missing or unreadable directory reads as empty. */
export function listStoredPhotos(): StoredPhoto[] {
  try {
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) return [];
    const photos: StoredPhoto[] = [];
    for (const entry of dir.list()) {
      if (entry instanceof File) photos.push({ name: basename(entry.uri), size: entry.size ?? 0 });
    }
    return photos;
  } catch {
    return [];
  }
}

export function readStorageReport(db: DbAdapter): StorageReport {
  return summarizeStorage(listStoredPhotos(), referencedPhotoNames(db));
}

/** Deletes only unreferenced files; returns how many bytes came back. */
export function reclaimOrphanPhotos(db: DbAdapter): { files: number; bytes: number } {
  const referenced = referencedPhotoNames(db);
  const loose = orphans(listStoredPhotos(), referenced);
  const dir = new Directory(Paths.document, 'photos');
  let files = 0;
  let bytes = 0;
  for (const photo of loose) {
    try {
      const file = new File(dir, photo.name);
      if (file.exists) {
        file.delete();
        files += 1;
        bytes += photo.size;
      }
    } catch {
      // A file that refuses to delete is not worth failing the whole sweep.
    }
  }
  return { files, bytes };
}
