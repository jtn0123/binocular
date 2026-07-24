import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useDb } from '../db/DbProvider';

import { deviceContext, setNetworkContext } from './context';
import { loadDiagnosticsEnabled } from './enabled';
import { CRASH_FALLBACK_FILE, installErrorHandler } from './errorHandler';
import { logEvent, pruneEvents } from './events';

/**
 * Mounts once beside QueueRunner (blueprint D16): installs crash capture,
 * records app lifecycle / connectivity / navigation, and prunes the log on
 * boot so an always-on recorder stays bounded.
 */
function appendCrashFallback(line: string): void {
  try {
    const dir = new Directory(Paths.document, 'diagnostics');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, CRASH_FALLBACK_FILE);
    const existing = file.exists ? file.textSync() : '';
    file.write(`${existing}${line}\n`);
  } catch {
    // Last-resort sink; nothing more we can do.
  }
}

export function DiagnosticsRunner() {
  const db = useDb();
  const pathname = usePathname();
  const booted = useRef(false);

  useEffect(() => {
    let disposeErrors = () => {};
    void (async () => {
      await loadDiagnosticsEnabled();
      disposeErrors = installErrorHandler(db, { appendFallback: appendCrashFallback });
      pruneEvents(db);
      logEvent(db, { kind: 'app', name: 'app_start', detail: { ...deviceContext() } });
      booted.current = true;
    })();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') {
        logEvent(db, { kind: 'app', name: `app_${state}` });
      }
    });
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      setNetworkContext(state.type, state.isConnected);
      logEvent(db, {
        kind: 'net',
        name: 'connectivity',
        detail: { type: state.type, connected: state.isConnected },
      });
    });

    return () => {
      appStateSub.remove();
      unsubscribeNet();
      disposeErrors();
    };
  }, [db]);

  // Navigation breadcrumbs — "search felt wrong" needs to know where you were.
  useEffect(() => {
    if (!pathname) return;
    logEvent(db, { kind: 'screen', name: pathname });
  }, [db, pathname]);

  return null;
}
