import type { DbAdapter } from '../db/adapter';
import { newId } from '../lib/id';
import { nowIso } from '../lib/time';

/**
 * Local diagnostics event log (blueprint D16).
 *
 * Two rules drive the whole module:
 *  1. **Never break a user flow.** `logEvent` is synchronous and swallows
 *     every error — a diagnostics failure must never surface to the user.
 *  2. **Bounded.** Always-on logging is only safe if it cannot grow without
 *     limit; pruning trims by BOTH age and count.
 */
export const MAX_EVENTS = 5_000;
export const MAX_AGE_DAYS = 30;

export type EventKind =
  | 'app'
  | 'screen'
  | 'scan'
  | 'queue'
  | 'search'
  | 'net'
  | 'crash'
  | 'settings'
  /** D20 visual memory: what the encoder did, and what it nearly matched. */
  | 'memory';

export interface EventInput {
  kind: EventKind;
  name: string;
  /** Structured extras; JSON-stringified. NEVER put API keys in here. */
  detail?: Record<string, unknown>;
  durationMs?: number;
  scanId?: string;
}

export interface EventRow {
  id: string;
  kind: EventKind;
  name: string;
  detail: string | null;
  duration_ms: number | null;
  scan_id: string | null;
  created_at: string;
}

/**
 * Cached enable flag. The real value lives in secure storage (async), but
 * `logEvent` has to be synchronous to sit on hot paths, so DiagnosticsRunner
 * primes this at boot via `setLoggingEnabled`.
 */
let loggingEnabled = true;

export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

export function isLoggingEnabled(): boolean {
  return loggingEnabled;
}

/** Appends one event. Synchronous, best-effort, never throws. */
export function logEvent(db: DbAdapter, input: EventInput): void {
  if (!loggingEnabled) return;
  try {
    db.runSync(
      `INSERT INTO events (id, kind, name, detail, duration_ms, scan_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        input.kind,
        input.name,
        input.detail ? JSON.stringify(input.detail) : null,
        input.durationMs ?? null,
        input.scanId ?? null,
        nowIso(),
      ],
    );
  } catch {
    // Diagnostics must never break the app.
  }
}

/** Most recent events first. */
export function listEvents(db: DbAdapter, limit = 200): EventRow[] {
  try {
    return db.getAllSync<EventRow>(
      'SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?',
      [limit],
    );
  } catch {
    return [];
  }
}

export function countEvents(db: DbAdapter): number {
  try {
    return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n ?? 0;
  } catch {
    return 0;
  }
}

export function countEventsOfKind(db: DbAdapter, kind: EventKind): number {
  try {
    return (
      db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE kind = ?', [kind])
        ?.n ?? 0
    );
  } catch {
    return 0;
  }
}

/** Trims by age first, then by count. Returns how many rows were removed. */
export function pruneEvents(db: DbAdapter, now: () => number = Date.now): number {
  try {
    const before = countEvents(db);
    const cutoff = new Date(now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.runSync('DELETE FROM events WHERE created_at < ?', [cutoff]);
    // Keep only the newest MAX_EVENTS rows.
    db.runSync(
      `DELETE FROM events WHERE id IN (
         SELECT id FROM events ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
      [MAX_EVENTS],
    );
    return before - countEvents(db);
  } catch {
    return 0;
  }
}

export interface AbnormalExit {
  /** Where the app was when it died — the most useful single fact. */
  lastScreen: string | null;
  /** Timestamp of the last thing the dead session managed to record. */
  lastEventAt: string;
}

/**
 * Whether the *previous* session ended without going to background.
 *
 * The D16 crash handler hooks JS `ErrorUtils`, so it can only ever see a JS
 * error. A native crash — a bad JSI call, a worklet on a runtime that has
 * gone away — kills the process outright, and the log shows a fresh
 * `app_start` with no `app_background` before it and zero crashes recorded.
 * That absence is the evidence, so this reads it: a session that never said
 * goodbye did not exit, it died.
 *
 * Call this BEFORE recording the new `app_start`. Deliberately conservative:
 * a user swiping the app away gets an `app_background` from Android first,
 * so that is a clean exit and reports nothing.
 */
export function detectAbnormalExit(db: DbAdapter): AbnormalExit | null {
  try {
    const last = db.getFirstSync<EventRow>(
      'SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT 1',
    );
    // A fresh install has nothing to say about a previous session.
    if (!last) return null;
    if (last.kind === 'app' && last.name === 'app_background') return null;
    const screen = db.getFirstSync<EventRow>(
      "SELECT * FROM events WHERE kind = 'screen' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    );
    return { lastScreen: screen?.name ?? null, lastEventAt: last.created_at };
  } catch {
    return null;
  }
}

export function clearEvents(db: DbAdapter): void {
  try {
    db.runSync('DELETE FROM events');
  } catch {
    // best effort
  }
}
