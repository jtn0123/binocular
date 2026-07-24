import { tokenize } from '../search/fts';

import type { DbAdapter } from './adapter';
import { FALLBACK_TAG, listTagSlugs } from './tags';

/**
 * Tag autofill from your own history (blueprint D19 follow-on).
 *
 * You have been tagging items all along, so the app can learn from that
 * instead of guessing: "wire nuts" suggests Electrical because that is what
 * *this workshop* has always called wire-ish things. No model, no network,
 * no training — a frequency count over confirmed items.
 *
 * Deliberately conservative. A wrong suggestion silently mis-files an item,
 * which is worse than no suggestion at all, so a guess must clear both a
 * minimum support and a clear lead over the runner-up or nothing is offered.
 */

/** Shorter tokens ("a", "of", "10") carry no signal about a category. */
const MIN_TOKEN_LENGTH = 3;

/** At least this many past items must back a suggestion. */
const MIN_SUPPORT = 2;

/** The winner must beat the runner-up by this much to count as a clear lead. */
const LEAD_RATIO = 1.5;

export interface TagSuggestion {
  slug: string;
  /** How many past items back it — lets the UI explain itself if it wants to. */
  support: number;
}

/** Tokens worth scoring: long enough to mean something, deduplicated. */
export function meaningfulTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenize(text)) {
    const lower = token.toLowerCase();
    if (lower.length >= MIN_TOKEN_LENGTH) seen.add(lower);
  }
  return [...seen];
}

/**
 * Picks a winner from per-tag support counts, or null when the evidence is
 * thin or split. `other` can never win: suggesting the fallback tells the
 * user nothing they did not already have.
 */
export function pickSuggestion(counts: Record<string, number>): TagSuggestion | null {
  const ranked = Object.entries(counts)
    .filter(([slug, n]) => slug !== FALLBACK_TAG && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const [top, runnerUp] = ranked;
  if (!top || top[1] < MIN_SUPPORT) return null;
  if (runnerUp && top[1] < runnerUp[1] * LEAD_RATIO) return null;
  return { slug: top[0], support: top[1] };
}

/**
 * How often each tag has been used for items whose name shares a word with
 * the given text. One query per token keeps it obvious; the token count is
 * tiny and `items` is small enough that this stays well inside the §8.3
 * latency budget.
 */
export function tagSupportFor(db: DbAdapter, text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const known = new Set(listTagSlugs(db));

  for (const token of meaningfulTokens(text)) {
    const like = `%${token.replace(/([\\%_])/g, '\\$1')}%`;
    const rows = db.getAllSync<{ category: string; n: number }>(
      `SELECT category, COUNT(*) AS n FROM items
       WHERE lower(name) LIKE ? ESCAPE '\\'
       GROUP BY category`,
      [like],
    );
    for (const row of rows) {
      // A tag deleted since those items were filed must not be suggested.
      if (!known.has(row.category)) continue;
      counts[row.category] = (counts[row.category] ?? 0) + row.n;
    }
  }
  return counts;
}

/** The tag this workshop's history suggests for a name, or null. */
export function suggestTag(
  db: DbAdapter,
  name: string,
  brand?: string | null,
): TagSuggestion | null {
  const text = [name, brand].filter(Boolean).join(' ').trim();
  if (!text) return null;
  return pickSuggestion(tagSupportFor(db, text));
}

export interface DuplicateHint {
  itemId: string;
  name: string;
  quantity: number;
  binCode: string | null;
  binName: string | null;
}

/**
 * An item you already have under this exact name.
 *
 * Exact (case- and space-insensitive) rather than fuzzy on purpose: a false
 * "you already have this" is noise that trains you to ignore the warning,
 * and near-miss matching is what search is for.
 */
export function findDuplicate(
  db: DbAdapter,
  name: string,
  excludeItemId?: string | null,
): DuplicateHint | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return db.getFirstSync<DuplicateHint>(
    `SELECT items.id       AS itemId,
            items.name     AS name,
            items.quantity AS quantity,
            bins.short_code AS binCode,
            bins.name      AS binName
     FROM items
     LEFT JOIN bins ON bins.id = items.bin_id
     WHERE lower(trim(items.name)) = ? AND items.id != ?
     LIMIT 1`,
    [needle, excludeItemId ?? ''],
  );
}
