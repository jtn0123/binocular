import { fireEvent, render } from '@testing-library/react-native';

import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  getBin,
  insertScan,
  itemsForBin,
  listBins,
  updateScanStatus,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { ReviewScreen } from '../ReviewScreen';
import { loadReviewDraft, saveReviewDraft } from '../reviewDraft';

jest.mock('../../scan/scanFlow', () => ({
  processScan: jest.fn(),
}));

const RESULT = {
  items: [
    {
      name: 'Wood glue',
      brand: null,
      category: 'adhesive_finish',
      quantity: 1,
      label_text: null,
      confidence: 'high',
    },
    {
      name: 'Sandpaper',
      brand: null,
      category: 'material',
      quantity: 1,
      label_text: null,
      confidence: 'low',
    },
  ],
  scene_notes: null,
};

describe('review draft persistence (field-test finding: detours lost edits)', () => {
  let db: NodeDbAdapter;

  function makeScan(mode: 'bin_audit' | 'check_in' = 'bin_audit', binId?: string): string {
    const scan = insertScan(db, { mode, photoUri: 'file:///p.jpg', binId: binId ?? null });
    updateScanStatus(db, scan.id, 'review', { rawResponse: JSON.stringify(RESULT) });
    return scan.id;
  }

  async function renderScreen(scanId: string, onDone = jest.fn()) {
    return await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={scanId} onDone={onDone} />
      </DbProvider>,
    );
  }

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('a manually added item survives unmount and remount', async () => {
    const bin = createBin(db, { name: 'Glue bin', shortCode: 'B-001' });
    const scanId = makeScan('bin_audit', bin.id);

    const first = await renderScreen(scanId);
    await fireEvent.press(first.getByTestId('add-item'));
    await fireEvent.changeText(first.getByTestId('editor-name'), 'Clamp');
    await fireEvent.press(first.getByTestId('editor-save'));
    expect(first.getByText('Clamp')).toBeTruthy();
    await first.unmount();

    const second = await renderScreen(scanId);
    expect(second.getByText('Clamp')).toBeTruthy();
    // The AI-detected chips are still there too.
    expect(second.getByText('Wood glue')).toBeTruthy();
  });

  it('chip toggles survive unmount and remount', async () => {
    const bin = createBin(db, { name: 'Glue bin', shortCode: 'B-001' });
    const scanId = makeScan('bin_audit', bin.id);

    const first = await renderScreen(scanId);
    // Include the low-confidence chip (starts unselected).
    await fireEvent.press(first.getByTestId('chip-detected-1'));
    expect(first.getByTestId('chip-detected-1').props.accessibilityState.selected).toBe(true);
    await first.unmount();

    const second = await renderScreen(scanId);
    expect(second.getByTestId('chip-detected-1').props.accessibilityState.selected).toBe(true);
  });

  it('check-in: the picked destination bin survives a detour', async () => {
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-001' });
    const scanId = makeScan('check_in');

    const first = await renderScreen(scanId);
    await fireEvent.press(first.getByTestId(`dest-${bin.id}`));
    await first.unmount();

    const second = await renderScreen(scanId);
    expect(second.getByTestId(`dest-${bin.id}`).props.accessibilityState.selected).toBe(true);
  });

  it('check-in with zero bins: + New bin creates, selects, and enables save', async () => {
    const scanId = makeScan('check_in');
    const onDone = jest.fn();
    const screen = await renderScreen(scanId, onDone);

    expect(screen.getByText('No bins yet — create your first one:')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-bin'));

    const created = listBins(db);
    expect(created).toHaveLength(1);
    expect(created[0].short_code).toBe('B-001');
    expect(created[0].shelf_id).not.toBeNull();

    await fireEvent.press(screen.getByTestId('save'));
    expect(onDone).toHaveBeenCalledWith(created[0].id);
    expect(itemsForBin(db, created[0].id).map((i) => i.name)).toContain('Wood glue');
  });

  it('saving clears the draft; a fresh visit rebuilds from the AI result', async () => {
    const bin = createBin(db, { name: 'Glue bin', shortCode: 'B-001' });
    const scanId = makeScan('bin_audit', bin.id);

    const first = await renderScreen(scanId);
    await fireEvent.press(first.getByTestId('add-item'));
    await fireEvent.changeText(first.getByTestId('editor-name'), 'Clamp');
    await fireEvent.press(first.getByTestId('editor-save'));
    await fireEvent.press(first.getByTestId('save'));
    expect(loadReviewDraft(scanId)).toBeNull();
  });

  it('the draft store caps its size instead of growing forever', () => {
    for (let i = 0; i < 30; i++) {
      saveReviewDraft(`scan-${i}`, { chips: [], keepExisting: {}, mode: 'replace', destBinId: null });
    }
    expect(loadReviewDraft('scan-0')).toBeNull();
    expect(loadReviewDraft('scan-29')).not.toBeNull();
  });
});

describe('round-2 field feedback: rename in review + demo-engine notice', () => {
  let db: NodeDbAdapter;

  function makeScan(mode: 'bin_audit' | 'check_in', binId?: string, engine?: string): string {
    const scan = insertScan(db, { mode, photoUri: 'file:///p.jpg', binId: binId ?? null });
    updateScanStatus(db, scan.id, 'review', { rawResponse: JSON.stringify(RESULT) });
    if (engine) db.runSync('UPDATE scans SET engine = ? WHERE id = ?', [engine, scan.id]);
    return scan.id;
  }

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('shows the demo-engine notice only for fixture scans', async () => {
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001' });
    const fixture = await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={makeScan('bin_audit', bin.id, 'fixture')} onDone={jest.fn()} />
      </DbProvider>,
    );
    expect(fixture.getByTestId('demo-engine-notice')).toBeTruthy();
    await fixture.unmount();

    const cloud = await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={makeScan('bin_audit', bin.id, 'openai')} onDone={jest.fn()} />
      </DbProvider>,
    );
    expect(cloud.queryByTestId('demo-engine-notice')).toBeNull();
  });

  it('audit review: the bin can be renamed right there', async () => {
    const bin = createBin(db, { name: 'Bin B-001', shortCode: 'B-001' });
    const screen = await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={makeScan('bin_audit', bin.id)} onDone={jest.fn()} />
      </DbProvider>,
    );
    await fireEvent.press(screen.getByTestId('rename-bin'));
    await fireEvent.changeText(screen.getByTestId('prompt-input'), 'Old batteries');
    await fireEvent.press(screen.getByTestId('prompt-submit'));
    expect(getBin(db, bin.id)?.name).toBe('Old batteries');
    expect(screen.getByText(/Old batteries/)).toBeTruthy();
  });

  it('check-in review: the selected destination bin can be renamed in place', async () => {
    const bin = createBin(db, { name: 'Bin B-001', shortCode: 'B-001' });
    const screen = await render(
      <DbProvider adapter={db}>
        <ReviewScreen scanId={makeScan('check_in')} onDone={jest.fn()} />
      </DbProvider>,
    );
    await fireEvent.press(screen.getByTestId(`dest-${bin.id}`));
    await fireEvent.press(screen.getByTestId(`rename-dest-${bin.id}`));
    await fireEvent.changeText(screen.getByTestId('prompt-input'), 'Old batteries');
    await fireEvent.press(screen.getByTestId('prompt-submit'));
    expect(getBin(db, bin.id)?.name).toBe('Old batteries');
  });
});
