/** ISO-8601 UTC timestamp — the only time format that touches the database. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * "scanned 4d ago" — how long since the camera last visited a bin.
 *
 * A date on its own ("2026-04-12") makes you do the arithmetic, and the
 * question a list of bins actually answers is "which of these has nobody
 * looked in for ages". Never scanned is its own answer, not a blank.
 */
export function scannedAgo(lastScannedAt: string | null, now = new Date()): string {
  if (!lastScannedAt) return 'never scanned';
  const days = Math.floor((now.getTime() - Date.parse(lastScannedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'scanned today';
  if (days === 0) return 'scanned today';
  if (days === 1) return 'scanned yesterday';
  return `scanned ${days}d ago`;
}
