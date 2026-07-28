import type { DbAdapter } from '../db/adapter';

/**
 * Near-miss correction for search (field-test finding: a typo returned
 * silence, which reads as "the workshop doesn't have one").
 *
 * Candidates come from `item_vocab` — the fts5vocab view over the search
 * index — so suggestions are always words this workshop actually contains.
 * No dictionary ships with the app, nothing needs syncing, and it stays
 * offline (I4).
 *
 * Only ever consulted after an exact search returns nothing, so the <100ms
 * AC on the normal path is untouched.
 */

/** Terms shorter than this are too ambiguous to correct ("nut" vs "not"). */
const MIN_TERM_LENGTH = 4;

/** Bounds the vocabulary scan so a huge workshop can't stall the keyboard. */
const MAX_VOCAB_TERMS = 20_000;

export interface VocabTerm {
  term: string;
  doc: number;
}

/** How far a term may stray before it stops being the same word. */
export function maxDistanceFor(token: string): number {
  if (token.length < MIN_TERM_LENGTH) return 0;
  return token.length <= 6 ? 1 : 2;
}

/**
 * Levenshtein distance, abandoned as soon as it cannot come in at or under
 * `max`. The early exit is what keeps a full-vocabulary scan cheap.
 */
export function editDistanceWithin(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return null;
    previous = current;
  }
  const distance = previous[b.length];
  return distance <= max ? distance : null;
}

/**
 * Singular/plural spellings of a token, most confident first.
 *
 * Edit distance alone cannot bridge a plural: "batteries" is three edits from
 * "battery" while the cap for a nine-letter token is two, so typing the final
 * "s" of a word DELETED an answer that had been on screen a keystroke
 * earlier — "batterie" corrected fine and "batteries" reported nothing. That
 * is the worst shape a search failure can take, because it reads as the
 * workshop genuinely not having one.
 *
 * Deliberately naive: workshop nouns are ordinary English, and every
 * candidate is checked against the index before it is used, so this can only
 * ever pick a word the workshop actually contains. §8.3's rule holds — a word
 * the workshop lacks still reports nothing rather than inventing a match.
 */
export function pluralVariants(token: string): string[] {
  const out: string[] = [];
  const add = (word: string) => {
    if (word.length >= 3 && word !== token && !out.includes(word)) out.push(word);
  };
  if (token.endsWith('ies')) add(`${token.slice(0, -3)}y`);
  if (token.endsWith('es')) add(token.slice(0, -2));
  if (token.endsWith('s') && !token.endsWith('ss')) add(token.slice(0, -1));
  if (token.endsWith('y')) add(`${token.slice(0, -1)}ies`);
  if (!token.endsWith('s')) {
    add(`${token}s`);
    add(`${token}es`);
  }
  return out;
}

/**
 * Best replacement for a token, or null if nothing is close enough.
 *
 * Ties break on how many items carry the term, then alphabetically — so the
 * suggestion is both the most useful and the same every time.
 */
export function bestMatch(token: string, vocabulary: readonly VocabTerm[]): string | null {
  const needle = token.toLowerCase();
  const max = maxDistanceFor(needle);
  if (max === 0) return null;
  // A token that already prefixes something in the index is spelled fine —
  // it is some *other* token in the query that found nothing. Correcting it
  // anyway is how "deck scrws" would turn into "dock screws".
  if (vocabulary.some((entry) => entry.term.startsWith(needle))) return null;

  // Plural before typo: a plural is a spelling the user meant, not a mistake,
  // and it is the likelier explanation for a word that is otherwise perfectly
  // formed. Only accepted when the index really holds it.
  //
  // What comes back is the *indexed* term, never the guess that found it.
  // `pluralVariants` strips endings mechanically, so "houses" produces "hous"
  // before it produces "house" — and returning the guess offered the user a
  // non-word that happened to prefix a real one. The variant is a way of
  // looking things up, not an answer.
  for (const variant of pluralVariants(needle)) {
    const exact = vocabulary.find((entry) => entry.term === variant);
    if (exact) return exact.term;
    const prefixed = vocabulary
      .filter((entry) => entry.term.startsWith(variant))
      // Same tie-break as the edit-distance search below, so a suggestion is
      // both the most useful one and the same every time.
      .sort((a, b) => b.doc - a.doc || (a.term < b.term ? -1 : 1))[0];
    if (prefixed) return prefixed.term;
  }

  let best: { term: string; distance: number; doc: number } | null = null;
  for (const entry of vocabulary) {
    const distance = editDistanceWithin(needle, entry.term, max);
    if (distance === null || distance === 0) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (entry.doc > best.doc || (entry.doc === best.doc && entry.term < best.term)))
    ) {
      best = { term: entry.term, distance, doc: entry.doc };
    }
  }
  return best?.term ?? null;
}

export function loadVocabulary(db: DbAdapter): VocabTerm[] {
  try {
    return db.getAllSync<VocabTerm>('SELECT term, doc FROM item_vocab LIMIT ?', [MAX_VOCAB_TERMS]);
  } catch {
    // A database that predates migration 007 simply gets no suggestions.
    return [];
  }
}

/**
 * Rewrites a query so every token that matched nothing is replaced by its
 * closest indexed neighbour. Returns null when nothing could be improved,
 * which is the caller's signal to keep reporting "no matches".
 */
export function correctQuery(db: DbAdapter, tokens: readonly string[]): string | null {
  if (tokens.length === 0) return null;
  const vocabulary = loadVocabulary(db);
  if (vocabulary.length === 0) return null;

  let changed = false;
  const corrected = tokens.map((token) => {
    const match = bestMatch(token, vocabulary);
    if (!match) return token;
    changed = true;
    return match;
  });
  return changed ? corrected.join(' ') : null;
}
