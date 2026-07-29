import { newId } from '../lib/id';
import { nowIso } from '../lib/time';

import type { DbAdapter, SqlParam } from './adapter';
import type { ItemCategory } from '../vision/types';

/** Row shapes mirror the schema in schema.ts (blueprint §4) verbatim. */
export interface LocationRow {
  id: string;
  name: string;
  created_at: string;
  /** D21 (v3 wall): position along the wall; ties broken by name. */
  sort_order: number;
}

export interface ShelfRow {
  id: string;
  location_id: string;
  name: string;
  created_at: string;
  /** D21: how many slots the shelf physically has; null = unsized. */
  capacity: number | null;
  /** D21 (v3 wall): position from the top of its rack down. */
  sort_order: number;
}

export interface BinRow {
  id: string;
  shelf_id: string | null;
  short_code: string;
  name: string;
  cover_photo_uri: string | null;
  last_scanned_at: string | null;
  created_at: string;
  /** D21: position within its shelf; ties broken by short_code. */
  sort_order: number;
}

/**
 * A tag slug (D19). The vocabulary lives in the `tags` table and is the
 * user's to change, so this is deliberately a string rather than a closed
 * union — re-exported from the vision contract so there is one definition.
 */
export type { ItemCategory };

export interface ItemRow {
  id: string;
  bin_id: string;
  name: string;
  brand: string | null;
  category: ItemCategory;
  quantity: number;
  label_text: string | null;
  photo_uri: string | null;
  notes: string | null;
  checked_out_to: string | null;
  low_stock_threshold: number | null;
  source_scan_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ScanMode = 'bin_audit' | 'check_in' | 'find_it';
export type ScanStatus = 'queued' | 'processing' | 'review' | 'confirmed' | 'discarded' | 'failed';

export interface ScanRow {
  id: string;
  bin_id: string | null;
  mode: ScanMode;
  photo_uri: string;
  status: ScanStatus;
  raw_response: string | null;
  error: string | null;
  created_at: string;
  resolved_at: string | null;
  /** D15: engine that processed the scan; null until recognition ran. */
  engine: string | null;
  /** D15: measured by the API's usage field — never estimated. */
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

// ---------------------------------------------------------------- locations

export function createLocation(db: DbAdapter, input: { name: string; id?: string }): LocationRow {
  const row: LocationRow = {
    id: input.id ?? newId(),
    name: input.name,
    created_at: nowIso(),
    // A new rack lands at the end of the wall, which is where you would have
    // stood it — not wherever its name happens to sort.
    sort_order: nextRank(db, 'SELECT MAX(sort_order) AS top FROM locations'),
  };
  db.runSync('INSERT INTO locations (id, name, created_at, sort_order) VALUES (?, ?, ?, ?)', [
    row.id,
    row.name,
    row.created_at,
    row.sort_order,
  ]);
  return row;
}

export function listLocations(db: DbAdapter): LocationRow[] {
  return db.getAllSync<LocationRow>('SELECT * FROM locations ORDER BY sort_order, name');
}

/**
 * Rewrites the wall's left-to-right order (D21 v3). Takes the whole list
 * rather than a from/to pair: the map hands over the arrangement it is
 * showing, so a reorder can never leave two racks claiming one position.
 * Ids that are not locations are ignored; locations that are missing from
 * the list keep their place after the ones that were named.
 */
export function reorderLocations(db: DbAdapter, orderedIds: readonly string[]): void {
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      db.runSync('UPDATE locations SET sort_order = ? WHERE id = ?', [index, id]);
    });
  });
}

/** Highest existing rank + 1, or 0 when there is nothing to sit after. */
function nextRank(db: DbAdapter, sql: string, params: SqlParam[] = []): number {
  const row = db.getFirstSync<{ top: number | null }>(sql, params);
  return row?.top === null || row?.top === undefined ? 0 : row.top + 1;
}

export function getLocation(db: DbAdapter, id: string): LocationRow | null {
  return db.getFirstSync<LocationRow>('SELECT * FROM locations WHERE id = ?', [id]);
}

export function renameLocation(db: DbAdapter, id: string, name: string): void {
  db.runSync('UPDATE locations SET name = ? WHERE id = ?', [name, id]);
}

/**
 * Deletes a location and its shelves. Bins are unassigned, never deleted
 * (blueprint Stage 2 orphan rule).
 */
export function deleteLocation(db: DbAdapter, id: string): void {
  db.withTransactionSync(() => {
    db.runSync(
      'UPDATE bins SET shelf_id = NULL WHERE shelf_id IN (SELECT id FROM shelves WHERE location_id = ?)',
      [id],
    );
    db.runSync('DELETE FROM shelves WHERE location_id = ?', [id]);
    db.runSync('DELETE FROM locations WHERE id = ?', [id]);
  });
}

// ------------------------------------------------------------------ shelves

export function createShelf(
  db: DbAdapter,
  input: { locationId: string; name: string; id?: string; capacity?: number | null },
): ShelfRow {
  const row: ShelfRow = {
    id: input.id ?? newId(),
    location_id: input.locationId,
    name: input.name,
    created_at: nowIso(),
    capacity: input.capacity ?? null,
    // A new shelf goes on the bottom of the rack, which is where a shelf
    // actually gets added to one.
    sort_order: nextRank(db, 'SELECT MAX(sort_order) AS top FROM shelves WHERE location_id = ?', [
      input.locationId,
    ]),
  };
  db.runSync(
    'INSERT INTO shelves (id, location_id, name, created_at, capacity, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [row.id, row.location_id, row.name, row.created_at, row.capacity, row.sort_order],
  );
  return row;
}

export function listShelves(db: DbAdapter, locationId: string): ShelfRow[] {
  return db.getAllSync<ShelfRow>(
    'SELECT * FROM shelves WHERE location_id = ? ORDER BY sort_order, name',
    [locationId],
  );
}

export function listAllShelves(db: DbAdapter): ShelfRow[] {
  return db.getAllSync<ShelfRow>('SELECT * FROM shelves ORDER BY sort_order, name');
}

/**
 * The COLUMNS stepper (v3 wall): a rack is uniform, so its shelves declare
 * one slot count between them. Never below what a shelf already holds —
 * shrinking a rack must not silently make a shelf read over-full, and the
 * bins are the fact the number describes.
 */
export function setRackCapacity(db: DbAdapter, locationId: string, capacity: number): void {
  db.withTransactionSync(() => {
    const shelves = db.getAllSync<{ id: string; filled: number }>(
      `SELECT s.id AS id, (SELECT COUNT(*) FROM bins b WHERE b.shelf_id = s.id) AS filled
         FROM shelves s WHERE s.location_id = ?`,
      [locationId],
    );
    for (const shelf of shelves) {
      db.runSync('UPDATE shelves SET capacity = ? WHERE id = ?', [
        Math.max(capacity, shelf.filled),
        shelf.id,
      ]);
    }
  });
}

export function getShelf(db: DbAdapter, id: string): ShelfRow | null {
  return db.getFirstSync<ShelfRow>('SELECT * FROM shelves WHERE id = ?', [id]);
}

export function renameShelf(db: DbAdapter, id: string, name: string): void {
  db.runSync('UPDATE shelves SET name = ? WHERE id = ?', [name, id]);
}

/** D21: declares how many slots a shelf has; null clears it back to unsized. */
export function setShelfCapacity(db: DbAdapter, id: string, capacity: number | null): void {
  db.runSync('UPDATE shelves SET capacity = ? WHERE id = ?', [capacity, id]);
}

/** Deletes a shelf; its bins become unassigned, never deleted. */
export function deleteShelf(db: DbAdapter, id: string): void {
  db.withTransactionSync(() => {
    db.runSync('UPDATE bins SET shelf_id = NULL WHERE shelf_id = ?', [id]);
    db.runSync('DELETE FROM shelves WHERE id = ?', [id]);
  });
}

// --------------------------------------------------------------------- bins

export function createBin(
  db: DbAdapter,
  input: { name: string; shortCode: string; shelfId?: string | null; id?: string },
): BinRow {
  const row: BinRow = {
    id: input.id ?? newId(),
    shelf_id: input.shelfId ?? null,
    short_code: input.shortCode,
    name: input.name,
    cover_photo_uri: null,
    last_scanned_at: null,
    created_at: nowIso(),
    sort_order: nextSortOrder(db, input.shelfId ?? null),
  };
  db.runSync(
    `INSERT INTO bins (id, shelf_id, short_code, name, cover_photo_uri, last_scanned_at, created_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.shelf_id,
      row.short_code,
      row.name,
      row.cover_photo_uri,
      row.last_scanned_at,
      row.created_at,
      row.sort_order,
    ],
  );
  return row;
}

/** D21: new and moved bins join the end of their shelf's stored order. */
function nextSortOrder(db: DbAdapter, shelfId: string | null): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM bins WHERE shelf_id IS ?',
    [shelfId],
  );
  return row?.n ?? 0;
}

export function getBin(db: DbAdapter, id: string): BinRow | null {
  return db.getFirstSync<BinRow>('SELECT * FROM bins WHERE id = ?', [id]);
}

export function listBins(db: DbAdapter): BinRow[] {
  return db.getAllSync<BinRow>('SELECT * FROM bins ORDER BY sort_order, short_code');
}

export function listBinsForShelf(db: DbAdapter, shelfId: string): BinRow[] {
  return db.getAllSync<BinRow>(
    'SELECT * FROM bins WHERE shelf_id = ? ORDER BY sort_order, short_code',
    [shelfId],
  );
}

export function listUnassignedBins(db: DbAdapter): BinRow[] {
  return db.getAllSync<BinRow>(
    'SELECT * FROM bins WHERE shelf_id IS NULL ORDER BY sort_order, short_code',
  );
}

/** Bins by most recent activity — Home screen's "recent bins". */
export function listRecentBins(db: DbAdapter, limit = 10): BinRow[] {
  return db.getAllSync<BinRow>(
    'SELECT * FROM bins ORDER BY COALESCE(last_scanned_at, created_at) DESC LIMIT ?',
    [limit],
  );
}

export function renameBin(db: DbAdapter, id: string, name: string): void {
  db.runSync('UPDATE bins SET name = ? WHERE id = ?', [name, id]);
}

/**
 * Move mode (blueprint §8.5): re-home a bin; null unassigns it. The bin
 * joins the end of the destination's stored order (D21).
 */
export function moveBinToShelf(db: DbAdapter, binId: string, shelfId: string | null): void {
  db.runSync('UPDATE bins SET shelf_id = ?, sort_order = ? WHERE id = ?', [
    shelfId,
    nextSortOrder(db, shelfId),
    binId,
  ]);
}

/**
 * D21: executes a drop planned on the map — one transaction that re-homes
 * the bin (when the drop crossed shelves) and writes the destination's
 * whole order. Only relative order within a shelf matters, so bins left
 * behind on the source shelf keep their values untouched.
 */
export function placeBin(
  db: DbAdapter,
  input: { binId: string; shelfId: string | null; orderedIds: readonly string[] },
): void {
  db.withTransactionSync(() => {
    db.runSync('UPDATE bins SET shelf_id = ? WHERE id = ?', [input.shelfId, input.binId]);
    input.orderedIds.forEach((id, index) => {
      db.runSync('UPDATE bins SET sort_order = ? WHERE id = ?', [index, id]);
    });
  });
}

/**
 * The same drop for a stack of bins (v3 wall): they land together, in the
 * order they were picked, as one transaction and therefore one undo.
 * Carrying them one at a time is the thing that makes re-shelving take all
 * afternoon, and a per-bin loop would leave a half-moved wall behind if it
 * failed in the middle.
 */
export function placeBins(
  db: DbAdapter,
  input: { binIds: readonly string[]; shelfId: string | null; orderedIds: readonly string[] },
): void {
  db.withTransactionSync(() => {
    for (const binId of input.binIds) {
      db.runSync('UPDATE bins SET shelf_id = ? WHERE id = ?', [input.shelfId, binId]);
    }
    input.orderedIds.forEach((id, index) => {
      db.runSync('UPDATE bins SET sort_order = ? WHERE id = ?', [index, id]);
    });
  });
}

export function countItemsForBin(db: DbAdapter, binId: string): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE bin_id = ?', [
    binId,
  ]);
  return row?.n ?? 0;
}

/**
 * How many items sit in every bin, in one query.
 *
 * The map needs a count for every cell it draws and redraws after every
 * mutation and every screen focus, so asking per bin is a few hundred queries
 * on the JS thread per redraw on a real wall. Bins with no items are absent
 * from the result rather than zero — callers default what they do not find.
 */
export function itemCountsByBin(db: DbAdapter): Map<string, number> {
  const rows = db.getAllSync<{ bin_id: string; n: number }>(
    'SELECT bin_id, COUNT(*) AS n FROM items WHERE bin_id IS NOT NULL GROUP BY bin_id',
  );
  return new Map(rows.map((r) => [r.bin_id, r.n]));
}

/** Refuses to delete a bin that still has items — inventory is never lost. */
export function deleteBinIfEmpty(db: DbAdapter, binId: string): boolean {
  if (countItemsForBin(db, binId) > 0) return false;
  db.withTransactionSync(() => {
    db.runSync('UPDATE scans SET bin_id = NULL WHERE bin_id = ?', [binId]);
    db.runSync('DELETE FROM bins WHERE id = ?', [binId]);
  });
  return true;
}

/** Next sequential short code: B-001, B-002, … (gaps are not reused). */
export function nextShortCode(db: DbAdapter): string {
  const rows = db.getAllSync<{ short_code: string }>('SELECT short_code FROM bins');
  let max = 0;
  for (const row of rows) {
    const match = /^B-(\d+)$/.exec(row.short_code);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `B-${String(max + 1).padStart(3, '0')}`;
}

/** Bulk creation (blueprint §7): N bins with sequential codes, one txn. */
export function createBinsBulk(
  db: DbAdapter,
  input: { count: number; shelfId?: string | null },
): BinRow[] {
  const created: BinRow[] = [];
  db.withTransactionSync(() => {
    for (let i = 0; i < input.count; i++) {
      const shortCode = nextShortCode(db);
      created.push(
        createBin(db, { name: `Bin ${shortCode}`, shortCode, shelfId: input.shelfId ?? null }),
      );
    }
  });
  return created;
}

/** User-set bin cover (also used by dev seeds); audits use updateBinAfterScan. */
export function setBinCoverPhoto(db: DbAdapter, binId: string, uri: string): void {
  db.runSync('UPDATE bins SET cover_photo_uri = ? WHERE id = ?', [uri, binId]);
}

export function updateBinAfterScan(
  db: DbAdapter,
  binId: string,
  input: { lastScannedAt: string; coverPhotoUri: string | null },
): void {
  db.runSync('UPDATE bins SET last_scanned_at = ?, cover_photo_uri = ? WHERE id = ?', [
    input.lastScannedAt,
    input.coverPhotoUri,
    binId,
  ]);
}

// -------------------------------------------------------------------- items

export interface NewItem {
  binId: string;
  name: string;
  category: ItemCategory;
  quantity?: number;
  brand?: string | null;
  labelText?: string | null;
  photoUri?: string | null;
  notes?: string | null;
  lowStockThreshold?: number | null;
  sourceScanId?: string | null;
  id?: string;
}

export function insertItem(db: DbAdapter, input: NewItem): ItemRow {
  const ts = nowIso();
  const row: ItemRow = {
    id: input.id ?? newId(),
    bin_id: input.binId,
    name: input.name,
    brand: input.brand ?? null,
    category: input.category,
    quantity: input.quantity ?? 1,
    label_text: input.labelText ?? null,
    photo_uri: input.photoUri ?? null,
    notes: input.notes ?? null,
    checked_out_to: null,
    low_stock_threshold: input.lowStockThreshold ?? null,
    source_scan_id: input.sourceScanId ?? null,
    created_at: ts,
    updated_at: ts,
  };
  db.runSync(
    `INSERT INTO items (id, bin_id, name, brand, category, quantity, label_text, photo_uri,
                        notes, checked_out_to, low_stock_threshold, source_scan_id,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.bin_id,
      row.name,
      row.brand,
      row.category,
      row.quantity,
      row.label_text,
      row.photo_uri,
      row.notes,
      row.checked_out_to,
      row.low_stock_threshold,
      row.source_scan_id,
      row.created_at,
      row.updated_at,
    ],
  );
  return row;
}

export function itemsForBin(db: DbAdapter, binId: string): ItemRow[] {
  return db.getAllSync<ItemRow>('SELECT * FROM items WHERE bin_id = ? ORDER BY name', [binId]);
}

export function deleteItem(db: DbAdapter, id: string): void {
  db.runSync('DELETE FROM items WHERE id = ?', [id]);
}

export function deleteItemsForBin(db: DbAdapter, binId: string): void {
  db.runSync('DELETE FROM items WHERE bin_id = ?', [binId]);
}

// ---------------------------------------------------- stage 6: daily driver

export function checkOutItem(db: DbAdapter, itemId: string, toWhom: string): void {
  db.runSync('UPDATE items SET checked_out_to = ?, updated_at = ? WHERE id = ?', [
    toWhom,
    nowIso(),
    itemId,
  ]);
}

export function returnItem(db: DbAdapter, itemId: string): void {
  db.runSync('UPDATE items SET checked_out_to = NULL, updated_at = ? WHERE id = ?', [
    nowIso(),
    itemId,
  ]);
}

export interface ItemWithBin extends ItemRow {
  bin_code: string | null;
  bin_name: string | null;
}

export function listCheckedOutItems(db: DbAdapter): ItemWithBin[] {
  return db.getAllSync<ItemWithBin>(
    `SELECT items.*, bins.short_code AS bin_code, bins.name AS bin_name
     FROM items LEFT JOIN bins ON bins.id = items.bin_id
     WHERE items.checked_out_to IS NOT NULL
     ORDER BY items.updated_at DESC`,
  );
}

export function setLowStockThreshold(
  db: DbAdapter,
  itemId: string,
  threshold: number | null,
): void {
  db.runSync('UPDATE items SET low_stock_threshold = ?, updated_at = ? WHERE id = ?', [
    threshold,
    nowIso(),
    itemId,
  ]);
}

/** Full edit of an item's identity fields (field-test ask: fix tags/names). */
export function updateItem(
  db: DbAdapter,
  itemId: string,
  input: {
    name: string;
    brand: string | null;
    category: ItemCategory;
    quantity: number;
    labelText: string | null;
    notes?: string | null;
    photoUri?: string | null;
  },
): void {
  db.runSync(
    'UPDATE items SET name = ?, brand = ?, category = ?, quantity = ?, label_text = ?, notes = ?, photo_uri = ?, updated_at = ? WHERE id = ?',
    [
      input.name,
      input.brand,
      input.category,
      Math.max(0, input.quantity),
      input.labelText,
      input.notes ?? null,
      input.photoUri ?? null,
      nowIso(),
      itemId,
    ],
  );
}

/** Re-home a single item (field-test ask: items were stuck in their bin). */
export function moveItemToBin(db: DbAdapter, itemId: string, binId: string): void {
  db.runSync('UPDATE items SET bin_id = ?, updated_at = ? WHERE id = ?', [
    binId,
    nowIso(),
    itemId,
  ]);
}

/** Shelf + location breadcrumb for a bin (Home cards, labels). */
export function getBinPlace(
  db: DbAdapter,
  binId: string,
): { shelfName: string | null; locationName: string | null } {
  const row = db.getFirstSync<{ shelf_name: string | null; location_name: string | null }>(
    `SELECT s.name AS shelf_name, l.name AS location_name
     FROM bins b
     LEFT JOIN shelves s ON s.id = b.shelf_id
     LEFT JOIN locations l ON l.id = s.location_id
     WHERE b.id = ?`,
    [binId],
  );
  return { shelfName: row?.shelf_name ?? null, locationName: row?.location_name ?? null };
}

// --- D17: recently-deleted items -----------------------------------------

export interface DeletedItemRow {
  id: string;
  bin_id: string | null;
  name: string;
  brand: string | null;
  category: ItemCategory;
  quantity: number;
  label_text: string | null;
  photo_uri: string | null;
  notes: string | null;
  low_stock_threshold: number | null;
  source_scan_id: string | null;
  created_at: string;
  deleted_at: string;
}

/** Delete = snapshot into deleted_items, then really delete (D17). */
export function softDeleteItem(db: DbAdapter, itemId: string): void {
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT OR REPLACE INTO deleted_items
       (id, bin_id, name, brand, category, quantity, label_text, photo_uri,
        notes, low_stock_threshold, source_scan_id, created_at, deleted_at)
       SELECT id, bin_id, name, brand, category, quantity, label_text, photo_uri,
              notes, low_stock_threshold, source_scan_id, created_at, ?
       FROM items WHERE id = ?`,
      [nowIso(), itemId],
    );
    db.runSync('DELETE FROM items WHERE id = ?', [itemId]);
  });
}

export function listDeletedItems(db: DbAdapter): DeletedItemRow[] {
  return db.getAllSync<DeletedItemRow>('SELECT * FROM deleted_items ORDER BY deleted_at DESC');
}

/**
 * Restore a snapshot back into items. `targetBinId` overrides the original
 * bin (the caller handles the original bin having since been deleted).
 */
export function restoreDeletedItem(db: DbAdapter, id: string, targetBinId?: string): boolean {
  const row = db.getFirstSync<DeletedItemRow>('SELECT * FROM deleted_items WHERE id = ?', [id]);
  if (!row) return false;
  const binId = targetBinId ?? row.bin_id;
  if (!binId) return false;
  db.withTransactionSync(() => {
    insertItem(db, {
      id: row.id,
      binId,
      name: row.name,
      brand: row.brand,
      category: row.category,
      quantity: row.quantity,
      labelText: row.label_text,
      photoUri: row.photo_uri,
      notes: row.notes,
      lowStockThreshold: row.low_stock_threshold,
      sourceScanId: row.source_scan_id,
    });
    db.runSync('DELETE FROM deleted_items WHERE id = ?', [id]);
  });
  return true;
}

export function purgeDeletedItems(db: DbAdapter, maxAgeDays = 30): void {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  db.runSync('DELETE FROM deleted_items WHERE deleted_at < ?', [cutoff]);
}

/**
 * Photos of the scans that cataloged a bin's items, newest first — the
 * cover-collage fallback for bins that have never had a full audit photo.
 */
export function listItemPhotoUris(db: DbAdapter, binId: string, limit = 4): string[] {
  return db
    .getAllSync<{ photo_uri: string }>(
      `SELECT DISTINCT s.photo_uri FROM items i
       JOIN scans s ON s.id = i.source_scan_id
       WHERE i.bin_id = ? AND s.photo_uri IS NOT NULL
       ORDER BY i.created_at DESC LIMIT ?`,
      [binId, limit],
    )
    .map((r) => r.photo_uri);
}

export function setItemQuantity(db: DbAdapter, itemId: string, quantity: number): void {
  db.runSync('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?', [
    Math.max(0, quantity),
    nowIso(),
    itemId,
  ]);
}

/** Consumables at or below their low-stock threshold (blueprint Q2 coarse). */
export function listLowStockItems(db: DbAdapter): ItemWithBin[] {
  return db.getAllSync<ItemWithBin>(
    `SELECT items.*, bins.short_code AS bin_code, bins.name AS bin_name
     FROM items LEFT JOIN bins ON bins.id = items.bin_id
     WHERE items.low_stock_threshold IS NOT NULL
       AND items.quantity <= items.low_stock_threshold
     ORDER BY items.name`,
  );
}

/** Confirmed audit photos for the bin-detail history timeline (Q3). */
export function listAuditHistory(db: DbAdapter, binId: string): ScanRow[] {
  return db.getAllSync<ScanRow>(
    `SELECT * FROM scans
     WHERE bin_id = ? AND mode = 'bin_audit' AND status = 'confirmed' AND photo_uri != ''
     ORDER BY created_at DESC`,
    [binId],
  );
}

export function countItems(db: DbAdapter): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM items');
  return row?.n ?? 0;
}

// -------------------------------------------------------------------- scans

export function insertScan(
  db: DbAdapter,
  input: { mode: ScanMode; photoUri: string; binId?: string | null; id?: string },
): ScanRow {
  const row: ScanRow = {
    id: input.id ?? newId(),
    bin_id: input.binId ?? null,
    mode: input.mode,
    photo_uri: input.photoUri,
    status: 'queued',
    raw_response: null,
    error: null,
    created_at: nowIso(),
    resolved_at: null,
    engine: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
  };
  db.runSync(
    `INSERT INTO scans (id, bin_id, mode, photo_uri, status, raw_response, error, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.bin_id,
      row.mode,
      row.photo_uri,
      row.status,
      row.raw_response,
      row.error,
      row.created_at,
      row.resolved_at,
    ],
  );
  return row;
}

export function getScan(db: DbAdapter, id: string): ScanRow | null {
  return db.getFirstSync<ScanRow>('SELECT * FROM scans WHERE id = ?', [id]);
}

export function listQueuedScans(db: DbAdapter): ScanRow[] {
  return db.getAllSync<ScanRow>(
    "SELECT * FROM scans WHERE status = 'queued' ORDER BY created_at ASC",
  );
}

/** Scans needing user attention or work: queue badge + queue screen. */
export function listAttentionScans(db: DbAdapter): ScanRow[] {
  return db.getAllSync<ScanRow>(
    "SELECT * FROM scans WHERE status IN ('queued', 'processing', 'failed', 'review') ORDER BY created_at ASC",
  );
}

export function countAttentionScans(db: DbAdapter): number {
  const row = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM scans WHERE status IN ('queued', 'processing', 'failed', 'review')",
  );
  return row?.n ?? 0;
}

export interface ScanAttentionCounts {
  /** Recognized and waiting for the review screen — the actionable one. */
  review: number;
  /** Still queued or mid-recognition; nothing for the user to do yet. */
  working: number;
  /** Settled badly and needing a retry or a discard. */
  failed: number;
}

/**
 * Attention split by what the user can actually do about it. Home leads with
 * "ready to review" because that is the one that needs a person; D18 made
 * that the normal end of a capture rather than the exception.
 */
export function countScansByAttention(db: DbAdapter): ScanAttentionCounts {
  const rows = db.getAllSync<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM scans
     WHERE status IN ('queued', 'processing', 'failed', 'review')
     GROUP BY status`,
  );
  const counts: ScanAttentionCounts = { review: 0, working: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === 'review') counts.review += row.n;
    else if (row.status === 'failed') counts.failed += row.n;
    else counts.working += row.n;
  }
  return counts;
}

/** Boot recovery (§9 kill-test): an interrupted scan resumes as queued. */
export function resetInterruptedScans(db: DbAdapter): number {
  const stuck = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM scans WHERE status = 'processing'",
  );
  db.runSync("UPDATE scans SET status = 'queued' WHERE status = 'processing'");
  return stuck?.n ?? 0;
}

/** Photos of discarded/failed scans older than the cutoff are prunable (§9). */
export function listPrunableScans(db: DbAdapter, cutoffIso: string): ScanRow[] {
  return db.getAllSync<ScanRow>(
    "SELECT * FROM scans WHERE status IN ('discarded', 'failed') AND created_at < ? AND photo_uri != ''",
    [cutoffIso],
  );
}

export function clearScanPhoto(db: DbAdapter, id: string): void {
  db.runSync("UPDATE scans SET photo_uri = '' WHERE id = ?", [id]);
}

export function updateScanStatus(
  db: DbAdapter,
  id: string,
  status: ScanStatus,
  extra: { rawResponse?: string | null; error?: string | null; resolvedAt?: string | null } = {},
): void {
  db.runSync(
    `UPDATE scans SET status = ?,
       raw_response = COALESCE(?, raw_response),
       error = COALESCE(?, error),
       resolved_at = COALESCE(?, resolved_at)
     WHERE id = ?`,
    [status, extra.rawResponse ?? null, extra.error ?? null, extra.resolvedAt ?? null, id],
  );
}

/** D15: records which engine ran a scan and, for cloud engines, its measured spend. */
export function recordScanUsage(
  db: DbAdapter,
  id: string,
  usage: {
    engine: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
  },
): void {
  db.runSync(
    'UPDATE scans SET engine = ?, input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ?',
    [usage.engine, usage.inputTokens ?? null, usage.outputTokens ?? null, usage.costUsd ?? null, id],
  );
}

export interface SpendTotals {
  engine: string;
  scans: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Cumulative measured spend per engine, optionally since an ISO date. */
export function listSpendTotals(db: DbAdapter, sinceIso?: string): SpendTotals[] {
  return db.getAllSync<SpendTotals>(
    `SELECT engine,
            COUNT(*) AS scans,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
     FROM scans
     WHERE cost_usd IS NOT NULL AND engine IS NOT NULL AND created_at >= ?
     GROUP BY engine
     ORDER BY cost_usd DESC`,
    [sinceIso ?? ''],
  );
}
