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

    // The AppState subscription is created inside the async block below, so
    // cleanup may run before it exists — hence the holder and the flag.
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
    let disposed = false;

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

      // Registered here, after `app_start` is on disk, and not beside the
      // other listeners below.
      //
      // `detectAbnormalExit` decides a session died by finding no
      // `app_background` *after* the last `app_start`. Subscribing before
      // that row exists means a backgrounding during the SecureStore await —
      // the user switching away while the app is still opening, which is
      // exactly when they would — records the goodbye too early to count.
      // Next launch then reports a death that never happened, and the whole
      // point of this detector is that it is believed.
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active' || state === 'background') {
          logEvent(db, { kind: 'app', name: `app_${state}` });
        }
      });
      // And if it went to the background while we were waiting, say so now
      // rather than losing the event to the gap.
      if (AppState.currentState === 'background') {
        logEvent(db, { kind: 'app', name: 'app_background' });
      }
      if (disposed) appStateSub.remove();
    })();

    const unsubscribeNet = NetInfo.addEventListener((state) => {
      setNetworkContext(state.type, state.isConnected);
      logEvent(db, {
        kind: 'net',
        name: 'connectivity',
        detail: { type: state.type, connected: state.isConnected },
      });
    });

    return () => {
      disposed = true;
      appStateSub?.remove();
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
