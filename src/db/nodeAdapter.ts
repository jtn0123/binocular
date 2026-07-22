import Database from 'better-sqlite3';

import type { DbAdapter, SqlParam } from './adapter';

/**
 * better-sqlite3 wrapper for Jest and Node scripts ONLY — never import
 * this from app code (Metro must not try to bundle a native Node addon).
 */
export interface NodeDbAdapter extends DbAdapter {
  close(): void;
}

export function createNodeAdapter(filename = ':memory:'): NodeDbAdapter {
  const db = new Database(filename);
  return {
    execSync: (sql) => {
      db.exec(sql);
    },
    runSync: (sql, params: SqlParam[] = []) => {
      db.prepare(sql).run(...params);
    },
    getAllSync: <T>(sql: string, params: SqlParam[] = []) => db.prepare(sql).all(...params) as T[],
    getFirstSync: <T>(sql: string, params: SqlParam[] = []) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    withTransactionSync: (fn) => {
      db.transaction(fn)();
    },
    close: () => {
      db.close();
    },
  };
}
