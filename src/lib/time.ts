/** ISO-8601 UTC timestamp — the only time format that touches the database. */
export function nowIso(): string {
  return new Date().toISOString();
}
