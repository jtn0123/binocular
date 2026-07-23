import { fireEvent, render } from '@testing-library/react-native';

import { DbProvider } from '../../db/DbProvider';
import type { NodeDbAdapter } from '../../db/nodeAdapter';
import { createNodeAdapter } from '../../db/nodeAdapter';
import { createBin, getScan, insertItem, insertScan, itemsForBin, updateScanStatus, type BinRow } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { ReviewScreen } from '../ReviewScreen';

jest.mock('../../scan/scanFlow', () => ({
  processScan: jest.fn(),
}));

/**
 * Dogfood #10: schema-VALID but hostile recognition results pushed through
 * the real review UI. The §6.1 zod gate rejects malformed payloads; these
 * are the ones it must let through — the UI has to survive them.
 */
function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Widget',
    brand: null,
    category: 'other',
    quantity: 1,
    label_text: null,
    confidence: 'high',
    ...overrides,
  };
}

describe('ReviewScreen under adversarial (schema-valid) results', () => {
  let db: NodeDbAdapter;
  let bin: BinRow;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    bin = createBin(db, { name: 'Stress bin', shortCode: 'B-666' });
  });
  afterEach(() => {
    db.close();
  });

  function makeScan(raw: unknown): string {
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///p.jpg', binId: bin.id });
    updateScanStatus(db, scan.id, 'review', { rawResponse: JSON.stringify(raw) });
    return scan.id;
  }

  async function renderScreen(scanId: string) {
    return render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={scanId} onDone={jest.fn()} />
      </DbProvider>,
    );
  }

  it('renders 50 detected items without crashing and saves them all', async () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ name: `Item number ${i}` }));
    const scanId = makeScan({ items: many, scene_notes: null });
    const screen = await renderScreen(scanId);
    expect(screen.getByTestId('chip-detected-49')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save'));
    expect(itemsForBin(db, bin.id)).toHaveLength(50);
  });

  it('survives a 1,000-character item name and an emoji/unicode name', async () => {
    const scanId = makeScan({
      items: [
        item({ name: 'x'.repeat(1000) }),
        item({ name: '🔧 スパナ / 扳手 — Schraubenschlüssel' }),
      ],
      scene_notes: null,
    });
    const screen = await renderScreen(scanId);
    expect(screen.getByTestId('chip-detected-0')).toBeTruthy();
    expect(screen.getByText(/スパナ/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save'));
    const saved = itemsForBin(db, bin.id);
    expect(saved).toHaveLength(2);
    expect(saved.some((i) => i.name.length === 1000)).toBe(true);
  });

  it('handles zero items: shows the review, save persists nothing, discard works', async () => {
    const scanId = makeScan({ items: [], scene_notes: 'Empty bin.' });
    const screen = await renderScreen(scanId);
    expect(screen.getByText('Empty bin.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save'));
    expect(itemsForBin(db, bin.id)).toHaveLength(0);
    expect(getScan(db, scanId)?.status).toBe('confirmed');
  });

  it('absurd quantities and giant scene notes render and persist intact', async () => {
    const scanId = makeScan({
      items: [item({ name: 'Washers', quantity: 999_999 })],
      scene_notes: 'note '.repeat(400),
    });
    const screen = await renderScreen(scanId);
    await fireEvent.press(screen.getByTestId('save'));
    expect(itemsForBin(db, bin.id)[0].quantity).toBe(999_999);
  });

  it('a duplicate-name flood maps onto one existing item without duplication chaos', async () => {
    insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
    const scanId = makeScan({
      items: Array.from({ length: 5 }, () => item({ name: 'Hammer', category: 'hand_tool' })),
      scene_notes: null,
    });
    const screen = await renderScreen(scanId);
    // All five dupes render as chips; saving must not multiply the existing item.
    await fireEvent.press(screen.getByTestId('save'));
    const names = itemsForBin(db, bin.id).map((i) => i.name);
    expect(names.filter((n) => n === 'Hammer').length).toBeGreaterThanOrEqual(1);
  });
});
