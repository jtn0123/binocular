import type { DbAdapter } from './adapter';
import { nowIso } from '../lib/time';

/**
 * The user-managed tag vocabulary (blueprint D19, migration 008).
 *
 * Items reference a tag by its **slug**, stored as text in `items.category`.
 * That is what keeps this cheap: the FTS index, CSV export and the backup
 * format all already carry `category` as a string, so a rename is one UPDATE
 * and nothing else in the schema knows tags exist.
 *
 * Two rules hold everything together:
 *   - `other` always exists and cannot be deleted. It is what the AI
 *     boundary (§6.1) and every failed lookup resolve to.
 *   - Deleting a tag reassigns its items rather than orphaning them, because
 *     §11 forbids losing inventory data silently.
 */
export const FALLBACK_TAG = 'other';

/**
 * The tags migration 008 seeds — the twelve that were hardcoded before D19.
 * Only for callers with no database to read (the eval harness); a test
 * asserts this stays identical to what the migration actually produces, so
 * the two cannot drift.
 */
export const SEEDED_TAG_SLUGS: readonly string[] = [
  'hand_tool',
  'power_tool',
  'fastener',
  'electrical',
  'plumbing',
  'adhesive_finish',
  'safety',
  'measuring',
  'bit_blade_accessory',
  'hardware',
  'material',
  'other',
];

/** Matches the §6.1 slug shape, so a tag is always a legal AI response. */
const SLUG_PATTERN = /^[a-z0-9_]+$/;
const MAX_SLUG_LENGTH = 40;

export interface TagRow {
  slug: string;
  label: string;
  sort_order: number;
  created_at: string;
}

export function listTags(db: DbAdapter): TagRow[] {
  return db.getAllSync<TagRow>('SELECT * FROM tags ORDER BY sort_order, slug');
}

export function listTagSlugs(db: DbAdapter): string[] {
  return listTags(db).map((tag) => tag.slug);
}

export function getTag(db: DbAdapter, slug: string): TagRow | null {
  return db.getFirstSync<TagRow>('SELECT * FROM tags WHERE slug = ?', [slug]);
}

/** How many live items carry each tag — shown before a destructive edit. */
export function tagUsageCounts(db: DbAdapter): Record<string, number> {
  const rows = db.getAllSync<{ category: string; n: number }>(
    'SELECT category, COUNT(*) AS n FROM items GROUP BY category',
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.category] = row.n;
  return counts;
}

/**
 * Turns free text into a slug: "Marine hardware" -> "marine_hardware".
 * Returns null when nothing usable survives, so the caller can complain
 * rather than create a tag named "".
 */
export function toSlug(input: string): string | null {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/g, '');
  return slug.length > 0 && SLUG_PATTERN.test(slug) ? slug : null;
}

export class TagError extends Error {}

/** Adds a tag. The label is what the UI shows; the slug is what items store. */
export function createTag(db: DbAdapter, label: string): TagRow {
  const trimmed = label.trim();
  const slug = toSlug(trimmed);
  if (!slug) throw new TagError('Give the tag a name using letters or numbers.');
  if (getTag(db, slug)) throw new TagError(`There is already a "${trimmed}" tag.`);

  const next = db.getFirstSync<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM tags');
  const row: TagRow = {
    slug,
    label: trimmed,
    sort_order: (next?.n ?? -1) + 1,
    created_at: nowIso(),
  };
  db.runSync('INSERT INTO tags (slug, label, sort_order, created_at) VALUES (?, ?, ?, ?)', [
    row.slug,
    row.label,
    row.sort_order,
    row.created_at,
  ]);
  return row;
}

/**
 * Renames a tag. If the slug changes, every item carrying the old slug is
 * rewritten in the same transaction — an item can never be left pointing at
 * a tag that no longer exists.
 */
export function renameTag(db: DbAdapter, slug: string, label: string): TagRow {
  const existing = getTag(db, slug);
  if (!existing) throw new TagError('That tag no longer exists.');
  const trimmed = label.trim();
  const nextSlug = toSlug(trimmed);
  if (!nextSlug) throw new TagError('Give the tag a name using letters or numbers.');
  if (nextSlug !== slug && getTag(db, nextSlug)) {
    throw new TagError(`There is already a "${trimmed}" tag.`);
  }

  db.withTransactionSync(() => {
    db.runSync('UPDATE tags SET slug = ?, label = ? WHERE slug = ?', [nextSlug, trimmed, slug]);
    if (nextSlug !== slug) {
      db.runSync('UPDATE items SET category = ? WHERE category = ?', [nextSlug, slug]);
      // The recently-deleted snapshots are restorable for 30 days (D17), so
      // they have to follow the rename too or a restore resurrects a ghost tag.
      db.runSync('UPDATE deleted_items SET category = ? WHERE category = ?', [nextSlug, slug]);
    }
  });
  return { ...existing, slug: nextSlug, label: trimmed };
}

/**
 * Deletes a tag, moving anything using it to `other`. Returns how many items
 * were reassigned so the UI can say so rather than deleting quietly.
 */
export function deleteTag(db: DbAdapter, slug: string): { reassigned: number } {
  if (slug === FALLBACK_TAG) {
    throw new TagError('“Other” is the fallback tag and cannot be deleted.');
  }
  if (!getTag(db, slug)) throw new TagError('That tag no longer exists.');

  const counts = tagUsageCounts(db);
  const reassigned = counts[slug] ?? 0;
  db.withTransactionSync(() => {
    db.runSync('UPDATE items SET category = ? WHERE category = ?', [FALLBACK_TAG, slug]);
    db.runSync('UPDATE deleted_items SET category = ? WHERE category = ?', [FALLBACK_TAG, slug]);
    db.runSync('DELETE FROM tags WHERE slug = ?', [slug]);
  });
  return { reassigned };
}

/**
 * Resolves a slug from outside the app (an AI response, an imported backup)
 * to one this database actually has. Unknown vocabulary becomes `other`
 * rather than failing the whole response — see §6.1's tag-resolution rule.
 */
export function resolveTag(db: DbAdapter, slug: string): string {
  return getTag(db, slug) ? slug : FALLBACK_TAG;
}
