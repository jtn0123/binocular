import { z } from 'zod';

import { TagSlug } from '../vision/types';

import type { DbAdapter } from './adapter';
import type { BinRow, ItemRow, LocationRow, ScanRow, ShelfRow } from './queries';
import { FALLBACK_TAG, type TagRow } from './tags';

/**
 * Full-fidelity dump/restore for backup (blueprint Stage 6). Rows are
 * copied verbatim — ids and ISO timestamps included — so an export
 * followed by an import into an empty database is identical.
 */
export interface BackupDump {
  version: 1;
  exported_at: string;
  locations: LocationRow[];
  shelves: ShelfRow[];
  bins: BinRow[];
  items: ItemRow[];
  scans: ScanRow[];
  /** D19; optional so a backup taken before the tag vocabulary still imports. */
  tags?: TagRow[];
}

// ------------------------------------------------- import trust boundary
// Imports are a trust boundary (blueprint D9): the manifest is arbitrary
// bytes off disk, so every row is zod-validated before it can touch SQLite.

const LocationRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  created_at: z.string(),
});

const ShelfRowSchema = z.object({
  id: z.string().min(1),
  location_id: z.string().min(1),
  name: z.string(),
  created_at: z.string(),
});

const BinRowSchema = z.object({
  id: z.string().min(1),
  shelf_id: z.string().nullable(),
  short_code: z.string().min(1),
  name: z.string(),
  cover_photo_uri: z.string().nullable(),
  last_scanned_at: z.string().nullable(),
  created_at: z.string(),
});

const ItemRowSchema = z.object({
  id: z.string().min(1),
  bin_id: z.string().min(1),
  name: z.string(),
  brand: z.string().nullable(),
  // D19: the vocabulary is the user's, so an import validates slug shape
  // and resolves the value against this database's tags on restore.
  category: TagSlug,
  quantity: z.number().int(),
  label_text: z.string().nullable(),
  photo_uri: z.string().nullable(),
  notes: z.string().nullable(),
  checked_out_to: z.string().nullable(),
  low_stock_threshold: z.number().int().nullable(),
  source_scan_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ScanRowSchema = z.object({
  id: z.string().min(1),
  bin_id: z.string().nullable(),
  mode: z.enum(['bin_audit', 'check_in', 'find_it']),
  photo_uri: z.string(),
  status: z.enum(['queued', 'processing', 'review', 'confirmed', 'discarded', 'failed']),
  raw_response: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  // Pre-D15 backups lack these keys entirely — default them to NULL.
  engine: z.string().nullable().default(null),
  input_tokens: z.number().nullable().default(null),
  output_tokens: z.number().nullable().default(null),
  cost_usd: z.number().nullable().default(null),
});

const TagRowSchema = z.object({
  slug: TagSlug,
  label: z.string().min(1),
  sort_order: z.number().int(),
  created_at: z.string(),
});

const BackupDumpSchema = z.object({
  version: z.literal(1),
  exported_at: z.string(),
  /**
   * D19. Optional: a backup taken before the tag vocabulary existed has no
   * tags key, and must still import — its items all carry one of the twelve
   * slugs migration 008 seeds, so they resolve cleanly anyway.
   */
  tags: z.array(TagRowSchema).optional(),
  locations: z.array(LocationRowSchema),
  shelves: z.array(ShelfRowSchema),
  bins: z.array(BinRowSchema),
  items: z.array(ItemRowSchema),
  scans: z.array(ScanRowSchema),
});

/** Validates untrusted manifest JSON; throws a friendly error otherwise. */
export function parseBackupDump(json: unknown): BackupDump {
  const parsed = BackupDumpSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join('.') || 'root';
    throw new Error(
      `This file is not a valid Binocular backup (problem at ${where}: ${first?.message ?? 'unknown'}).`,
    );
  }
  // Runtime-validated above; the enum fields now match the row types.
  return parsed.data as BackupDump;
}

export function dumpAll(db: DbAdapter, exportedAt: string): BackupDump {
  return {
    version: 1,
    exported_at: exportedAt,
    locations: db.getAllSync<LocationRow>('SELECT * FROM locations ORDER BY id'),
    shelves: db.getAllSync<ShelfRow>('SELECT * FROM shelves ORDER BY id'),
    bins: db.getAllSync<BinRow>('SELECT * FROM bins ORDER BY id'),
    items: db.getAllSync<ItemRow>('SELECT * FROM items ORDER BY id'),
    scans: db.getAllSync<ScanRow>('SELECT * FROM scans ORDER BY id'),
    // D19: without this a restore silently loses every custom tag, and each
    // item using one lands on `other`.
    tags: db.getAllSync<TagRow>('SELECT * FROM tags ORDER BY sort_order, slug'),
  };
}

export function isDatabaseEmpty(db: DbAdapter): boolean {
  for (const table of ['locations', 'shelves', 'bins', 'items', 'scans']) {
    const row = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    if ((row?.n ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Restores a dump into an EMPTY database (throws otherwise — imports never
 * merge, per the exit criteria). `rewriteUri` lets the caller remap photo
 * paths to the new install's storage.
 */
export function restoreAll(
  db: DbAdapter,
  dump: BackupDump,
  rewriteUri: (uri: string | null) => string | null = (uri) => uri,
): void {
  if (dump.version !== 1) throw new Error(`Unsupported backup version: ${String(dump.version)}`);
  if (!isDatabaseEmpty(db)) {
    throw new Error('Import refused: the database is not empty. Imports never merge.');
  }
  db.withTransactionSync(() => {
    for (const l of dump.locations) {
      db.runSync('INSERT INTO locations (id, name, created_at) VALUES (?, ?, ?)', [
        l.id,
        l.name,
        l.created_at,
      ]);
    }
    for (const s of dump.shelves) {
      db.runSync('INSERT INTO shelves (id, location_id, name, created_at) VALUES (?, ?, ?, ?)', [
        s.id,
        s.location_id,
        s.name,
        s.created_at,
      ]);
    }
    for (const b of dump.bins) {
      db.runSync(
        `INSERT INTO bins (id, shelf_id, short_code, name, cover_photo_uri, last_scanned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          b.id,
          b.shelf_id,
          b.short_code,
          b.name,
          rewriteUri(b.cover_photo_uri),
          b.last_scanned_at,
          b.created_at,
        ],
      );
    }
    // Scans before items: items.source_scan_id references scans.
    for (const s of dump.scans) {
      db.runSync(
        `INSERT INTO scans (id, bin_id, mode, photo_uri, status, raw_response, error, created_at,
                            resolved_at, engine, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.bin_id,
          s.mode,
          rewriteUri(s.photo_uri) ?? '',
          s.status,
          s.raw_response,
          s.error,
          s.created_at,
          s.resolved_at,
          // Pre-D15 backups lack these fields; restore them as NULL.
          s.engine ?? null,
          s.input_tokens ?? null,
          s.output_tokens ?? null,
          s.cost_usd ?? null,
        ],
      );
    }
    // D19: the vocabulary first, so items can be resolved against it. Any
    // tag the backup carries that this database lacks is created; anything an
    // item references that still cannot be found lands on `other` rather than
    // pointing at a tag that does not exist.
    for (const t of dump.tags ?? []) {
      db.runSync(
        'INSERT OR IGNORE INTO tags (slug, label, sort_order, created_at) VALUES (?, ?, ?, ?)',
        [t.slug, t.label, t.sort_order, t.created_at],
      );
    }
    const knownTags = new Set(
      db.getAllSync<{ slug: string }>('SELECT slug FROM tags').map((row) => row.slug),
    );

    for (const i of dump.items) {
      db.runSync(
        `INSERT INTO items (id, bin_id, name, brand, category, quantity, label_text, photo_uri,
                            notes, checked_out_to, low_stock_threshold, source_scan_id,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          i.id,
          i.bin_id,
          i.name,
          i.brand,
          knownTags.has(i.category) ? i.category : FALLBACK_TAG,
          i.quantity,
          i.label_text,
          rewriteUri(i.photo_uri),
          i.notes,
          i.checked_out_to,
          i.low_stock_threshold,
          i.source_scan_id,
          i.created_at,
          i.updated_at,
        ],
      );
    }
  });
}
