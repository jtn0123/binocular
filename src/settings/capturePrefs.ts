import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { DEFAULT_CAPTURE_FLOW, type CaptureFlow } from '../scan/captureMode';

/**
 * Camera controls that should survive leaving the capture screen.
 *
 * Field-test finding: torch and zoom lived in component state, so every scan
 * in a dark garage started with the torch off and the zoom back at 1× — the
 * two controls that decide whether a photo is readable at all had to be
 * re-set for every bin on a shelf.
 *
 * Same secure-store pattern as settings.ts and diagnostics/enabled.ts (no
 * new dependency for three booleans-worth of state), and the same
 * best-effort contract: persistence must never break a capture. Stored JSON
 * is parsed through zod, so a corrupted or hand-edited value falls back to
 * defaults instead of pushing junk into the camera props.
 */
const KEY = 'binocular.capture_prefs';

export interface CapturePrefs {
  torch: boolean;
  zoom: number;
  flow: CaptureFlow;
}

export const DEFAULT_CAPTURE_PREFS: CapturePrefs = {
  torch: false,
  zoom: 0,
  flow: DEFAULT_CAPTURE_FLOW,
};

const CapturePrefsSchema = z.object({
  torch: z.boolean(),
  // expo-camera's zoom prop is 0–1; anything else would be a silent no-op.
  zoom: z.number().min(0).max(1),
  flow: z.enum(['review_now', 'keep_shooting']),
});

/** Rounds to the stepper's granularity and clamps into expo-camera's range. */
export function normalizeZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  return Math.round(Math.min(1, Math.max(0, zoom)) * 100) / 100;
}

export function parseCapturePrefs(raw: string | null): CapturePrefs {
  if (!raw) return DEFAULT_CAPTURE_PREFS;
  try {
    const parsed = CapturePrefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_CAPTURE_PREFS;
    return { ...parsed.data, zoom: normalizeZoom(parsed.data.zoom) };
  } catch {
    return DEFAULT_CAPTURE_PREFS;
  }
}

export async function loadCapturePrefs(): Promise<CapturePrefs> {
  try {
    return parseCapturePrefs(await SecureStore.getItemAsync(KEY));
  } catch {
    return DEFAULT_CAPTURE_PREFS;
  }
}

export async function saveCapturePrefs(prefs: CapturePrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify({ ...prefs, zoom: normalizeZoom(prefs.zoom) }),
    );
  } catch {
    // Best-effort: the camera already has the setting applied in memory.
  }
}
