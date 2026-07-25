import type { DbAdapter } from '../db/adapter';
import { countEmbeddings, countItemsWithPhotos } from '../db/embeddingQueries';
import { getEmbedder } from '../vision/visualMemory';

import { listEvents, type EventRow } from './events';

/**
 * What visual memory has been doing (blueprint D16 + D20).
 *
 * A rollup over the `memory` events, kept pure and separate from the screen so
 * it can be unit-tested against a hand-built log. The Settings line answers
 * "how much has it memorised?"; this answers the harder question — "when it
 * said nothing, was that a near miss, an empty memory, or no encoder at all?"
 *
 * Similarity scores appear here and nowhere else. §11 invariant 2 exempts the
 * diagnostics surface precisely so this screen can be read honestly; every
 * screen that describes inventory still shows rank order and no number.
 */
export interface RecallLine {
  time: string;
  /** null when there was no encoder, so the row can say so instead of "0". */
  hits: number | null;
  top: number | null;
  candidates: number;
  durationMs: number | null;
}

export interface MemoryReport {
  /** The encoder the log last saw, or null if none has ever run. */
  model: string | null;
  /** Whether an encoder is loaded *right now* — a live fact, not history. */
  available: boolean;
  remembered: number;
  withPhotos: number;
  recalls: number;
  recallsWithHits: number;
  /** Recalls whose suggestion the user actually tapped. */
  opened: number;
  embedFailures: number;
  recent: RecallLine[];
}

interface RecallDetail {
  available?: boolean;
  model?: string;
  candidates?: number;
  hits?: number;
  top?: number | null;
}

function parseDetail(row: EventRow): RecallDetail {
  if (!row.detail) return {};
  try {
    return JSON.parse(row.detail) as RecallDetail;
  } catch {
    // A malformed row is a curiosity, not a reason to blank the screen.
    return {};
  }
}

export function buildMemoryReport(db: DbAdapter, recentLimit = 6): MemoryReport {
  const embedder = getEmbedder();
  // Enough history to be useful without walking the whole 5,000-row budget.
  const events = listEvents(db, 500).filter((e) => e.kind === 'memory');
  const recalls = events.filter((e) => e.name === 'memory_recall');

  // Prefer the live encoder; fall back to whatever the log last saw, so the
  // screen still names the model that produced the scores it is showing.
  const model =
    embedder?.model ??
    recalls.map((e) => parseDetail(e).model).find((m): m is string => !!m) ??
    null;

  return {
    model,
    available: embedder !== null,
    remembered: model ? countEmbeddings(db, model) : 0,
    withPhotos: countItemsWithPhotos(db),
    recalls: recalls.length,
    recallsWithHits: recalls.filter((e) => (parseDetail(e).hits ?? 0) > 0).length,
    opened: events.filter((e) => e.name === 'memory_recall_opened').length,
    embedFailures: events.filter((e) => e.name === 'memory_embed_failed').length,
    recent: recalls.slice(0, recentLimit).map((e) => {
      const detail = parseDetail(e);
      return {
        time: e.created_at.slice(11, 19),
        hits: detail.available === false ? null : (detail.hits ?? 0),
        top: detail.top ?? null,
        candidates: detail.candidates ?? 0,
        durationMs: e.duration_ms,
      };
    }),
  };
}

/** One scannable line per recall — the shape a shared bundle gets read in. */
export function describeRecall(line: RecallLine): string {
  if (line.hits === null) return 'no encoder loaded';
  if (line.candidates === 0) return 'nothing memorised yet';
  const score = line.top === null ? '' : ` · best ${line.top.toFixed(3)}`;
  const took = line.durationMs === null ? '' : ` · ${line.durationMs}ms`;
  const verdict = line.hits > 0 ? `${line.hits} match${line.hits === 1 ? '' : 'es'}` : 'no match';
  return `${verdict} of ${line.candidates}${score}${took}`;
}
