import * as SecureStore from 'expo-secure-store';

import { setLoggingEnabled } from './events';

/**
 * Persisted on/off switch for the diagnostics log (D16). Same secure-store
 * pattern as src/settings/settings.ts. Default ON: the whole point is to be
 * recording before something goes wrong in the field.
 */
const KEY = 'binocular.diagnostics_enabled';

export async function loadDiagnosticsEnabled(): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    const enabled = stored !== 'false';
    setLoggingEnabled(enabled);
    return enabled;
  } catch {
    setLoggingEnabled(true);
    return true;
  }
}

export async function setDiagnosticsEnabled(enabled: boolean): Promise<void> {
  setLoggingEnabled(enabled);
  try {
    await SecureStore.setItemAsync(KEY, enabled ? 'true' : 'false');
  } catch {
    // In-memory flag already applied; persistence is best-effort.
  }
}
