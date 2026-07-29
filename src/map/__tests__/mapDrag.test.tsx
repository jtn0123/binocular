import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';

import MapScreen from '../../../app/(tabs)/map';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import {
  createBin,
  createLocation,
  createShelf,
  getBin,
  listBinsForShelf,
  type BinRow,
  type ShelfRow,
} from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { setLoggingEnabled } from '../../diagnostics/events';
import { layoutWall, type LayoutOptions, type Wall } from './helpers/wall';

/**
 * The finger-drag, driven end to end.
 *
 * Every other test of this feature stops at one of two edges. `dragGeometry`
 * is unit-tested against hand-written `RowMeasurement[]`. `MapScreen` is
 * tested through taps, with the gesture mocked by a chain that returns itself
 * and drops every handler on the floor. Nothing joins the two — so the part
 * that only exists in the join has never run:
 *
 *   - `useMapFrames.measureRows`, which sums area → well → board → strip
 *     minus the scroll. Its own comment warns that "dropping any link
 *     silently lands a bin on the wrong shelf", and nothing checks it.
 *   - the conversion from a finger position into that same space,
 *   - whether a drag from one card to another ends with the bin in the right
 *     place in the database.
 *
 * That join is the feature. Here it runs: the gesture mock records the real
 * handlers and this file calls them with coordinates derived from a
 * synthetic-but-realistic layout (helpers/wall.tsx).
 *
 * Still out of reach, and still the reason a device is the only proof: that
 * RNGH activates the pan after the hold, and that the worklets survive the UI
 * runtime. What this can prove is that if the gesture fires, the right thing
 * happens.
 */

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRef } = require('react');
  const pass = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    View,
    // Stable across renders, as the real hook is. A stand-in that returns a
    // fresh box each render throws away every write the gesture made and
    // rebuilds the gesture on each render — testing something the app never
    // does.
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    runOnJS: (fn: unknown) => fn,
    withTiming: pass,
    withRepeat: pass,
    withSequence: pass,
    cancelAnimation: () => undefined,
    Easing: { inOut: () => undefined, ease: undefined },
  };
});

/**
 * A gesture mock that keeps what the screen gave it.
 *
 * MapScreen.test.tsx builds the chain from a fixed list of method names, each
 * returning the chain and discarding its argument — right for a file testing
 * the tap path, and exactly why the drag went untested. This one records.
 */
interface Captured {
  enabled: boolean;
  onStart?: (e: GestureEvent) => void;
  onUpdate?: (e: GestureEvent) => void;
  onFinalize?: () => void;
}
interface GestureEvent {
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
}
// `mock`-prefixed so jest's module factory may close over it.
const mockGesture: Captured = { enabled: false };

jest.mock('react-native-gesture-handler', () => {
  /**
   * v3 races two pans on this surface: the drag, and the swipe that pages the
   * wall. They are told apart the same way gesture-handler tells them apart —
   * the drag is the one that waits for a hold — and only the drag's handlers
   * are kept, because the drag is what this file drives.
   */
  const makePan = () => {
    const own = { enabled: false, isDrag: false };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_target, prop) => (arg: unknown) => {
          if (prop === 'enabled') {
            own.enabled = arg === true;
            if (own.isDrag) mockGesture.enabled = own.enabled;
          } else if (prop === 'activateAfterLongPress') {
            own.isDrag = true;
            mockGesture.enabled = own.enabled;
          } else if (typeof arg === 'function' && typeof prop === 'string' && own.isDrag) {
            (mockGesture as unknown as Record<string, unknown>)[prop] = arg;
          }
          return chain;
        },
      },
    );
    return chain;
  };
  return {
    Gesture: { Pan: makePan, Race: (...gestures: unknown[]) => gestures[0] },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    // The shelf strips are gesture-handler's ScrollView; the plain one
    // reports layout and scroll the same way, which is all this needs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ScrollView: require('react-native').ScrollView,
  };
});

// v3 screens pad the status-bar inset themselves; rendered on its own the
// screen has no provider above it, so it gets zero insets here.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: () => undefined,
}));

describe('dragging a bin across the map', () => {
  let db: NodeDbAdapter;
  let shelfA: ShelfRow;
  let shelfB: ShelfRow;
  /** A shelf in a second location, so the area's own offset is never zero. */
  let shelfC: ShelfRow;
  let bins: BinRow[];

  beforeEach(() => {
    mockPush.mockClear();
    for (const k of ['onStart', 'onUpdate', 'onFinalize'] as const) delete mockGesture[k];
    mockGesture.enabled = false;

    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
    const garage = createLocation(db, { name: 'Garage' });
    shelfA = createShelf(db, { locationId: garage.id, name: 'Shelf A' });
    shelfB = createShelf(db, { locationId: garage.id, name: 'Shelf B' });
    bins = [
      createBin(db, { name: 'Bits', shortCode: 'B-001', shelfId: shelfA.id }),
      createBin(db, { name: 'Screws', shortCode: 'B-002', shelfId: shelfA.id }),
      createBin(db, { name: 'Nails', shortCode: 'B-003', shelfId: shelfA.id }),
      createBin(db, { name: 'Wire', shortCode: 'B-004', shelfId: shelfB.id }),
    ];
    // A second area, drawn below the first. Without one, every area offset in
    // the chain is zero and dropping it from the sum changes nothing — which
    // is exactly how a missing link hides.
    const shed = createLocation(db, { name: 'Shed' });
    shelfC = createShelf(db, { locationId: shed.id, name: 'Shelf C' });
    createBin(db, { name: 'Clamps', shortCode: 'B-005', shelfId: shelfC.id });
    createBin(db, { name: 'Rope', shortCode: 'B-006', shelfId: shelfC.id });
  });
  afterEach(() => db.close());

  const openWall = async (opts?: LayoutOptions): Promise<[RenderResult, Wall]> => {
    const screen = await render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );
    const wall = await layoutWall(screen, opts);
    return [screen, wall];
  };

  const at = (p: { x: number; y: number }): GestureEvent => ({
    x: p.x,
    y: p.y,
    // The wall strip is hit-tested in window coordinates. Nothing here aims
    // at it, and putting the finger far away keeps a stray frame from
    // catching a drop meant for the boards.
    absoluteX: p.x + 10_000,
    absoluteY: p.y + 10_000,
  });

  /**
   * One whole drag: hold, travel, release. Each phase gets its own `act`,
   * which is the unhurried case — React has re-rendered between the lift and
   * the release, as it would during a drag that takes a human amount of time.
   */
  const dragFrom = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await act(async () => mockGesture.onStart?.(at(from)));
    await act(async () =>
      mockGesture.onUpdate?.(at({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })),
    );
    await act(async () => mockGesture.onUpdate?.(at(to)));
    await act(async () => mockGesture.onFinalize?.());
  };

  /**
   * The same drag with no render between hold and release. A flick across two
   * neighbouring cards can finish inside one frame, so nothing the drop needs
   * may be merely scheduled at the lift.
   */
  const flickFrom = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await act(async () => {
      mockGesture.onStart?.(at(from));
      mockGesture.onUpdate?.(at(to));
      mockGesture.onFinalize?.();
    });
  };

  const codesOn = (shelf: ShelfRow) =>
    listBinsForShelf(db, shelf.id).map((b) => b.short_code ?? b.id);

  const confirmMove = async (screen: RenderResult) => {
    await fireEvent.press(screen.getByTestId('map-move-confirm-go'));
  };

  // ------------------------------------------------------------------ wiring

  it('builds an enabled gesture, with handlers the screen can be driven by', async () => {
    await openWall();
    expect(mockGesture.enabled).toBe(true);
    expect(typeof mockGesture.onStart).toBe('function');
    expect(typeof mockGesture.onUpdate).toBe('function');
    expect(typeof mockGesture.onFinalize).toBe('function');
  });

  // ---------------------------------------------------------------- the drag

  it('drags a bin in front of another on the same shelf', async () => {
    const [, wall] = await openWall();
    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);

    await dragFrom(wall.onCard('B-003'), wall.frontOf('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  it('completes a drag flicked inside a single frame', async () => {
    const [, wall] = await openWall();

    await flickFrom(wall.onCard('B-003'), wall.frontOf('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  /**
   * Which side of a card you release on decides which side of it the bin
   * lands. It is the difference between "put this before that" and "after",
   * it is the whole of what aiming means during a drag, and it is decided by
   * one `<` in `slotIndex` — worth pinning from the screen, not just the unit.
   */
  it('drops before or after a card depending on which half you release on', async () => {
    const [, wall] = await openWall();

    await dragFrom(wall.onCard('B-003'), wall.frontOf('B-002'));
    expect(codesOn(shelfA)).toEqual(['B-001', 'B-003', 'B-002']);
  });

  it('the other half of the same card puts it after', async () => {
    const [, wall] = await openWall();

    await dragFrom(wall.onCard('B-003'), wall.behindOf('B-002'));
    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
  });

  it('past the last card lands at the end of that shelf, not nowhere', async () => {
    const [, wall] = await openWall();

    await dragFrom(wall.onCard('B-001'), wall.pastEndOf(0));

    expect(codesOn(shelfA)).toEqual(['B-002', 'B-003', 'B-001']);
  });

  it('drags a bin onto another shelf, after confirming', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCard('B-001'), wall.frontOf('B-004'));
    await confirmMove(screen);

    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfB.id);
    expect(codesOn(shelfA)).toEqual(['B-002', 'B-003']);
  });

  it('cancelling the confirm leaves the bin exactly where it was', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCard('B-001'), wall.frontOf('B-004'));
    await fireEvent.press(screen.getByTestId('map-move-cancel'));

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfA.id);
  });

  it('releasing over no shelf at all moves nothing', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCard('B-001'), wall.offWall());

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(screen.queryByTestId('map-move-confirm')).toBeNull();
  });

  it('a hold that starts on bare plank grabs nothing', async () => {
    const [, wall] = await openWall();

    await dragFrom(wall.pastEndOf(0), wall.frontOf('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
  });

  // ------------------------------------------------------- the failure modes

  /**
   * React Native gives no ordering guarantee for `onLayout`, and a child
   * commonly reports before its parent. `measureRows` sums the chain on
   * demand rather than at report time, which is what makes it order-proof —
   * this is the test that says so. Summing at report time instead reads every
   * ancestor as zero and files every card near the top of the wall.
   */
  it.each(['children-first', 'parents-first'] as const)(
    'lands on the right card when layout is reported %s',
    async (order) => {
      const [, wall] = await openWall({ order });

      await dragFrom(wall.onCard('B-003'), wall.frontOf('B-001'));

      expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
    },
  );

  /**
   * Aiming at the middle of a card cannot see a *uniform* vertical error: drop
   * one link out of the chain and every shelf shifts by the same amount, so
   * the finger is still comfortably inside the band it was aimed at — just the
   * wrong part of it. Releasing near a band's edge is what makes a constant
   * offset show up, because a few points of slop is all that is left before
   * the drop belongs to the shelf below.
   *
   * Found by deleting the well's offset from `measureRow` and watching every
   * other test in this file still pass.
   */
  it.each([
    ['top', 4],
    ['bottom', -4],
  ] as const)("a release near a shelf's %s edge still lands on that shelf", async (edge, inset) => {
    const [screen, wall] = await openWall();
    const band = wall.bandOf(0);
    const y = edge === 'top' ? band.top + inset : band.bottom + inset;

    await dragFrom(wall.onCard('B-003'), { x: wall.frontOf('B-001').x, y });

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
    // Landing on the neighbouring shelf would be a re-home, and would ask.
    expect(screen.queryByTestId('map-move-confirm')).toBeNull();
  });

  /**
   * The wall is taller than the screen, so any real move starts scrolled. The
   * finger reports where it is in the viewport; the boards report where they
   * are in the scroll content. Miss that and the drag works perfectly at the
   * top and misses by exactly the scroll distance everywhere else — which is
   * the failure that reads as "sometimes it just doesn't work".
   */
  it('lands on the right card after the wall has been scrolled', async () => {
    const [, wall] = await openWall({ scrollY: 260 });

    await dragFrom(wall.onCard('B-003'), wall.frontOf('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  /**
   * The same reorder, on a rack that is not the first one on the wall.
   *
   * v3 shows one rack at a time, so "further down the wall" means paged to
   * rather than scrolled to — but the point is unchanged: every offset above
   * a card is real here, and a link dropped from the top of the chain is
   * hidden by a first rack whose own offsets are small.
   */
  it('reorders on a rack further along the wall, where every offset is real', async () => {
    const [screen] = await openWall();
    expect(codesOn(shelfC)).toEqual(['B-005', 'B-006']);

    // Page to the Shed, then measure the wall it actually drew.
    await fireEvent.press(screen.getByTestId('map-rack-R2'));
    const wall = await layoutWall(screen);

    await dragFrom(wall.onCard('B-006'), wall.frontOf('B-005'));

    expect(codesOn(shelfC)).toEqual(['B-006', 'B-005']);
  });

  /**
   * The horizontal twin of the band-edge tests, and found the same way — by
   * deleting the well's and the strip's x from `measureRow` and watching
   * everything pass. A uniform sideways error is smaller than half a slot, so
   * aiming at the middle of a card's half cannot see it. Releasing a few
   * points from a card's mid-line can: that line is the boundary between
   * "before this card" and "after", so any constant offset moves the answer.
   */
  it.each([
    ['just left of', -3, ['B-001', 'B-003', 'B-002']],
    ['just right of', 3, ['B-001', 'B-002', 'B-003']],
  ] as const)('releasing %s a card picks the side it is nearest', async (_where, dx, expected) => {
    const [, wall] = await openWall();
    const mid = wall.onCard('B-002');

    await dragFrom(wall.onCard('B-003'), { x: mid.x + dx, y: mid.y });

    expect(codesOn(shelfA)).toEqual([...expected]);
  });

  /*
   * Removed with the thing it tested: shelves no longer scroll sideways.
   *
   * v3 gives a plank a fixed set of slots that share its width, precisely so
   * that a shelf's contents can be counted at a glance instead of scrolled
   * past — so there is no sideways offset left to forget. What that test was
   * really guarding, a constant horizontal error in the chain, is guarded by
   * its neighbour above: releasing three points either side of a card's
   * mid-line is the smallest sideways question the drag can be asked, and any
   * constant offset changes the answer.
   */

  /**
   * A shelf's own band, and the cards on it, have to come out of the same
   * sum. If they drift apart the finger can be inside a row while every card
   * in it reads as elsewhere — a drop that appends instead of inserting, on
   * the right shelf, which looks like the drag simply ignoring where it was
   * aimed.
   */
  it('puts a shelf and its cards in the same space', async () => {
    const [, wall] = await openWall();
    const band = wall.bandOf(0);
    for (const code of ['B-001', 'B-002', 'B-003']) {
      const card = wall.onCard(code);
      expect(card.y).toBeGreaterThanOrEqual(band.top);
      expect(card.y).toBeLessThanOrEqual(band.bottom);
    }
    // And the second shelf is a different band, or "which shelf" is unanswerable.
    expect(wall.bandOf(1).top).toBeGreaterThan(band.bottom);
  });

  /**
   * A gesture the system takes away — an incoming call, the notification
   * shade — fires finalize without a release. The bin must be put down;
   * leaving the map holding one means the next ordinary tap moves a bin the
   * user had forgotten they were carrying.
   */
  it('puts the bin down when the system cancels the gesture', async () => {
    const [screen, wall] = await openWall();

    await act(async () => mockGesture.onStart?.(at(wall.onCard('B-001'))));
    await act(async () => mockGesture.onFinalize?.());

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(screen.queryByTestId('map-move-confirm')).toBeNull();
  });

  /**
   * A finalize with nothing in hand happens for real: the gesture can end
   * before `beginDrag` has run on the JS thread. It must be a no-op rather
   * than a throw — `useMapDrag` says so in a comment, and this holds it to it.
   */
  it('survives a release that never picked anything up', async () => {
    const [, wall] = await openWall();

    await act(async () => mockGesture.onFinalize?.());

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    // And the map still works afterwards.
    await dragFrom(wall.onCard('B-003'), wall.frontOf('B-001'));
    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });
});
