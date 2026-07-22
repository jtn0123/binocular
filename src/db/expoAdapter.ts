import type { SQLiteDatabase } from 'expo-sqlite';

import type { DbAdapter, SqlParam } from './adapter';

/**
 * Adapts expo-sqlite's SQLiteDatabase to the shared DbAdapter surface.
 * Enables foreign-key enforcement to match better-sqlite3's default, so
 * app and tests see identical constraint behavior.
 */
export function createExpoAdapter(db: SQLiteDatabase): DbAdapter {
  db.execSync('PRAGMA foreign_keys = ON');
  return {
    execSync: (sql) => {
      db.execSync(sql);
    },
    runSync: (sql, params: SqlParam[] = []) => {
      db.runSync(sql, params);
    },
    getAllSync: <T>(sql: string, params: SqlParam[] = []) => db.getAllSync<T>(sql, params),
    getFirstSync: <T>(sql: string, params: SqlParam[] = []) => db.getFirstSync<T>(sql, params),
    withTransactionSync: (fn) => {
      db.withTransactionSync(fn);
    },
  };
}
