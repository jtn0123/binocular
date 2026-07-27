import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

/**
 * Map preferences that outlive the screen.
 *
 * There is one, and it is load-bearing. A finger-following drag was built
 * once, shipped to the field phone, and withdrawn the same day: wrapping
 * every cell in its own gesture detector killed the process natively
 * (docs/PLAN.md, "Map customization › Withdrawn"). The redesign uses a single
 * detector for the whole map rather than one per cell, which is the specific
 * thing believed to have caused it — but "believed" is not "tested on the
 * device", so the drag has an off switch that leaves every tap path intact.
 *
 * Turning it off costs no capability: lift-and-place still moves any bin
 * anywhere, and that is the path a screen reader drives regardless.
 *
 * Same best-effort secure-store pattern as capturePrefs.ts and
 * diagnostics/enabled.ts — a preference must never be able to break the map,
 * so every failure falls back to the default rather than throwing.
 */
const KEY = 'binocular.map_prefs';

export interface MapPrefs {
  /** Finger-following drag on top of long-press-to-lift. */
  dragEnabled: boolean;
  /** Slot ticks drawn along the plank. Cosmetic. */
  showTicks: boolean;
}

export const DEFAULT_MAP_PREFS: MapPrefs = {
  dragEnabled: true,
  showTicks: true,
};

const MapPrefsSchema = z.object({
  dragEnabled: z.boolean(),
  showTicks: z.boolean(),
});

export function parseMapPrefs(raw: string | null): MapPrefs {
  if (!raw) return DEFAULT_MAP_PREFS;
  try {
    const parsed = MapPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_MAP_PREFS;
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
