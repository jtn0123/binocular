import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useDb } from '../db/DbProvider';

import { deviceContext, setNetworkContext } from './context';
import { loadDiagnosticsEnabled } from './enabled';
import { CRASH_FALLBACK_FILE, installErrorHandler } from './errorHandler';
import { detectAbnormalExit, logEvent, pruneEvents, RUNTIME_ID } from './events';

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
    // Both of these run in the effect's SYNCHRONOUS prologue, on purpose.
    //
    // Read the previous session's ending before this session records anything:
    // a process killed natively never gets to run the JS crash handler, so the
    // only trace it leaves is a restart with no goodbye. This used to sit
    // behind the `await` below, which meant the navigation breadcrumb effect
    // further down had already written `screen//` by the time it looked — so
    // it never saw the previous session's `app_background` and reported a
    // death on every launch. The detector has to run before the app it is
    // watching starts talking.
    const abnormal = detectAbnormalExit(db);
    // Likewise the error handler: anything thrown while SecureStore resolves
    // was previously unrecorded, and early boot is exactly when a migration
    // failure would throw.
    const disposeErrors = installErrorHandler(db, { appendFallback: appendCrashFallback });

    void (async () => {
      await loadDiagnosticsEnabled();
      pruneEvents(db);
      logEvent(db, {
        kind: 'app',
        name: 'app_start',
        detail: { ...deviceContext(), runtimeId: RUNTIME_ID },
      });
      if (abnormal) {
        logEvent(db, {
          kind: 'crash',
          name: 'previous_session_died',
          detail: {
            message: `The app restarted without shutting down${
              abnormal.lastScreen ? ` — last screen was ${abnormal.lastScreen}` : ''
            }. No JS error was recorded, which points at a native crash.`,
            lastScreen: abnormal.lastScreen,
            lastEventAt: abnormal.lastEventAt,
          },
        });
      }
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
