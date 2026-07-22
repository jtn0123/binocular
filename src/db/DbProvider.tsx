import { openDatabaseSync } from 'expo-sqlite';
import { createContext, useContext, useState, type ReactNode } from 'react';

import type { DbAdapter } from './adapter';
import { createExpoAdapter } from './expoAdapter';
import { runMigrations } from './schema';
import { seedIfEmpty } from './seed';

const DbContext = createContext<DbAdapter | null>(null);

/**
 * Opens the app database, applies migrations, and (dev only) seeds demo
 * data before rendering children.
 */
export function DbProvider({ children }: { children: ReactNode }) {
  const [db] = useState<DbAdapter>(() => {
    const adapter = createExpoAdapter(openDatabaseSync('binocular.db'));
    runMigrations(adapter);
    if (__DEV__) seedIfEmpty(adapter);
    return adapter;
  });
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): DbAdapter {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used within DbProvider');
  return db;
}
