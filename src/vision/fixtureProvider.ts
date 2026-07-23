import type { ScanContext, VisionProvider } from './provider';
import { RecognitionResult } from './types';

/**
 * Canned responses keyed by scan mode, with an artificial delay so loading
 * states are visible. Default provider in development and the only provider
 * automated tests use — the entire app must be demo-able on it.
 */
const FIXTURES: Record<ScanContext['mode'], unknown> = {
  bin_audit: {
    items: [
      {
        name: 'Phillips screwdriver',
        brand: null,
        category: 'hand_tool',
        quantity: 3,
        label_text: null,
        confidence: 'high',
      },
      {
        name: 'Wire nuts',
        brand: 'Ideal',
        category: 'electrical',
        quantity: 1,
        label_text: 'Ideal 341 orange wire connectors, 100 ct',
        confidence: 'high',
      },
      {
        name: 'Tape measure',
        brand: null,
        category: 'measuring',
        quantity: 1,
        label_text: null,
        confidence: 'medium',
      },
      {
        name: 'Needle-nose pliers',
        brand: null,
        category: 'hand_tool',
        quantity: 1,
        label_text: null,
        confidence: 'low',
      },
    ],
    scene_notes: 'Bin is quite full; some items overlap near the back edge.',
  },
  check_in: {
    items: [
      {
        name: 'Cordless drill',
        brand: 'DeWalt',
        category: 'power_tool',
        quantity: 1,
        label_text: null,
        confidence: 'high',
      },
      {
        name: 'Deck screws',
        brand: 'GRK',
        category: 'fastener',
        quantity: 1,
        label_text: 'GRK R4 #9 x 2-1/2 in, 100 ct',
        confidence: 'high',
      },
      {
        name: 'Safety glasses',
        brand: null,
        category: 'safety',
        quantity: 2,
        label_text: null,
        confidence: 'medium',
      },
    ],
    scene_notes: null,
  },
  find_it: {
    items: [
      {
        name: '10mm socket',
        brand: null,
        category: 'hand_tool',
        quantity: 1,
        label_text: null,
        confidence: 'high',
      },
    ],
    scene_notes: null,
  },
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFixtureProvider(opts: { delayMs?: number } = {}): VisionProvider {
  const delayMs = opts.delayMs ?? 1500;
  return {
    async recognize(_photosBase64, ctx) {
      await delay(delayMs);
      // Fixtures pass through the same trust boundary as real responses.
      // No usage: nothing was metered, so nothing is reported (D15).
      return { result: RecognitionResult.parse(FIXTURES[ctx.mode]) };
    },
  };
}
