import { fireEvent, render } from '@testing-library/react-native';

import MapScreen from '../../../app/(tabs)/map';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  createLocation,
  createShelf,
  getBin,
  insertItem,
  listBinsForShelf,
  listLocations,
  listShelves,
  setShelfCapacity,
  type BinRow,
  type ShelfRow,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { listEvents, setLoggingEnabled } from '../../diagnostics/events';

// Reanimated reaches for the native worklets module on import, which does not
// exist under jest — and its own shipped mock re-enters that same path. Only
// the ghost is animated, so a hand-rolled stand-in is enough.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const pass = (value: unknown) => value;
  return {
    __esModule: true,
    // gesture-handler builds its GestureDetector wrapper from this on import.
    default: { View, createAnimatedComponent: (c: unknown) => c },
    View,
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    runOnJS: (fn: unknown) => fn,
    withTiming: pass,
    withRepeat: pass,
    withSequence: pass,
    cancelAnimation: () => undefined,
    Easing: { inOut: () => undefined, ease: undefined },
  };
});

// The gesture layer is native; under jest the detector is a passthrough so the
// tap/press path — the one that must always work, and the only one left when
// the drag is switched off — is what gets exercised. The drag itself is
// covered by src/map/__tests__/dragGeometry.test.ts, which is why that
// arithmetic lives outside this screen.
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    'activateAfterLongPress',
    'activeOffsetX',
    'enabled',
    'failOffsetY',
    'maxPointers',
    'shouldCancelWhenOutside',
    'onBegin',
    'onStart',
    'onUpdate',
    'onEnd',
    'onFinalize',
  ]) {
    chain[method] = () => chain;
  }
  return {
    // `Race` is how the drag and the swipe share the surface; here it only has
    // to hand back something a detector will accept.
    Gesture: { Pan: () => chain, Race: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Tab screens draw their own title bar, which pads the status-bar inset. In
// the app expo-router provides the safe-area context; a screen rendered on
// its own has none, so it gets zero insets here.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// `mock`-prefixed so jest's module factory may close over them.
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
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

  const renderMap = () =>
    render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );

  beforeEach(() => {
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
      // activates at 400 ms and Pressable's onLongPress at 500 ms. When
      // lifting toggled, that second call put the bin straight back down —
      // the drag had nothing to carry and dropping did nothing at all.
      const screen = await renderMap();
      const cell = screen.getByTestId('map-cell-B-001');

      await fireEvent(cell, 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();

      await fireEvent(cell, 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();
    });

    it('a lifted bin stays lifted — the map never puts it back down for you', async () => {
      // On a device the pan activates on the hold itself, so releasing used
      // to run the whole drag: the edge auto-scroll had already resolved the
      // slot under the motionless finger, planDrop correctly said "this
      // changes nothing", and the bin went straight back on the shelf. The
      // visible symptom was that holding a bin did nothing at all, which
      // silently removed lift-and-place whenever the drag was switched on.
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      expect(screen.getByTestId('map-cancel-move')).toBeTruthy();
      expect(screen.getByText(/Moving B-001/)).toBeTruthy();
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

    it('dropping onto a free slot fills the gap', async () => {
      setShelfCapacity(db, shelfB.id, 4);
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-003'), 'longPress');
      // Slot 0 is the first free one after the single bin on Shelf B.
      await fireEvent.press(screen.getByTestId(`map-gap-${shelfB.id}-0`));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfB.id);
    });
  });

  /**
   * A drop that crosses shelves re-homes the bin — the §8.5 move — so it
   * asks first, and the sheet has to say enough to answer with.
   */
  describe('the cross-shelf confirm', () => {
    const moveWireOntoShelfA = async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-003'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-cell-B-001'));
      return screen;
    };

    it('asks before re-homing, and says where from and where to', async () => {
      const screen = await moveWireOntoShelfA();
      expect(screen.getByTestId('map-move-confirm')).toBeTruthy();
      expect(screen.getByText(/Garage › Shelf B/)).toBeTruthy();
      expect(screen.getByText(/Garage › Shelf A, slot 1/)).toBeTruthy();
      // Nothing has been written yet.
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfB.id);
    });

    it('says the printed label does not follow the bin', async () => {
      // People reasonably assume the tag on the tub carries its address. It
      // carries an id, and a move that silently invalidated labels would be
      // the worst kind of surprise.
      const screen = await moveWireOntoShelfA();
      expect(screen.getByText(/the printed label on the bin does not change/)).toBeTruthy();
    });

    it('confirming performs the move', async () => {
      const screen = await moveWireOntoShelfA();
      await fireEvent.press(screen.getByTestId('map-move-confirm-go'));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfA.id);
    });

    it('cancelling leaves the bin exactly where it was, and puts it down', async () => {
      const screen = await moveWireOntoShelfA();
      await fireEvent.press(screen.getByTestId('map-move-cancel'));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfB.id);
      expect(screen.queryByTestId('map-cancel-move')).toBeNull();
    });

    it('warns when the destination is already full rather than refusing', async () => {
      setShelfCapacity(db, shelfA.id, 2);
      const screen = await moveWireOntoShelfA();
      expect(screen.getByText(/only has 2 slots/)).toBeTruthy();
    });

    it('undo restores the shelf a bin was moved away from', async () => {
      const screen = await moveWireOntoShelfA();
      await fireEvent.press(screen.getByTestId('map-move-confirm-go'));
      expect(getBin(db, bins[2].id)?.shelf_id).toBe(shelfA.id);

      await fireEvent.press(screen.getByTestId('map-undo'));
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

  /**
   * Searching the map searches the bins drawn on it. Item-level search is
   * Home's job and arrives as `highlight`, which wins.
   */
  describe('searching the shelves', () => {
    const search = async (text: string) => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-search-toggle'));
      await fireEvent.changeText(screen.getByTestId('map-search-input'), text);
      return screen;
    };

    it('finds a bin by name and says where it is', async () => {
      const screen = await search('screw');
      expect(screen.getByText(/B-002 · Screws/)).toBeTruthy();
      expect(screen.getByText('Garage › Shelf A')).toBeTruthy();
    });

    it('finds a bin by its short code too', async () => {
      const screen = await search('B-003');
      expect(screen.getByText(/B-003 · Wire/)).toBeTruthy();
    });

    it('walks every match, not just the first', async () => {
      // 'B-00' matches all three; the banner has to be steppable.
      const screen = await search('B-00');
      expect(screen.getByText('1/3')).toBeTruthy();
    });

    it('says plainly when nothing on the shelves matches', async () => {
      const screen = await search('nothing like this');
      expect(screen.getByTestId('map-banner-nohits')).toBeTruthy();
    });

    it('closing the search puts the map back to idle', async () => {
      const screen = await search('screw');
      // The Find chip is a toggle now: the same control opens and closes it.
      await fireEvent.press(screen.getByTestId('map-search-toggle'));
      expect(screen.queryByTestId('map-search-input')).toBeNull();
      expect(screen.queryByText(/B-002 · Screws/)).toBeNull();
    });
  });

  describe('the whole wall', () => {
    it('is out of the way until asked for', async () => {
      const screen = await renderMap();
      expect(screen.queryByTestId('wall-rack-R1')).toBeNull();

      await fireEvent.press(screen.getByTestId('map-wall-toggle'));
      expect(screen.getByTestId('wall-rack-R1')).toBeTruthy();
    });

    it('draws every rack, and says which one you are standing at', async () => {
      const shed = createLocation(db, { name: 'R2 · Shed' });
      createShelf(db, { locationId: shed.id, name: 'Shed top' });
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-wall-toggle'));
      expect(screen.getByTestId('wall-rack-R1')).toBeTruthy();
      expect(screen.getByTestId('wall-rack-R2')).toBeTruthy();
      expect(screen.getByLabelText(/Rack R1, Garage, 3 of 3 slots used/)).toBeTruthy();
    });

    it('tapping a rack pages the map to it and closes', async () => {
      const shed = createLocation(db, { name: 'R2 · Shed' });
      createShelf(db, { locationId: shed.id, name: 'Shed top' });
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-wall-toggle'));
      await fireEvent.press(screen.getByTestId('wall-rack-R2'));
      expect(screen.queryByTestId('wall-rack-R2')).toBeNull();
      // The wall shows one rack at a time, so R1's bins are no longer drawn.
      expect(screen.queryByTestId('map-cell-B-001')).toBeNull();
      expect(screen.getByText('Shed top')).toBeTruthy();
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
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfA.id}`));
      await fireEvent.changeText(screen.getByTestId('map-shelf-name'), 'Top shelf');
      await fireEvent(screen.getByTestId('map-shelf-name'), 'submitEditing');
      expect(screen.getByText('Top shelf')).toBeTruthy();
    });

    it('an empty shelf name is refused rather than saved', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfA.id}`));
      await fireEvent.changeText(screen.getByTestId('map-shelf-name'), '   ');
      await fireEvent(screen.getByTestId('map-shelf-name'), 'submitEditing');
      expect(listShelves(db, shelfA.location_id).find((s) => s.id === shelfA.id)?.name).toBe(
        'Shelf A',
      );
    });

    it('a shelf can be given a slot count, and free slots appear', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfB.id}`));
      // Shelf B is unsized with one bin on it, so the first step up sizes it
      // to two — honest about what is already there rather than guessing.
      await fireEvent.press(screen.getByTestId('map-slots-up'));
      expect(screen.getByTestId('map-slots-count')).toHaveTextContent('2');
      await fireEvent.press(screen.getByTestId('map-sheet-done'));
      expect(screen.getByTestId(`map-gap-${shelfB.id}-0`)).toBeTruthy();
    });

    it('deleting a shelf keeps its bins, in the unshelved tray', async () => {
      // Blueprint §11: inventory is never silently lost. The shelf is
      // furniture; the bins that stood on it are not.
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfB.id}`));
      await fireEvent.press(screen.getByTestId('map-sheet-delete-shelf'));

      expect(listShelves(db, shelfB.location_id).map((s) => s.id)).not.toContain(shelfB.id);
      expect(getBin(db, bins[2].id)?.shelf_id).toBeNull();
      expect(screen.getByTestId('map-cell-B-003')).toBeTruthy();
    });

    it('says a deleted shelf is gone for good rather than offering a dead UNDO', async () => {
      // Recreating a shelf would mint a new id and every bin that pointed at
      // the old one would lie, so the deletion really is final. A button that
      // only dismisses itself would read as a move that silently failed.
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfB.id}`));
      await fireEvent.press(screen.getByTestId('map-sheet-delete-shelf'));

      expect(screen.getByTestId('map-undo-snackbar')).toBeTruthy();
      expect(screen.queryByTestId('map-undo')).toBeNull();
      expect(screen.getByText(/removed for good/)).toBeTruthy();
    });

    it('warns what deleting a shelf will do to the bins on it', async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfB.id}`));
      expect(screen.getByText(/moves its 1 bin to the unshelved tray/)).toBeTruthy();
    });
  });

  /**
   * The v3 wall: one rack at a time, with the scrubber and the side rails as
   * the ways along it. Every assertion here is against the database or the
   * controls, never the arrangement the screen happens to be holding.
   */
  describe('the wall of racks', () => {
    /** A second rack, one shelf, one bin — enough to page between. */
    const addShed = () => {
      const shed = createLocation(db, { name: 'R2 · Shed' });
      const top = createShelf(db, { locationId: shed.id, name: 'Shed top', capacity: 4 });
      const bin = createBin(db, { name: 'Nails', shortCode: 'B-004', shelfId: top.id });
      return { shed, top, bin };
    };

    it('draws one rack at a time, not the whole wall stacked up', async () => {
      addShed();
      const screen = await renderMap();
      expect(screen.getByTestId('map-cell-B-001')).toBeTruthy();
      expect(screen.queryByTestId('map-cell-B-004')).toBeNull();
    });

    it('the scrubber pages to another rack', async () => {
      addShed();
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-rack-R2'));
      expect(screen.getByTestId('map-cell-B-004')).toBeTruthy();
      expect(screen.queryByTestId('map-cell-B-001')).toBeNull();
    });

    it('a side rail walks you along the wall when your hands are empty', async () => {
      addShed();
      const screen = await renderMap();
      expect(screen.queryByTestId('map-rail-prev')).toBeNull();
      await fireEvent.press(screen.getByTestId('map-rail-next'));
      expect(screen.getByTestId('map-cell-B-004')).toBeTruthy();
      expect(screen.getByTestId('map-rail-prev')).toBeTruthy();
    });

    it('a rail with a bin in hand sends it to the next rack, after confirming', async () => {
      const { top } = addShed();
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-rail-next'));

      // Leaving the rack is a re-home, so the §8.5 confirm still asks.
      expect(screen.getByTestId('map-move-confirm')).toBeTruthy();
      expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfA.id);

      await fireEvent.press(screen.getByTestId('map-move-confirm-go'));
      expect(getBin(db, bins[0].id)?.shelf_id).toBe(top.id);
    });

    it('asks which rack when the direction alone cannot say', async () => {
      addShed();
      const loft = createLocation(db, { name: 'R3 · Loft' });
      createShelf(db, { locationId: loft.id, name: 'Loft top', capacity: 4 });
      const screen = await renderMap();

      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-rail-next'));
      expect(screen.getByTestId('rack-pick-sheet')).toBeTruthy();
      expect(screen.getByTestId('rack-pick-R2')).toBeTruthy();
      expect(screen.getByTestId('rack-pick-R3')).toBeTruthy();
      // Nothing is written until one is chosen.
      expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfA.id);

      await fireEvent.press(screen.getByTestId('rack-pick-R3'));
      expect(getBin(db, bins[0].id)?.shelf_id).not.toBe(shelfA.id);
    });

    it('says where the other matches are rather than looking empty-handed', async () => {
      addShed();
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-search-toggle'));
      await fireEvent.changeText(screen.getByTestId('map-search-input'), 'Nails');
      expect(screen.getByTestId('map-hits-bar')).toBeTruthy();
      expect(screen.getByTestId('map-hit-R2')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('map-hit-R2'));
      expect(screen.getByTestId('map-cell-B-004')).toBeTruthy();
    });
  });

  describe('shaping a rack', () => {
    const enterEdit = async () => {
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-edit-toggle'));
      return screen;
    };

    it('the columns stepper sizes every shelf in the rack at once', async () => {
      const screen = await enterEdit();
      await fireEvent.press(screen.getByTestId('rack-cols-up'));
      const shelves = listShelves(db, shelfA.location_id);
      expect(shelves.map((s) => s.capacity)).toEqual([3, 3]);
    });

    it('never shrinks a shelf below the bins already standing on it', async () => {
      // The number describes the shelf; shrinking past its contents would
      // only manufacture an "over" warning about something nobody did.
      setShelfCapacity(db, shelfA.id, 2);
      setShelfCapacity(db, shelfB.id, 2);
      const screen = await enterEdit();
      await fireEvent.press(screen.getByTestId('rack-cols-down'));
      expect(listShelves(db, shelfA.location_id).map((s) => s.capacity)).toEqual([2, 1]);
    });

    it('the rows stepper adds a shelf to the bottom of the rack', async () => {
      const screen = await enterEdit();
      await fireEvent.press(screen.getByTestId('rack-rows-up'));
      const shelves = listShelves(db, shelfA.location_id);
      expect(shelves.map((s) => s.name)).toEqual(['Shelf A', 'Shelf B', 'New shelf']);
    });

    it('the rows stepper only ever removes an empty shelf', async () => {
      const screen = await enterEdit();
      // Both shelves hold bins, so the control is dead rather than dangerous.
      expect(screen.getByTestId('rack-rows-down')).toBeDisabled();
      expect(listShelves(db, shelfA.location_id)).toHaveLength(2);
    });

    it("a shelf's own remove button takes that shelf off, not the last empty one", async () => {
      // The stepper works from the bottom up; a button attached to a shelf
      // has to mean the shelf it is attached to, or edit mode silently
      // deletes the wrong furniture.
      const top = createShelf(db, { locationId: shelfA.location_id, name: 'Empty top' });
      const bottom = createShelf(db, { locationId: shelfA.location_id, name: 'Empty bottom' });
      const screen = await enterEdit();
      await fireEvent.press(screen.getByLabelText('Remove Empty top'));

      const left = listShelves(db, shelfA.location_id).map((s) => s.id);
      expect(left).not.toContain(top.id);
      expect(left).toContain(bottom.id);
    });

    it('a rack can be renamed without renumbering the wall', async () => {
      const screen = await enterEdit();
      await fireEvent.press(screen.getByTestId('rack-rename'));
      await fireEvent.changeText(screen.getByTestId('rack-rename-input'), 'Back wall');
      await fireEvent(screen.getByTestId('rack-rename-input'), 'submitEditing');
      // "Garage" had no code of its own, so it takes the positional one.
      expect(listLocations(db)[0].name).toBe('R1 · Back wall');
    });

    it('adding a rack puts a whole one up and pages to it', async () => {
      const screen = await enterEdit();
      await fireEvent.press(screen.getByTestId('map-add-rack'));
      const added = listLocations(db).find((l) => l.name.startsWith('R2'));
      expect(added).toBeTruthy();
      expect(listShelves(db, added!.id).map((s) => s.name)).toEqual([
        'Top',
        'Upper',
        'Lower',
        'Bottom',
      ]);
      expect(screen.queryByTestId('map-cell-B-001')).toBeNull();
    });
  });

  describe('moving a stack of bins', () => {
    it('is reachable from a lifted bin, and picks it up as the first of the stack', async () => {
      const screen = await renderMap();
      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-select-more'));

      // Picking, not holding: the next tap on a bin means "also this one".
      expect(screen.queryByTestId('map-cancel-move')).toBeNull();
      expect(screen.getByText('1 bin picked')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('map-cell-B-002'));
      expect(screen.getByText('2 bins picked')).toBeTruthy();
    });

    it('picks several and lands them together, in one undo', async () => {
      setShelfCapacity(db, shelfB.id, 4);
      const screen = await renderMap();

      await fireEvent(screen.getByTestId('map-cell-B-001'), 'longPress');
      await fireEvent.press(screen.getByTestId('map-select-more'));
      await fireEvent.press(screen.getByTestId('map-cell-B-002'));
      await fireEvent.press(screen.getByTestId('map-move-picked'));
      await fireEvent.press(screen.getByTestId(`map-gap-${shelfB.id}-0`));

      expect(listBinsForShelf(db, shelfB.id).map((b) => b.short_code)).toEqual([
        'B-003',
        'B-001',
        'B-002',
      ]);
      expect(listBinsForShelf(db, shelfA.id)).toHaveLength(0);

      // One move, so one undo — not two that have to be pressed in order.
      await fireEvent.press(screen.getByTestId('map-undo'));
      expect(listBinsForShelf(db, shelfA.id).map((b) => b.short_code)).toEqual([
        'B-001',
        'B-002',
      ]);
    });
  });

  describe('the unshelved tray', () => {
    it('stays shut until there is a reason to open it', async () => {
      const loose = createBin(db, { name: 'Loose', shortCode: 'B-009', shelfId: null });
      const screen = await renderMap();
      expect(screen.queryByTestId(`map-cell-${loose.short_code}`)).toBeNull();

      await fireEvent.press(screen.getByTestId('map-tray-toggle'));
      expect(screen.getByTestId('map-cell-B-009')).toBeTruthy();
    });

    it('opens itself when bins land in it, so they never look deleted', async () => {
      // §11: inventory is never silently lost — including from the screen.
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId(`map-edit-shelf-${shelfB.id}`));
      await fireEvent.press(screen.getByTestId('map-sheet-delete-shelf'));
      expect(screen.getByTestId('map-cell-B-003')).toBeTruthy();
    });
  });

  describe('an over-full shelf', () => {
    it('offers the way out instead of only complaining', async () => {
      setShelfCapacity(db, shelfA.id, 1);
      setShelfCapacity(db, shelfB.id, 4);
      const screen = await renderMap();
      expect(screen.getByText(/2\/1 — over/)).toBeTruthy();

      await fireEvent.press(screen.getByTestId(`map-over-fix-${shelfA.id}`));
      // Crossing shelves, so it still asks before re-homing.
      await fireEvent.press(screen.getByTestId('map-move-confirm-go'));
      expect(listBinsForShelf(db, shelfA.id).map((b) => b.short_code)).toEqual(['B-001']);
      expect(getBin(db, bins[1].id)?.shelf_id).toBe(shelfB.id);
    });
  });

  describe('arranging the wall itself', () => {
    it('nudging a rack along the wall is persisted, not just drawn', async () => {
      createLocation(db, { name: 'R2 · Shed' });
      createShelf(db, {
        locationId: listLocations(db)[1].id,
        name: 'Shed top',
        capacity: 4,
      });
      const screen = await renderMap();
      await fireEvent.press(screen.getByTestId('map-wall-toggle'));
      await fireEvent.press(screen.getByTestId('wall-edit-toggle'));
      await fireEvent.press(screen.getByTestId('wall-move-right-R1'));

      expect(listLocations(db).map((l) => l.name)).toEqual(['R2 · Shed', 'Garage']);
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
});
