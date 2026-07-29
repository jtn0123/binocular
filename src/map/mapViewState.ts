import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import type { HeatMode } from '@/db/mapView';

/**
 * Where you were on the wall, so it survives leaving the screen (v3).
 *
 * A stocktake gets interrupted constantly — the phone locks, someone calls,
 * you go and look at a bin — and coming back to R1 with the tray shut every
 * time is a tax on the one job the map exists for. This is view state, not
 * inventory: losing it costs a swipe, so every failure falls back to the
 * default rather than throwing, the same best-effort pattern as
 * `mapPrefs.ts`.
 *
 * The rack is stored by *index* rather than by id on purpose. An id would
 * strand the view on a rack that has since been taken off the wall; an index
 * clamps to whatever is there now, which is always a rack you can see.
 */
const KEY = 'binocular.map_view';

export interface MapViewState {
  /** Which rack along the wall, clamped on load. */
  rackIndex: number;
  /** The lens the cells are tinted by. */
  heat: HeatMode;
  /** Whether the unshelved tray drawer is open. */
  trayOpen: boolean;
}

export const DEFAULT_MAP_VIEW: MapViewState = {
  rackIndex: 0,
  heat: 'none',
  trayOpen: false,
};

/** Per field, so gaining a key later cannot wipe the rest (see mapPrefs.ts). */
const MapViewSchema = z.object({
  rackIndex: z.number().int().min(0).catch(DEFAULT_MAP_VIEW.rackIndex),
  heat: z.enum(['none', 'items', 'scanned']).catch(DEFAULT_MAP_VIEW.heat),
  trayOpen: z.boolean().catch(DEFAULT_MAP_VIEW.trayOpen),
});

export function parseMapView(raw: string | null): MapViewState {
  if (!raw) return DEFAULT_MAP_VIEW;
  try {
    const parsed = MapViewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_MAP_VIEW;
  } catch {
    return DEFAULT_MAP_VIEW;
  }
}

export async function loadMapView(): Promise<MapViewState> {
  try {
    return parseMapView(await SecureStore.getItemAsync(KEY));
  } catch {
    return DEFAULT_MAP_VIEW;
  }
}

export async function saveMapView(state: MapViewState): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(state));
  } catch {
    // Best-effort: the map already has it applied in memory.
  }
}
