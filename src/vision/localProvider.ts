import { Directory, File, Paths } from 'expo-file-system';

import { VisionError, type VisionProvider } from './provider';
import { RecognitionResult, type ItemCategory } from './types';

/**
 * On-device engine (D10, Q4): ML Kit image labeling with the bundled base
 * model. The ONLY file that knows the ML Kit API (blueprint §3 boundary).
 *
 * Capability note (blueprint §5): generic names only — `brand` and
 * `label_text` are always null and confidence is capped at `medium` per
 * the §6.3 rubric (identifying details are never "clearly visible" to a
 * generic labeler). The native module is loaded lazily so Expo Go builds
 * without it keep working; selecting the engine there fails with a
 * friendly error instead of crashing at import time.
 */
export interface MlKitLabel {
  text: string;
  confidence: number; // 0..1
}

const MIN_CONFIDENCE = 0.4;
const MEDIUM_CONFIDENCE = 0.65;
const MAX_ITEMS = 12;

/** Coarse keyword → category mapping for ML Kit's generic label set. */
const CATEGORY_KEYWORDS: [RegExp, ItemCategory][] = [
  [/drill|saw|grinder|sander|router|power/i, 'power_tool'],
  [/screwdriver|wrench|plier|hammer|tool|spanner|chisel|clamp/i, 'hand_tool'],
  [/screw|nail|bolt|nut|fastener|rivet/i, 'fastener'],
  [/wire|cable|battery|electronic|circuit|plug|socket/i, 'electrical'],
  [/pipe|plumb|valve|hose/i, 'plumbing'],
  [/glue|adhesive|tape|paint|varnish|finish/i, 'adhesive_finish'],
  [/glove|goggle|helmet|mask|safety/i, 'safety'],
  [/ruler|tape measure|measure|level|caliper/i, 'measuring'],
  [/blade|bit|drill bit|disc/i, 'bit_blade_accessory'],
  [/hinge|bracket|handle|knob|hardware|chain|hook/i, 'hardware'],
  [/wood|metal|plastic|lumber|sheet|rod/i, 'material'],
];

export function categoryForLabel(label: string): ItemCategory {
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(label)) return category;
  }
  return 'other';
}

/** Pure mapper from ML Kit labels to the §6.1 contract — unit-tested. */
export function mapLabelsToResult(labels: MlKitLabel[]): RecognitionResult {
  const seen = new Set<string>();
  const items = labels
    .filter((l) => l.confidence >= MIN_CONFIDENCE && l.text.trim().length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .filter((l) => {
      const key = l.text.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ITEMS)
    .map((l) => ({
      name: l.text.trim(),
      brand: null,
      category: categoryForLabel(l.text),
      quantity: 1,
      label_text: null,
      // Rubric cap: a generic labeler never sees identifying details.
      confidence: (l.confidence >= MEDIUM_CONFIDENCE ? 'medium' : 'low') as 'medium' | 'low',
    }));

  return RecognitionResult.parse({
    items,
    scene_notes:
      items.length > 0
        ? 'Identified on-device — names are generic; use a cloud engine to read labels and brands.'
        : 'The on-device model found nothing it recognizes — try the cloud engine.',
  });
}

type LabelFn = (imageUrl: string) => Promise<MlKitLabel[]>;

/** Lazy native import: resolves only when the engine actually runs. */
function loadMlKit(): LabelFn {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/image-labeling') as {
      default: { label: LabelFn };
    };
    return mod.default.label.bind(mod.default);
  } catch {
    throw new VisionError(
      'The on-device engine needs the development build — Expo Go does not include ML Kit. Pick another engine in Settings.',
      'invalid_response',
    );
  }
}

export function createLocalProvider(labelFn?: LabelFn): VisionProvider {
  return {
    async recognize(photosBase64) {
      const label = labelFn ?? loadMlKit();
      // The §5 contract carries base64; ML Kit wants a file URL, so the
      // payload is staged to a scratch file and cleaned up after.
      const dir = new Directory(Paths.cache, 'local-engine');
      if (!dir.exists) dir.create({ intermediates: true });
      const scratch = new File(dir, `scan-${Date.now()}.jpg`);
      try {
        scratch.write(base64ToBytes(photosBase64[0] ?? ''));
        const labels = await label(scratch.uri);
        // On-device is free: no usage is reported (D15).
        return { result: mapLabelsToResult(labels) };
      } catch (err) {
        if (err instanceof VisionError) throw err;
        throw new VisionError(
          `On-device recognition failed: ${err instanceof Error ? err.message : String(err)}`,
          'invalid_response',
        );
      } finally {
        try {
          if (scratch.exists) scratch.delete();
        } catch {
          // scratch cleanup is best-effort
        }
      }
    },
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(base64) : '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
