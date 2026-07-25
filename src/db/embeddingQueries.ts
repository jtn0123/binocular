import { bytesToVector, vectorToBytes, type Candidate } from '../vision/similarity';
import { nowIso } from '../lib/time';

import type { DbAdapter } from './adapter';

/**
 * Storage for visual memory (blueprint D20, migration 009).
 *
 * Rows are keyed by item and stamped with the encoder that produced them, so
 * changing models is a delete-and-backfill rather than a migration. Reads
 * always filter by the *current* model: a vector from a different encoder is
 * not comparable, and silently mixing them would produce confident nonsense.
 */

export interface StoredEmbedding {
  itemId: string;
  vector: Float32Array;
  model: string;
}

export function putEmbedding(
  db: DbAdapter,
  itemId: string,
  vector: Float32Array,
  model: string,
): void {
  db.runSync(
    `INSERT INTO item_embeddings (item_id, vector, dims, model, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       vector = excluded.vector,
       dims = excluded.dims,
       model = excluded.model,
       created_at = excluded.created_at`,
    [itemId, vectorToBytes(vector), vector.length, model, nowIso()],
  );
}

/**
 * Every comparable vector, ready for `nearest`.
 *
 * A row whose blob does not match its recorded dimensions is skipped rather
 * than repaired: it will be recomputed by the next backfill pass, and a
 * half-read vector is worse than a missing one.
 */
export function listCandidates(db: DbAdapter, model: string): Candidate[] {
  const rows = db.getAllSync<{ item_id: string; vector: Uint8Array; dims: number }>(
    'SELECT item_id, vector, dims FROM item_embeddings WHERE model = ?',
    [model],
  );
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const vector = bytesToVector(new Uint8Array(row.vector), row.dims);
    if (vector) candidates.push({ itemId: row.item_id, vector });
  }
  return candidates;
}

export function getEmbedding(db: DbAdapter, itemId: string, model: string): Float32Array | null {
  const row = db.getFirstSync<{ vector: Uint8Array; dims: number }>(
    'SELECT vector, dims FROM item_embeddings WHERE item_id = ? AND model = ?',
    [itemId, model],
  );
  return row ? bytesToVector(new Uint8Array(row.vector), row.dims) : null;
}

/**
 * The best image available for an item (D20).
 *
 * Its own photo when it has one — but scanning never gives an item its own
 * photo. §8.1 stamps the capture onto the *bin* cover and leaves every
 * detected item with `photo_uri` NULL, so a workshop catalogued entirely by
 * scanning reported "Remembering 0 of 0" and visual memory sat waiting on
 * something that was never going to arrive.
 *
 * `items.source_scan_id` is the way out: the photo the item was recognised
 * *from* is the honest second choice, and it already exists for every item
 * ever scanned — so the memory fills in retroactively, with no re-shooting.
 *
 * Deliberately NOT written back to `items.photo_uri`. A shot of a whole bin
 * is not a photo *of* the socket, and pretending otherwise would put a bin
 * picture on the item row and in the storage report. Visual memory just uses
 * the best pixels on hand; the data model stays honest.
 *
 * NULLIF is load-bearing: pruning a 30-day-old scan sets `photo_uri = ''`
 * rather than NULL (the column is NOT NULL), and an empty string is not null.
 * Without it a pruned scan yields an item with an empty uri that can never
 * encode — and, being permanently on the work list, gets retried on every
 * backfill pass forever.
 */
const BEST_PHOTO = "COALESCE(NULLIF(items.photo_uri, ''), NULLIF(scans.photo_uri, ''))";

/**
 * Items that have an image but no vector from this encoder — the backfill
 * work list. Ordered newest first: what you catalogued today is what you are
 * most likely to photograph again this afternoon.
 */
export function listItemsNeedingEmbedding(
  db: DbAdapter,
  model: string,
  limit = 10,
): { id: string; photo_uri: string }[] {
  return db.getAllSync<{ id: string; photo_uri: string }>(
    `SELECT items.id AS id, ${BEST_PHOTO} AS photo_uri
     FROM items
     LEFT JOIN scans ON scans.id = items.source_scan_id
     LEFT JOIN item_embeddings
       ON item_embeddings.item_id = items.id AND item_embeddings.model = ?
     WHERE ${BEST_PHOTO} IS NOT NULL AND item_embeddings.item_id IS NULL
     ORDER BY items.created_at DESC
     LIMIT ?`,
    [model, limit],
  );
}

export interface EmbeddedItem {
  id: string;
  name: string;
  bin_id: string | null;
  bin_code: string | null;
  photo_uri: string | null;
}

/**
 * Name, bin and picture for everything currently remembered — what the
 * calibration screen needs to render a pair as two photos and two names
 * rather than two row ids. Same photo fallback as the work list.
 */
export function listEmbeddedItems(db: DbAdapter, model: string): EmbeddedItem[] {
  return db.getAllSync<EmbeddedItem>(
    `SELECT items.id          AS id,
            items.name        AS name,
            items.bin_id      AS bin_id,
            bins.short_code   AS bin_code,
            ${BEST_PHOTO}     AS photo_uri
     FROM item_embeddings
     JOIN items ON items.id = item_embeddings.item_id
     LEFT JOIN bins ON bins.id = items.bin_id
     LEFT JOIN scans ON scans.id = items.source_scan_id
     WHERE item_embeddings.model = ?`,
    [model],
  );
}

export function countEmbeddings(db: DbAdapter, model: string): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM item_embeddings WHERE model = ?',
    [model],
  );
  return row?.n ?? 0;
}

/**
 * Items visual memory could remember — the denominator for "N of M".
 *
 * Must use the same fallback as the work list, or the two disagree and
 * Settings settles on something like "12 of 0", which reads as broken.
 */
export function countItemsWithPhotos(db: DbAdapter): number {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM items
     LEFT JOIN scans ON scans.id = items.source_scan_id
     WHERE ${BEST_PHOTO} IS NOT NULL`,
  );
  return row?.n ?? 0;
}

/** Drops every vector — used when switching encoders or clearing the feature. */
export function clearEmbeddings(db: DbAdapter): void {
  db.runSync('DELETE FROM item_embeddings');
}
