import type { DbAdapter } from '../db/adapter';
import {
  countEmbeddings,
  countItemsWithPhotos,
  listCandidates,
  listItemsNeedingEmbedding,
  putEmbedding,
} from '../db/embeddingQueries';
import { logEvent } from '../diagnostics/events';

import { search } from './similarity';

/**
 * Visual memory (blueprint D20).
 *
 * "Which of my items does this resemble?" — retrieval over the user's own
 * confirmed photos, deliberately *not* a `VisionProvider` (§5). It cannot
 * name a thing it has not been shown, and everything it returns is a
 * suggestion that still passes through the review screen (D6).
 *
 * The encoder is injected rather than imported. That keeps the heavyweight
 * native module out of every test and every code path that does not need it,
 * mirrors how the ML Kit import is confined to localProvider.ts, and means
 * the app behaves correctly when no encoder has been downloaded: the feature
 * reports itself unavailable and nothing else changes.
 */
export interface Embedder {
  /** Identifies the encoder; vectors from different models never mix. */
  readonly model: string;
  embed(photoUri: string): Promise<Float32Array>;
}

/**
 * Below this, a match is not worth showing.
 *
 * Starting point, not a tuned value — it wants calibrating against real
 * workshop photos on hardware, which is the one thing no test here can do.
 * Erring high is the safer direction: a missing suggestion is invisible,
 * while a confident wrong one sends you to the wrong bin.
 */
export const DEFAULT_MIN_SCORE = 0.75;

let active: Embedder | null = null;

export function setEmbedder(embedder: Embedder | null): void {
  active = embedder;
}

export function getEmbedder(): Embedder | null {
  return active;
}

/** Whether visual memory can answer at all — no encoder, no answers. */
export function isVisualMemoryAvailable(): boolean {
  return active !== null;
}

export interface Recollection {
  itemId: string;
  name: string;
  quantity: number;
  binId: string | null;
  binCode: string | null;
  binName: string | null;
  shelfName: string | null;
  locationName: string | null;
}

/**
 * Items resembling the photo, closest first. Empty when there is no encoder,
 * nothing catalogued yet, or nothing similar enough — the three cases the
 * caller must be able to explain rather than render as a blank screen.
 */
export async function recall(
  db: DbAdapter,
  photoUri: string,
  { k = 5, minScore = DEFAULT_MIN_SCORE }: { k?: number; minScore?: number } = {},
): Promise<Recollection[]> {
  const startedAt = Date.now();
  const embedder = active;
  if (!embedder) {
    logEvent(db, { kind: 'memory', name: 'memory_recall', detail: { available: false } });
    return [];
  }

  const candidates = listCandidates(db, embedder.model);
  if (candidates.length === 0) {
    logEvent(db, {
      kind: 'memory',
      name: 'memory_recall',
      detail: { model: embedder.model, candidates: 0 },
    });
    return [];
  }

  const query = await embedder.embed(photoUri);
  const { matches, best } = search(query, candidates, { k, minScore });
  // D16/D20: `best` is recorded even when it lost, because a rejected match
  // leaves no other trace and is the only evidence that would tell us whether
  // `minScore` is set right. Never rendered outside diagnostics (§11.2).
  logEvent(db, {
    kind: 'memory',
    name: 'memory_recall',
    durationMs: Date.now() - startedAt,
    detail: {
      model: embedder.model,
      candidates: candidates.length,
      dims: query.length,
      hits: matches.length,
      top: round3(best),
      minScore,
    },
  });
  if (matches.length === 0) return [];

  // One query for the whole result set, then reordered to match ranking —
  // SQL cannot express "in this order" without a temporary table.
  const placeholders = matches.map(() => '?').join(', ');
  const rows = db.getAllSync<Recollection>(
    `SELECT items.id        AS itemId,
            items.name      AS name,
            items.quantity  AS quantity,
            bins.id         AS binId,
            bins.short_code AS binCode,
            bins.name       AS binName,
            shelves.name    AS shelfName,
            locations.name  AS locationName
     FROM items
     LEFT JOIN bins ON bins.id = items.bin_id
     LEFT JOIN shelves ON shelves.id = bins.shelf_id
     LEFT JOIN locations ON locations.id = shelves.location_id
     WHERE items.id IN (${placeholders})`,
    matches.map((m) => m.itemId),
  );
  const byId = new Map(rows.map((row) => [row.itemId, row]));
  return matches.map((m) => byId.get(m.itemId)).filter((row): row is Recollection => Boolean(row));
}

/** Three decimals is plenty to judge a threshold by, and keeps the log terse. */
function round3(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

/** Encodes one item's photo into the memory. False when it could not. */
export async function rememberItem(
  db: DbAdapter,
  itemId: string,
  photoUri: string,
): Promise<boolean> {
  const embedder = active;
  if (!embedder) return false;
  try {
    putEmbedding(db, itemId, await embedder.embed(photoUri), embedder.model);
    return true;
  } catch (err) {
    // A photo that has been deleted or will not decode should cost this one
    // item its suggestion, never the pass that is walking the backlog. Logged
    // per item because failures are rare by definition; successes are counted
    // in the backfill summary instead, so a large workshop cannot spend the
    // D16 row budget on good news.
    logEvent(db, {
      kind: 'memory',
      name: 'memory_embed_failed',
      detail: {
        itemId,
        model: embedder.model,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}

/**
 * Encodes a bounded slice of the backlog. Returns how many succeeded, so a
 * caller can keep going while there is work and stop when there is not.
 *
 * Bounded because this runs on app foreground beside everything else the
 * user is trying to do: a workshop with a thousand photos must not turn the
 * first launch after enabling the feature into a stall.
 */
export async function backfillEmbeddings(db: DbAdapter, limit = 8): Promise<number> {
  const embedder = active;
  if (!embedder) return 0;

  const backlog = listItemsNeedingEmbedding(db, embedder.model, limit);
  // Nothing to do is the steady state — every app foreground calls this, so
  // logging an empty pass would fill the D16 budget with silence.
  if (backlog.length === 0) return 0;

  const startedAt = Date.now();
  let done = 0;
  for (const row of backlog) {
    if (await rememberItem(db, row.id, row.photo_uri)) done += 1;
  }
  logEvent(db, {
    kind: 'memory',
    name: 'memory_backfill',
    durationMs: Date.now() - startedAt,
    detail: {
      model: embedder.model,
      attempted: backlog.length,
      embedded: done,
      remaining: Math.max(0, countItemsWithPhotos(db) - countEmbeddings(db, embedder.model)),
    },
  });
  return done;
}
