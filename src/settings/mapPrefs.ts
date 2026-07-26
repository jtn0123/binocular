import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import type { HeatMode } from '../db/mapView';

/**
 * Map view settings that should survive leaving the screen.
 *
 * The tint mode was plain component state seeded to 'none', so it reset on
 * every visit. That is worst for the mode it matters most for: shading cells
 * by time-since-scan is the map's answer to "what have I not looked at in
 * months", which is a question asked across several visits over weeks — and
 * it was the one setting guaranteed to be off every time you arrived.
 *
 * Same secure-store + zod pattern as capturePrefs.ts, and the same
 * best-effort contract: persistence must never break the map. A corrupted or
 * hand-edited value falls back to the default rather than pushing junk into
 * the tint.
 */
const KEY = 'binocular.map_prefs';

export interface MapPrefs {
  heat: HeatMode;
  /**
   * Finger-drag on the map.
   *
   * Default OFF, and that is deliberate rather than timid. A drag layer on
   * this screen killed the app *process* on the field-test phone once
   * already, and the shipped default should be the interaction we know
   * survives — long-press to lift, tap to place. Turning this on is a
   * decision to test something, and there is always a safe state to go back
   * to without waiting for another build.
   */
  drag: boolean;
}

export const DEFAULT_MAP_PREFS: MapPrefs = { heat: 'none', drag: false };

const MapPrefsSchema = z.object({
  heat: z.enum(['none', 'items', 'scanned']),
  // Tolerated as missing: a stored value written before drag existed must not
  // reset the tint the user chose.
  drag: z.boolean().optional(),
});

export function parseMapPrefs(raw: string | null): MapPrefs {
  if (!raw) return DEFAULT_MAP_PREFS;
  try {
    const parsed = MapPrefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_MAP_PREFS;
    return { heat: parsed.data.heat, drag: parsed.data.drag ?? DEFAULT_MAP_PREFS.drag };
  } catch {
    return DEFAULT_MAP_PREFS;
  }
}

export async function loadMapPrefs(): Promise<MapPrefs> {
  try {
    return parseMapPrefs(await SecureStore.getItemAsync(KEY));
  } catch {
    return DEFAULT_MAP_PREFS;
  }
}

export async function saveMapPrefs(prefs: MapPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort: the map already has the setting applied in memory.
  }
}
