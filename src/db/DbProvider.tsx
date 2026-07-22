import { openDatabaseSync } from 'expo-sqlite';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { applyDemoCovers } from '../lib/demoCovers';

import type { DbAdapter } from './adapter';
import { createExpoAdapter } from './expoAdapter';
import { runMigrations } from './schema';
import { seedIfEmpty } from './seed';

const DbContext = createContext<DbAdapter | null>(null);

/**
 * Opens the app database, applies migrations, and (dev only) seeds demo
 * data before rendering children. Tests inject a Node adapter via the
 * optional `adapter` prop instead of opening expo-sqlite.
 */
export function DbProvider({ children, adapter }: { children: ReactNode; adapter?: DbAdapter }) {
  const [db] = useState<DbAdapter>(() => {
    if (adapter) return adapter;
    const opened = createExpoAdapter(openDatabaseSync('binocular.db'));
    runMigrations(opened);
    if (__DEV__) seedIfEmpty(opened);
    return opened;
  });

  // Dev demo covers for seeded bins — async (asset download), post-boot.
  useEffect(() => {
    if (!adapter && __DEV__) {
      applyDemoCovers(db).catch(() => {
        // demo sugar only — never let it break boot
      });
    }
  }, [adapter, db]);

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): DbAdapter {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used within DbProvider');
  return db;
}
