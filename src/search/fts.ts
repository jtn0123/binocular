import type { DbAdapter } from '../db/adapter';
import type { BinRow, ItemCategory } from '../db/queries';

import { correctQuery } from './fuzzy';

/**
 * FTS5 search helpers (blueprint §8.3): prefix matching ("scre" finds
 * screwdrivers), name hits ranked above label_text hits via bm25 column
 * weights, and every result carries its bin → shelf → location breadcrumb.
 * Fully offline; must return in <100ms on 1,000 items.
 */
export interface SearchResult {
  itemId: string;
  name: string;
  brand: string | null;
  category: ItemCategory;
  quantity: number;
  labelText: string | null;
  checkedOutTo: string | null;
  binId: string | null;
  binCode: string | null;
  binName: string | null;
  binCoverUri: string | null;
  shelfName: string | null;
  locationName: string | null;
}

/**
 * Turns free text into an FTS5 prefix query: each token quoted (so
 * user punctuation can't break the query grammar) with a * suffix.
 * Returns null when nothing searchable remains.
 */
export function tokenize(raw: string): string[] {
  return raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function toFtsQuery(raw: string): string | null {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

/**
 * Bin lookup by code or name (dogfood find: typing "B-002" into Home found
 * nothing because FTS only indexes items). Plain LIKE with the user's
 * wildcards escaped — "%" in a query is text, not an operator.
 */
export function searchBins(db: DbAdapter, rawQuery: string, limit = 6): BinRow[] {
  const q = rawQuery.trim();
  if (!q) return [];
  const like = `%${q.replace(/([\\%_])/g, '\\$1')}%`;
  return db.getAllSync<BinRow>(
    `SELECT * FROM bins
     WHERE short_code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
     ORDER BY short_code
     LIMIT ?`,
    [like, like, limit],
  );
}

export function searchItems(db: DbAdapter, rawQuery: string, limit = 50): SearchResult[] {
  const match = toFtsQuery(rawQuery);
  if (!match) return [];
  return db.getAllSync<SearchResult>(
    `SELECT
       items.id            AS itemId,
       items.name          AS name,
       items.brand         AS brand,
       items.category      AS category,
       items.quantity      AS quantity,
       items.label_text    AS labelText,
       items.checked_out_to AS checkedOutTo,
       bins.id             AS binId,
       bins.short_code     AS binCode,
       bins.name           AS binName,
       bins.cover_photo_uri AS binCoverUri,
       shelves.name        AS shelfName,
       locations.name      AS locationName
     FROM item_search
     JOIN items ON items.rowid = item_search.rowid
     LEFT JOIN bins ON bins.id = items.bin_id
     LEFT JOIN shelves ON shelves.id = bins.shelf_id
     LEFT JOIN locations ON locations.id = shelves.location_id
     WHERE item_search MATCH ?
     -- name, brand, label_text, notes, category. A tag hit ("fastener")
     -- outranks a note but never a name.
     ORDER BY bm25(item_search, 10.0, 5.0, 2.0, 1.0, 3.0)
     LIMIT ?`,
    [match, limit],
  );
}

export interface SearchOutcome {
  results: SearchResult[];
  /**
   * The spelling actually searched, when what was typed matched nothing and
   * a near-miss in the index did. Null on an ordinary search — the UI only
   * says "showing results for…" when it really did substitute something.
   */
  corrected: string | null;
}

/**
 * Search, then — only if that found nothing — retry against the closest
 * spellings present in the index (src/search/fuzzy.ts). The fallback never
 * runs on a query that already matched, so the <100ms AC stands.
 */
export function searchItemsWithFallback(
  db: DbAdapter,
  rawQuery: string,
  limit = 50,
): SearchOutcome {
  const results = searchItems(db, rawQuery, limit);
  if (results.length > 0) return { results, corrected: null };

  const corrected = correctQuery(db, tokenize(rawQuery));
  if (!corrected) return { results, corrected: null };

  const retried = searchItems(db, corrected, limit);
  return retried.length > 0 ? { results: retried, corrected } : { results: [], corrected: null };
}

export interface PlaceHit {
  kind: 'location' | 'shelf';
  id: string;
  name: string;
  /** The location a shelf sits in; null for a location itself. */
  parentName: string | null;
}

/**
 * Shelf and location lookup by name (field-test finding: typing "workbench"
 * found nothing, because search only ever covered items and bins — the two
 * levels of the tree you navigate by were invisible to it).
 *
 * Same plain-LIKE approach as searchBins, wildcards escaped so "%" typed by
 * the user is text rather than an operator.
 */
export function searchPlaces(db: DbAdapter, rawQuery: string, limit = 6): PlaceHit[] {
  const q = rawQuery.trim();
  if (!q) return [];
  const like = `%${q.replace(/([\\%_])/g, '\\$1')}%`;
  const locations = db.getAllSync<{ id: string; name: string }>(
    `SELECT id, name FROM locations
     WHERE name LIKE ? ESCAPE '\\'
     ORDER BY name
     LIMIT ?`,
    [like, limit],
  );
  const shelves = db.getAllSync<{ id: string; name: string; parentName: string }>(
    `SELECT shelves.id AS id, shelves.name AS name, locations.name AS parentName
     FROM shelves
     JOIN locations ON locations.id = shelves.location_id
     WHERE shelves.name LIKE ? ESCAPE '\\'
     ORDER BY locations.name, shelves.name
     LIMIT ?`,
    [like, limit],
  );
  return [
    ...locations.map((l) => ({ kind: 'location' as const, ...l, parentName: null })),
    ...shelves.map((s) => ({ kind: 'shelf' as const, ...s })),
  ].slice(0, limit);
}
