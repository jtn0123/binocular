/**
 * Thin synchronous SQLite surface shared by the app (expo-sqlite, wrapped
 * in expoAdapter.ts) and Node-side tooling/tests (better-sqlite3, wrapped
 * in nodeAdapter.ts). Everything in src/db speaks this interface so queries
 * and migrations are testable off-device.
 */
/**
 * `Uint8Array` binds to a SQLite BLOB — used by the D20 visual-memory
 * vectors, the only binary column in the schema. Both adapters already
 * accept it; this widening is what lets the type system say so.
 */
export type SqlParam = string | number | null | Uint8Array;

export interface DbAdapter {
  /** Execute one or more statements with no result (DDL, pragmas). */
  execSync(sql: string): void;
  /** Execute a single parameterized statement with no result. */
  runSync(sql: string, params?: SqlParam[]): void;
  getAllSync<T>(sql: string, params?: SqlParam[]): T[];
  getFirstSync<T>(sql: string, params?: SqlParam[]): T | null;
  withTransactionSync(fn: () => void): void;
}
