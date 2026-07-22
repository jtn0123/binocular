import { newId } from '../lib/id';
import { nowIso } from '../lib/time';

import type { DbAdapter } from './adapter';

/** Row shapes mirror the schema in schema.ts (blueprint §4) verbatim. */
export interface LocationRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ShelfRow {
  id: string;
  location_id: string;
  name: string;
  created_at: string;
}

export interface BinRow {
  id: string;
  shelf_id: string | null;
  short_code: string;
  name: string;
  cover_photo_uri: string | null;
  last_scanned_at: string | null;
  created_at: string;
}

export type ItemCategory =
  | 'hand_tool'
  | 'power_tool'
  | 'fastener'
  | 'electrical'
  | 'plumbing'
  | 'adhesive_finish'
  | 'safety'
  | 'measuring'
  | 'bit_blade_accessory'
  | 'hardware'
  | 'material'
  | 'other';

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
}

// ---------------------------------------------------------------- locations

export function createLocation(db: DbAdapter, input: { name: string; id?: string }): LocationRow {
  const row: LocationRow = { id: input.id ?? newId(), name: input.name, created_at: nowIso() };
  db.runSync('INSERT INTO locations (id, name, created_at) VALUES (?, ?, ?)', [
    row.id,
    row.name,
    row.created_at,
  ]);
  return row;
}

export function listLocations(db: DbAdapter): LocationRow[] {
  return db.getAllSync<LocationRow>('SELECT * FROM locations ORDER BY name');
}

// ------------------------------------------------------------------ shelves

export function createShelf(
  db: DbAdapter,
  input: { locationId: string; name: string; id?: string },
): ShelfRow {
  const row: ShelfRow = {
    id: input.id ?? newId(),
    location_id: input.locationId,
    name: input.name,
    created_at: nowIso(),
  };
  db.runSync('INSERT INTO shelves (id, location_id, name, created_at) VALUES (?, ?, ?, ?)', [
    row.id,
    row.location_id,
    row.name,
    row.created_at,
  ]);
  return row;
}

export function listShelves(db: DbAdapter, locationId: string): ShelfRow[] {
  return db.getAllSync<ShelfRow>('SELECT * FROM shelves WHERE location_id = ? ORDER BY name', [
    locationId,
  ]);
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
  };
  db.runSync(
    `INSERT INTO bins (id, shelf_id, short_code, name, cover_photo_uri, last_scanned_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.shelf_id,
      row.short_code,
      row.name,
      row.cover_photo_uri,
      row.last_scanned_at,
      row.created_at,
    ],
  );
  return row;
}

export function getBin(db: DbAdapter, id: string): BinRow | null {
  return db.getFirstSync<BinRow>('SELECT * FROM bins WHERE id = ?', [id]);
}

export function listBins(db: DbAdapter): BinRow[] {
  return db.getAllSync<BinRow>('SELECT * FROM bins ORDER BY short_code');
}

export function listBinsForShelf(db: DbAdapter, shelfId: string): BinRow[] {
  return db.getAllSync<BinRow>('SELECT * FROM bins WHERE shelf_id = ? ORDER BY short_code', [
    shelfId,
  ]);
}

export function listUnassignedBins(db: DbAdapter): BinRow[] {
  return db.getAllSync<BinRow>('SELECT * FROM bins WHERE shelf_id IS NULL ORDER BY short_code');
}

/** Bins by most recent activity — Home screen's "recent bins". */
export function listRecentBins(db: DbAdapter, limit = 10): BinRow[] {
  return db.getAllSync<BinRow>(
    'SELECT * FROM bins ORDER BY COALESCE(last_scanned_at, created_at) DESC LIMIT ?',
    [limit],
  );
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
