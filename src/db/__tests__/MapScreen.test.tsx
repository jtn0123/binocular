import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, BackHandler } from 'react-native';

import MapScreen from '../../../app/map';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  createLocation,
  createShelf,
  getBin,
  insertItem,
  listBinsForShelf,
  setShelfCapacity,
  type BinRow,
  type ShelfRow,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { listEvents, setLoggingEnabled } from '../../diagnostics/events';

// Reanimated reaches for the native worklets module on import, which does not
// exist under jest — and its own shipped mock re-enters that same path. The
// screen only needs the chip to render, so a hand-rolled stand-in is enough.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    // gesture-handler builds its GestureDetector wrapper from this on import.
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    runOnJS: (fn: unknown) => fn,
  };
});

// The gesture layer is native; under jest the detector is a passthrough so the
// tap/press path — the one that must always work, and the one a screen reader
// drives — is what gets exercised.
//
// The chain is a Proxy rather than a fixed list of methods on purpose: it
// returns itself for anything, so adding a builder call to the real gesture
// cannot silently break every test in this file. It also cannot tell us
// anything about whether the gesture works on a device — see the note at the
// top of app/map.tsx.
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: () => () => chain,
    },
  );
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

// `mock`-prefixed so jest's module factory may close over them.
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: () => undefined,
}));

/**
 * The map screen driven the way a thumb drives it (D21).
 *
 * Every prior test of this feature was of the pure model, which is why a
 * long press that lifted a bin and immediately put it down shipped green.
 * These press the actual controls.
 */
describe('the map screen, driven by presses', () => {
  let db: NodeDbAdapter;
  let shelfA: ShelfRow;
  let shelfB: ShelfRow;
  let bins: BinRow[];

  /**
   * A cross-shelf drop is the §8.5 move, so it asks first. Answering "Move"
   * is what a thumb does; leaving the alert unanswered is what the previous
   * version of this test accidentally did, which is why it looked like the
   * move had silently failed.
   */
  const confirmMoves = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Move')?.onPress?.();
  });

  const renderMap = () =>
    render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );

  beforeEach(() => {
    confirmMoves.mockClear();
    mockPush.mockClear();
    mockParams = {};
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
    const garage = createLocation(db, { name: 'Garage' });
    shelfA = createShelf(db, { locationId: garage.id, name: 'Shelf A' });
    shelfB = createShelf(db, { locationId: garage.id, name: 'Shelf B' });
    bins = [
      createBin(db, { name: 'Bits', shortCode: 'B-001', shelfId: shelfA.id }),
      createBin(db, { name: 'Screws', shortCode: 'B-002', shelfId: shelfA.id }),
      createBin(db, { name: 'Wire', shortCode: 'B-003', shelfId: shelfB.id }),
    ];
    insertItem(db, { binId: bins[0].id, name: 'Torx bit', category: 'bit_blade_accessory' });
  });
  afterEach(() => db.close());

  it('draws a cell for every bin', async () => {
    const screen = await renderMap();
    for (const code of ['B-001', 'B-002', 'B-003']) {
      expect(screen.getByTestId(`map-cell-${code}`)).toBeTruthy();
    }
  });

  it('tapping a bin opens it — the map is still a way in', async () => {
    const screen = await renderMap();
    await fireEvent.press(screen.getByTestId('map-cell-B-002'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/bin/[id]', params: { id: bins[1].id } });
  });

  describe('lifting and placing', () => {
    it('lifting is idempotent — a second lift of the same bin keeps it held', async () => {
      // On a device BOTH handlers fire for one long press: the pan gesture
      // activates at 300 ms and Pressable's onLongPress at 500 ms. When
      // lifting toggled, that second call put the bin straight back down —
      // the drag had nothing to carry and dropping did nothing at all.
      const screen = await renderMap();
      const cell = screen.getByTestId('map-cell-B-001');

      await fireEvent(cell, 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();

      await fireEvent(cell, 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();
    });

    it('tapping the held bin puts it back down', async () => {
      const screen = await renderMap();
      const cell = screen.getByTestId('map-cell-B-001');
      await fireEvent(cell, 'longPress');
      await fireEvent.press(cell);
      expect(screen.queryByTestId('map-cancel-move')).toBeNull();
    });

    it('the cancel button puts it back down too', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cancel-move'));
      expect(screen.queryByTestId('map-cancel-move')).toBeNull();
    });

    it('a held bin does not navigate when another bin is tapped — it moves', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-002'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      // Same shelf: reordered silently, and emphatically not a navigation.
      expect(mockPush).not.toHaveBeenCalled();
      expect(listBinsForShelf(db, shelfA.id).map((b) => b.short_code)).toEqual(['B-002', 'B-001']);
    });

    it('a same-shelf reorder is persisted, not just drawn', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-002'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      // Re-open the screen from the database: the order must survive.
      const reopened = await renderMap();
      const codes = ['B-001', 'B-002'].map((c) => reopened.getByTestId(`map-cell-${c}`));
      expect(codes).toHaveLength(2);
      expect(getBin(db, bins[1].id)?.sort_order).toBe(0);
    });

    it('records the move, so an unexpected one can be traced', async () => {
      // The map writes the same shelf_id every breadcrumb reads, so without
      // this there is no evidence a bin was moved here rather than anywhere.
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-002'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));

      const move = listEvents(db, 20).find((e) => e.kind === 'organize');
      expect(move?.name).toBe('bin_reordered');
      expect(JSON.parse(move?.detail ?? '{}')).toMatchObject({ bin: 'B-002', position: 0 });
    });

    it('offers an undo, and it puts the bin back where it came from', async () => {
      // A move is one press away; without this, reversing it means working
      // out where the bin actually came from.
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-002'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      expect(listBinsForShelf(db, shelfA.id).map((b) => b.short_code)).toEqual(['B-002', 'B-001']);

      await fireEvent.press(screen.getByTestId('map-undo'));
      expect(listBinsForShelf(db, shelfA.id).map((b) => b.short_code)).toEqual(['B-001', 'B-002']);
      expect(screen.queryByTestId('map-undo-snackbar')).toBeNull();
    });

    it('a cross-shelf drop asks first, then moves', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-003'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      expect(confirmMoves).toHaveBeenCalledWith(
        'Move bin?',
        expect.stringContaining('Garage › Shelf A'),
        expect.anything(),
      );
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfA.id);
    });

    it('undo restores the shelf a bin was moved away from', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-003'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfA.id);

      await fireEvent.press(screen.getByTestId('map-undo'));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfB.id);
    });

    it('dropping onto a free slot fills the gap', async () => {
      setShelfCapacity(db, shelfB.id, 4);
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-003'), 'longPress');
      // Slot 0 is the first free one after the single bin on Shelf B.
      await fireEvent.press(screen.getByTestId(`map-gap-${shelfB.id}-0`));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfB.id);
    });
  });

  describe('the tint toggle', () => {
    it('explains itself only once a tint is chosen', async () => {
      const screen = await renderMap();
      expect(screen.queryByText(/Brighter amber/)).toBeNull();

      await fireEvent.press(screen.getByTestId('map-heat-items'));
      expect(screen.getByText(/Brighter amber = more items/)).toBeTruthy();

      await fireEvent.press(screen.getByTestId('map-heat-scanned'));
      expect(screen.getByText(/longer since the bin was scanned/)).toBeTruthy();

      await fireEvent.press(screen.getByTestId('map-heat-none'));
      expect(screen.queryByText(/Brighter amber/)).toBeNull();
    });
  });

  describe('highlighting', () => {
    it('names the bin it was asked to find', async () => {
      mockParams = { highlight: bins[0].id };
      const screen = await renderMap();
      expect(screen.getByText('Garage › Shelf A')).toBeTruthy();
    });

    it('walks several matches rather than showing only the first', async () => {
      mockParams = { highlight: `${bins[0].id},${bins[2].id}` };
      const screen = await renderMap();
      expect(screen.getByTestId('map-next-match')).toBeTruthy();
      expect(screen.getByText('1/2')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('map-next-match'));
      expect(screen.getByText('2/2')).toBeTruthy();
      expect(screen.getByText('Garage › Shelf B')).toBeTruthy();
    });

    it('says so plainly when the bin is not on the map', async () => {
      mockParams = { highlight: 'nope' };
      const screen = await renderMap();
      expect(screen.getByText('That bin is not on the map.')).toBeTruthy();
    });
  });

  describe('editing in place', () => {
    it('a new bin can be added to a shelf without leaving the map', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByLabelText('New bin on Shelf B'));
      expect(listBinsForShelf(db, shelfB.id)).toHaveLength(2);
      expect(screen.getByTestId('map-cell-B-004')).toBeTruthy();
    });

    it('a shelf can be renamed from the map', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByLabelText('Rename Shelf A'));
      await fireEvent.changeText(screen.getByTestId('prompt-input'), 'Top shelf');
      await fireEvent.press(screen.getByTestId('prompt-submit'));
      expect(screen.getByText('Top shelf')).toBeTruthy();
    });

    it('a shelf can be given a slot count, and free slots appear', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByLabelText('Set how many slots Shelf B has'));
      await fireEvent.changeText(screen.getByTestId('prompt-input'), '3');
      await fireEvent.press(screen.getByTestId('prompt-submit'));
      // One bin on Shelf B, three slots — two gaps to fill.
      expect(screen.getByTestId(`map-gap-${shelfB.id}-0`)).toBeTruthy();
      expect(screen.getByTestId(`map-gap-${shelfB.id}-1`)).toBeTruthy();
    });
  });

  it('says there is nothing to draw before any bin exists', async () => {
    const empty = createNodeAdapter(':memory:');
    runMigrations(empty);
    try {
      const screen = await render(
        <DbProvider adapter={empty}>
          <MapScreen />
        </DbProvider>,
      );
      expect(screen.getByText(/Nothing to draw yet/)).toBeTruthy();
    } finally {
      empty.close();
    }
  });

  /**
   * The emptiness test used to be `mapSize(areas) === 0`, which counts BINS —
   * so a workshop of shelves with nothing filed yet scored zero and got the
   * one-sentence empty state, hiding the wall it was written to draw and the
   * add-shelf and new-bin controls along with it. `buildMap` deliberately
   * keeps empty shelves on the grounds that "hiding it would make the picture
   * lie"; the screen disagreed with the module it calls.
   */
  it('draws a wall of empty shelves rather than declaring itself empty', async () => {
    db.runSync('DELETE FROM items');
    db.runSync('DELETE FROM bins');
    const screen = await renderMap();

    expect(screen.queryByText(/Nothing to draw yet/)).toBeNull();
    expect(screen.getByText('Shelf A')).toBeTruthy();
    expect(screen.getByText('Shelf B')).toBeTruthy();
    // …and the controls that would let you fill them are still on screen.
    expect(screen.getByLabelText('New bin on Shelf A')).toBeTruthy();
  });

  /**
   * Holding a bin is a mode, and Android's back button is how you leave one.
   * Without this the instinctive escape from an accidental lift was to leave
   * the map entirely, losing your place on the wall.
   */
  it('hardware back puts the held bin down instead of leaving the map', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => {} } as ReturnType<typeof BackHandler.addEventListener>;
      });

    try {
      const screen = await renderMap();
      // Nothing held: back is left alone, so the screen can be exited.
      expect(handlers).toHaveLength(0);

      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();
      expect(handlers).toHaveLength(1);

      // The handler claims the press rather than letting it navigate away…
      let handled = false;
      await act(async () => {
        handled = handlers[handlers.length - 1]();
      });
      expect(handled).toBe(true);
      // …and the bin is down.
      expect(screen.queryByTestId('map-cancel-move')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
