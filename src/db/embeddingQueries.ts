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
 * Items that have a photo but no vector from this encoder — the backfill
 * work list. Ordered newest first: what you catalogued today is what you are
 * most likely to photograph again this afternoon.
 */
export function listItemsNeedingEmbedding(
  db: DbAdapter,
  model: string,
  limit = 10,
): { id: string; photo_uri: string }[] {
  return db.getAllSync<{ id: string; photo_uri: string }>(
    `SELECT items.id AS id, items.photo_uri AS photo_uri
     FROM items
     LEFT JOIN item_embeddings
       ON item_embeddings.item_id = items.id AND item_embeddings.model = ?
     WHERE items.photo_uri IS NOT NULL AND item_embeddings.item_id IS NULL
     ORDER BY items.created_at DESC
     LIMIT ?`,
    [model, limit],
  );
}

export function countEmbeddings(db: DbAdapter, model: string): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM item_embeddings WHERE model = ?',
    [model],
  );
  return row?.n ?? 0;
}

/** Items with a photo at all — the denominator for "N of M remembered". */
export function countItemsWithPhotos(db: DbAdapter): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM items WHERE photo_uri IS NOT NULL',
  );
  return row?.n ?? 0;
}

/** Drops every vector — used when switching encoders or clearing the feature. */
export function clearEmbeddings(db: DbAdapter): void {
  db.runSync('DELETE FROM item_embeddings');
}
