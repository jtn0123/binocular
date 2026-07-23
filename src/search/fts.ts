import type { DbAdapter } from '../db/adapter';
import type { BinRow, ItemCategory } from '../db/queries';

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
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
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
     ORDER BY bm25(item_search, 10.0, 5.0, 2.0, 1.0)
     LIMIT ?`,
    [match, limit],
  );
}
