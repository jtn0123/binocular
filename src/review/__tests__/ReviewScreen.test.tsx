import { fireEvent, render } from '@testing-library/react-native';

import { DbProvider } from '../../db/DbProvider';
import type { NodeDbAdapter } from '../../db/nodeAdapter';
import { createNodeAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  getBin,
  getScan,
  insertItem,
  insertScan,
  itemsForBin,
  updateScanStatus,
  type BinRow,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { ReviewScreen } from '../ReviewScreen';

// The retry path calls the scan flow (expo-file-system etc.) — not under test.
jest.mock('../../scan/scanFlow', () => ({
  processScan: jest.fn(),
}));

const FIXTURE = {
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
  scene_notes: 'Bin is quite full.',
};

describe('ReviewScreen (blueprint §6.3 + §8.1)', () => {
  let db: NodeDbAdapter;
  let bin: BinRow;

  function makeScan(raw: unknown = FIXTURE): string {
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///p.jpg', binId: bin.id });
    updateScanStatus(db, scan.id, 'review', { rawResponse: JSON.stringify(raw) });
    return scan.id;
  }

  async function renderScreen(scanId: string, onDone = jest.fn()) {
    const screen = await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={scanId} onDone={onDone} />
      </DbProvider>,
    );
    return { onDone, screen };
  }

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    bin = createBin(db, { name: 'Hand tools', shortCode: 'B-003' });
  });
  afterEach(() => {
    db.close();
  });

  it('pre-selects high and medium chips; low is de-selected until tapped', async () => {
    const { screen } = await renderScreen(makeScan());
    expect(screen.getByTestId('chip-detected-0').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('chip-detected-1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('chip-detected-2').props.accessibilityState.selected).toBe(false);
    // medium chip carries the amber dot
    expect(screen.getAllByTestId('amber-dot')).toHaveLength(1);
  });

  it('shows the scene notes banner', async () => {
    const { screen } = await renderScreen(makeScan());
    expect(screen.getByText('Bin is quite full.')).toBeTruthy();
  });

  it('save persists exactly the selected chips, with source_scan_id and bin updates', async () => {
    const scanId = makeScan();
    const { screen, onDone } = await renderScreen(scanId);
    await fireEvent.press(screen.getByTestId('save'));

    const items = itemsForBin(db, bin.id);
    expect(items.map((i) => i.name).sort()).toEqual(['Phillips screwdriver', 'Tape measure']);
    expect(items.every((i) => i.source_scan_id === scanId)).toBe(true);
    expect(getScan(db, scanId)?.status).toBe('confirmed');
    const updated = getBin(db, bin.id);
    expect(updated?.last_scanned_at).not.toBeNull();
    expect(updated?.cover_photo_uri).toBe('file:///p.jpg');
    expect(onDone).toHaveBeenCalledWith(bin.id);
  });

  it('a tapped low chip is included in the save', async () => {
    const { screen } = await renderScreen(makeScan());
    await fireEvent.press(screen.getByTestId('chip-detected-2'));
    await fireEvent.press(screen.getByTestId('save'));
    expect(itemsForBin(db, bin.id).map((i) => i.name)).toContain('Needle-nose pliers');
  });

  it('discard leaves inventory untouched and marks the scan discarded', async () => {
    insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
    const scanId = makeScan();
    const { screen } = await renderScreen(scanId);
    await fireEvent.press(screen.getByTestId('discard'));
    expect(itemsForBin(db, bin.id)).toHaveLength(1);
    expect(getScan(db, scanId)?.status).toBe('discarded');
  });

  describe('merge diff on a non-empty bin (§8.1 step 6)', () => {
    it('a "not seen" existing item survives save unless explicitly tapped for removal', async () => {
      const hammer = insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
      const { screen } = await renderScreen(makeScan());

      // default is merge; hammer is unmatched -> "not seen", defaults to keep
      expect(screen.getByTestId(`existing-${hammer.id}`).props.accessibilityState.selected).toBe(
        true,
      );
      await fireEvent.press(screen.getByTestId('save'));

      const names = itemsForBin(db, bin.id).map((i) => i.name);
      expect(names).toContain('Hammer'); // never silently deleted
    });

    it('an explicitly tapped "not seen" item is removed on save', async () => {
      const hammer = insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
      const { screen } = await renderScreen(makeScan());
      await fireEvent.press(screen.getByTestId(`existing-${hammer.id}`));
      await fireEvent.press(screen.getByTestId('save'));
      expect(itemsForBin(db, bin.id).map((i) => i.name)).not.toContain('Hammer');
    });

    it('a detected item matching an existing one lands in "still here" and is not duplicated', async () => {
      insertItem(db, { binId: bin.id, name: 'Phillips screwdriver', category: 'hand_tool' });
      const { screen } = await renderScreen(makeScan());
      expect(screen.getByText('Still here')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('save'));
      const matches = itemsForBin(db, bin.id).filter((i) => i.name === 'Phillips screwdriver');
      expect(matches).toHaveLength(1);
    });

    it('replace mode replaces the full contents with the selected chips', async () => {
      insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
      const { screen } = await renderScreen(makeScan());
      await fireEvent.press(screen.getByTestId('mode-replace'));
      await fireEvent.press(screen.getByTestId('save'));
      const names = itemsForBin(db, bin.id)
        .map((i) => i.name)
        .sort();
      expect(names).toEqual(['Phillips screwdriver', 'Tape measure']);
    });
  });

  it('manually added items are saved', async () => {
    const { screen } = await renderScreen(makeScan({ items: [], scene_notes: null }));
    await fireEvent.press(screen.getByTestId('add-item'));
    await fireEvent.changeText(screen.getByTestId('editor-name'), 'Zip ties');
    await fireEvent.changeText(screen.getByTestId('editor-quantity'), '50');
    await fireEvent.press(screen.getByTestId('editor-save'));
    await fireEvent.press(screen.getByTestId('save'));
    const items = itemsForBin(db, bin.id);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Zip ties');
    expect(items[0].quantity).toBe(50);
  });
});
