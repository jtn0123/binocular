import type { DbAdapter } from '../db/adapter';
import { nowIso } from '../lib/time';

import { logEvent } from './events';

/**
 * Global crash capture (blueprint D16). Without this, a crash in the field
 * leaves no evidence once the process exits — the single biggest gap for
 * walk-around testing on a standalone build.
 *
 * Two deliberate choices:
 *  - The previous handler is always called, so redbox / normal crash
 *    behaviour is preserved. We observe, we don't swallow.
 *  - If the DB write fails (the DB may BE the problem) we append to a plain
 *    file instead, so a fatal database error still leaves a trace.
 */
export const CRASH_FALLBACK_FILE = 'diagnostics-crash.log';

type Handler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => Handler;
  setGlobalHandler: (handler: Handler) => void;
}

export interface ErrorHandlerDeps {
  /** Injected for tests; defaults to the RN global. */
  errorUtils?: ErrorUtilsLike | null;
  /** Fallback sink used when the DB write throws. */
  appendFallback?: (line: string) => void;
}

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: typeof error === 'string' ? error : JSON.stringify(error) };
}

/** Records one crash; never throws, falls back to a file if the DB fails. */
export function recordCrash(
  db: DbAdapter,
  error: unknown,
  opts: { isFatal?: boolean; source?: string; appendFallback?: (line: string) => void } = {},
): void {
  const { message, stack } = describeError(error);
  const detail = {
    message,
    // Stacks can be enormous; the top frames are what identify a crash.
    stack: stack ? stack.split('\n').slice(0, 20).join('\n') : undefined,
    isFatal: opts.isFatal ?? false,
    source: opts.source ?? 'global',
  };
  try {
    logEvent(db, { kind: 'crash', name: opts.source ?? 'uncaught', detail });
    // logEvent swallows its own errors, so verify the row actually landed.
    const ok = db.getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE kind = 'crash'",
    );
    if (!ok) throw new Error('crash event not persisted');
  } catch {
    try {
      opts.appendFallback?.(JSON.stringify({ at: nowIso(), ...detail }));
    } catch {
      // Nothing left to try.
    }
  }
}

/**
 * Installs the global handler. Returns a disposer that restores the previous
 * handler (used by tests and on unmount).
 */
export function installErrorHandler(db: DbAdapter, deps: ErrorHandlerDeps = {}): () => void {
  const errorUtils =
    deps.errorUtils ??
    (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils ??
    null;
  if (!errorUtils) return () => {};

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    recordCrash(db, error, { isFatal, appendFallback: deps.appendFallback });
    // Preserve normal crash behaviour.
    previous?.(error, isFatal);
  });

  return () => {
    if (previous) errorUtils.setGlobalHandler(previous);
  };
}
