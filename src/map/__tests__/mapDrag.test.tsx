import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { Alert } from 'react-native';

import MapScreen from '../../../app/map';
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
 * Every earlier test of this feature stopped at one of two edges. The geometry
 * tests (dragGeometry.test.ts) prove the arithmetic against hand-written
 * rects. The screen tests (MapScreen.test.tsx) prove the *tap* path, with the
 * gesture mocked away entirely by a Proxy that swallows the handlers. Nothing
 * joined the two — so the parts that only exist in the join were untested:
 *
 *   - whether the rects the screen builds from `onLayout` describe where the
 *     cells actually are,
 *   - whether a finger position is converted into that same space,
 *   - whether a drag from A to B ends with A in front of B in the database.
 *
 * That join is the whole feature. Here it is exercised: the gesture mock
 * captures the real worklet bodies and this file calls them with coordinates
 * derived from a synthetic-but-realistic layout (helpers/wall.tsx).
 *
 * What this still cannot prove: that RNGH activates the pan, that the worklets
 * survive the UI runtime, or that anything renders at 60fps. Those need a
 * device. What it can prove is that if the gesture fires, the right thing
 * happens — which is the half that was silently broken.
 */

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    // Stable across renders, as the real one is. A stand-in that returns a
    // fresh box each render throws away every write the gesture made and
    // silently rebuilds the gesture on each render — so the mock has to hold
    // this property or it tests something the app never does.
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    // Runs the worklet body rather than discarding it, so the ghost's
    // position is checkable. Elsewhere this is stubbed to `{}` — which is why
    // the chip a user actually watches during a drag had no coverage at all.
    useAnimatedStyle: (fn: () => unknown) => fn(),
    runOnJS: (fn: unknown) => fn,
  };
});

/**
 * A gesture mock that keeps what the screen gave it.
 *
 * MapScreen.test.tsx mocks the chain as a Proxy that returns itself and drops
 * every callback on the floor — right for a file testing the tap path, and
 * exactly why the drag went untested. This one records instead, so the
 * handlers the screen actually built can be called.
 */
interface Captured {
  enabled: boolean;
  onStart?: (e: { x: number; y: number }) => void;
  onUpdate?: (e: { x: number; y: number }) => void;
  onEnd?: (e: { x: number; y: number }) => void;
  onFinalize?: () => void;
}
// `mock`-prefixed so jest's module factory may close over it.
const mockGesture: Captured = { enabled: false };

jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) => (arg: unknown) => {
        if (prop === 'enabled') mockGesture.enabled = arg === true;
        else if (typeof arg === 'function' && typeof prop === 'string') {
          (mockGesture as unknown as Record<string, unknown>)[prop] = arg;
        }
        return chain;
      },
    },
  );
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: () => undefined,
}));

// The drag ships off; these tests are about the drag, so it is on.
jest.mock('../../settings/mapPrefs', () => ({
  ...jest.requireActual('../../settings/mapPrefs'),
  loadMapPrefs: () => Promise.resolve({ heat: 'none', drag: true }),
  saveMapPrefs: () => Promise.resolve(),
}));

describe('dragging a bin across the map', () => {
  let db: NodeDbAdapter;
  let shelfA: ShelfRow;
  let shelfB: ShelfRow;
  let bins: BinRow[];

  /** A cross-shelf drop is the §8.5 move, so it asks first; a thumb says yes. */
  const confirmMoves = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Move')?.onPress?.();
  });

  beforeEach(() => {
    confirmMoves.mockClear();
    mockPush.mockClear();
    for (const k of ['onStart', 'onUpdate', 'onEnd', 'onFinalize'] as const) delete mockGesture[k];
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

  /**
   * One whole drag: press, travel, release, and the system's finalize.
   *
   * Each phase gets its own `act`, which is the unhurried case — React has
   * re-rendered between the lift and the release, exactly as it would during
   * a drag that takes a human amount of time.
   */
  const dragFrom = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await act(async () => mockGesture.onStart?.(from));
    // A real drag reports many samples on the way; they must not need to be
    // seen for the drop to be right, but they must not break it either.
    await act(async () =>
      mockGesture.onUpdate?.({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }),
    );
    await act(async () => mockGesture.onUpdate?.(to));
    await act(async () => mockGesture.onEnd?.(to));
    await act(async () => mockGesture.onFinalize?.());
  };

  /**
   * The same drag, with no render between press and release.
   *
   * A flick across two adjacent bins can finish inside a single frame, so the
   * screen cannot assume it has re-rendered — anything the drop needs must be
   * readable at the moment the finger lifts, not merely scheduled.
   */
  const flickFrom = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await act(async () => {
      mockGesture.onStart?.(from);
      mockGesture.onUpdate?.(to);
      mockGesture.onEnd?.(to);
      mockGesture.onFinalize?.();
    });
  };

  const codesOn = (shelf: ShelfRow) =>
    listBinsForShelf(db, shelf.id).map((b) => b.short_code ?? b.id);

  // ------------------------------------------------------------------ wiring

  it('builds an enabled gesture when the setting is on', async () => {
    await openWall();
    expect(mockGesture.enabled).toBe(true);
    expect(typeof mockGesture.onStart).toBe('function');
    expect(typeof mockGesture.onEnd).toBe('function');
  });

  // --------------------------------------------------------------- the drag

  it('drags a bin in front of another on the same shelf', async () => {
    const [, wall] = await openWall();
    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);

    await dragFrom(wall.onCell('B-003'), wall.onCell('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  /**
   * The same move, flicked. A drag between neighbouring bins is short enough
   * to start and finish inside one frame, so the drop must not depend on a
   * render having happened in between — if it reads state that was only
   * scheduled at the lift, a quick drag does nothing at all and a slow one
   * works, which is precisely what "it works sometimes" feels like.
   */
  it('completes a drag flicked inside a single frame', async () => {
    const [, wall] = await openWall();

    await flickFrom(wall.onCell('B-003'), wall.onCell('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  it('drags a bin onto a different shelf, after confirming', async () => {
    const [, wall] = await openWall();

    await dragFrom(wall.onCell('B-001'), wall.onCell('B-004'));

    expect(confirmMoves).toHaveBeenCalled();
    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfB.id);
    expect(codesOn(shelfB)).toEqual(['B-001', 'B-004']);
  });

  it('releasing over a row, not a bin, appends to that shelf', async () => {
    const [, wall] = await openWall();

    // Row 1 is Shelf B; its gap is to the right of its only cell.
    await dragFrom(wall.onCell('B-001'), wall.onRowGap(1));

    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfB.id);
    expect(codesOn(shelfB)).toEqual(['B-004', 'B-001']);
  });

  it('releasing over nothing puts the bin back down and moves nothing', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCell('B-001'), wall.offWall());

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfA.id);
    // And the map is not left in the holding mode with nothing in hand.
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });

  it('releasing on the bin you are carrying is a cancel, not a move', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCell('B-002'), wall.onCell('B-002'));

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });

  it('starting on empty space lifts nothing at all', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.offWall(), wall.onCell('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });

  // ------------------------------------------------------- the failure modes

  /**
   * React Native gives no ordering guarantee for `onLayout`, and in practice
   * a child commonly reports before its parent. The screen sums four nested
   * offsets to place a cell, so if it reads a parent's offset at the moment
   * the *child* reports, every rect is short by the ancestors' contribution —
   * and a drop lands on a different row, or on nothing.
   *
   * Both orders must produce the same wall.
   */
  it.each(['children-first', 'parents-first'] as const)(
    'hit-tests correctly when layout is reported %s',
    async (order) => {
      const [, wall] = await openWall({ order });

      await dragFrom(wall.onCell('B-003'), wall.onCell('B-001'));

      expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
    },
  );

  /**
   * The wall is taller than the screen, so any real move starts scrolled. The
   * finger reports where it is on the *screen*; the rects say where cells are
   * in the *content*. Forget to close that gap and the drag works perfectly
   * at the top of the wall and misses by exactly the scroll distance
   * everywhere else — which is the failure that looks like "sometimes it just
   * doesn't work".
   */
  it('lands on the right cell after the wall has been scrolled', async () => {
    const [, wall] = await openWall({ scrollY: 240 });

    await dragFrom(wall.onCell('B-003'), wall.onCell('B-001'));

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  /**
   * Rects are cached in a ref keyed by bin id and never pruned. After a move
   * the map redraws and every visible cell reports a fresh rect — but a bin
   * that has *left* the row leaves its old rect behind, at coordinates that
   * now belong to whatever slid up into the gap. `cellAt` returns the first
   * rect containing the point, so a stale entry can win over the real one and
   * send the bin to a shelf nobody pointed at.
   */
  it('does not resolve a drop onto a rect left behind by an earlier move', async () => {
    const [screen, wall] = await openWall();

    // B-001 leaves Shelf A for Shelf B. Its old rect is now B-002's place.
    await dragFrom(wall.onCell('B-001'), wall.onCell('B-004'));
    expect(codesOn(shelfA)).toEqual(['B-002', 'B-003']);

    // Re-layout, as the device does after the rows have shifted.
    const after = await layoutWall(screen);

    // Aim at the cell now sitting where B-001 used to be: B-002.
    await dragFrom(after.onCell('B-003'), after.onCell('B-002'));

    // B-003 in front of B-002 — not a second move of B-001, and not a jump
    // to whatever shelf the stale rect pointed at.
    expect(codesOn(shelfA)).toEqual(['B-003', 'B-002']);
    expect(getBin(db, bins[0].id)?.shelf_id).toBe(shelfB.id);
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });

  /**
   * The move banner is fixed chrome above the ScrollView, and it only exists
   * while a bin is held — so lifting one pushes the whole wall down by the
   * banner's height, mid-gesture, under a finger that has not moved. If the
   * screen keeps using the origin it measured before the lift, every drop is
   * off by that height for the rest of the drag.
   */
  it('survives the wall shifting when the move banner appears', async () => {
    const [screen, wall] = await openWall();
    const BANNER_H = 64;

    mockGesture.onStart?.(wall.onCell('B-003'));
    // The banner mounts, the ScrollView is pushed down, and it says so.
    const scroll = screen.getByTestId('map-scroll');
    await fireEvent(scroll, 'layout', {
      nativeEvent: { layout: { x: 0, y: 56 + BANNER_H, width: 400, height: 600 - BANNER_H } },
    });

    // The finger is still over B-001 on screen — which is now BANNER_H lower.
    const target = wall.onCell('B-001');
    mockGesture.onUpdate?.({ x: target.x, y: target.y + BANNER_H });
    mockGesture.onEnd?.({ x: target.x, y: target.y + BANNER_H });
    mockGesture.onFinalize?.();

    expect(codesOn(shelfA)).toEqual(['B-003', 'B-001', 'B-002']);
  });

  // ------------------------------------------------------------- the ghost

  /**
   * The chip that rides under the finger.
   *
   * It is the only feedback during a drag, so if it sits somewhere other than
   * the fingertip the drag feels wrong even when the drop is right — and a
   * user has no way to tell those two failures apart. Its transform is read
   * in gesture space, and the chip is positioned absolutely against the same
   * view the gesture is attached to; those two facts have to agree.
   */
  const ghostAt = (screen: RenderResult) => {
    const style = screen.getByTestId('map-ghost').props.style as unknown[];
    const flat = style.flat(2).filter(Boolean) as { transform?: { [k: string]: number }[] }[];
    const transform = flat.find((s) => s.transform)?.transform ?? [];
    return {
      x: transform.find((t) => 'translateX' in t)?.translateX,
      y: transform.find((t) => 'translateY' in t)?.translateY,
    };
  };

  it('shows no ghost until a drag actually starts', async () => {
    const [screen] = await openWall();
    expect(screen.queryByTestId('map-ghost')).toBeNull();
  });

  it('rides the chip under the fingertip, in the same space the gesture reports', async () => {
    const [screen, wall] = await openWall();
    const grab = wall.onCell('B-002');

    await act(async () => mockGesture.onStart?.(grab));

    // Centred horizontally on the finger, lifted clear of the thumb above it.
    // GHOST_WIDTH 132, GHOST_HEIGHT 40, GHOST_LIFT 28.
    expect(ghostAt(screen)).toEqual({ x: grab.x - 66, y: grab.y - 68 });
  });

  it('names the bin being carried, not whatever was held before', async () => {
    const [screen, wall] = await openWall();

    await act(async () => mockGesture.onStart?.(wall.onCell('B-003')));

    expect(within(screen.getByTestId('map-ghost')).getByText('B-003')).toBeTruthy();
    expect(within(screen.getByTestId('map-ghost')).getByText('Nails')).toBeTruthy();
  });

  it('takes the ghost away once the finger lifts', async () => {
    const [screen, wall] = await openWall();

    await dragFrom(wall.onCell('B-003'), wall.onCell('B-001'));

    expect(screen.queryByTestId('map-ghost')).toBeNull();
  });

  it('takes the ghost away when the system cancels mid-drag', async () => {
    const [screen, wall] = await openWall();

    await act(async () => mockGesture.onStart?.(wall.onCell('B-001')));
    expect(screen.queryByTestId('map-ghost')).not.toBeNull();

    await act(async () => mockGesture.onFinalize?.());
    expect(screen.queryByTestId('map-ghost')).toBeNull();
  });

  /**
   * A gesture the system takes away — an incoming call, the shade pulled down
   * — fires finalize without end. The bin must be put down; leaving the map
   * holding one means the next ordinary tap moves a bin the user had
   * forgotten they were carrying.
   */
  it('puts the bin down when the system cancels the gesture', async () => {
    const [screen, wall] = await openWall();

    mockGesture.onStart?.(wall.onCell('B-001'));
    mockGesture.onFinalize?.();

    expect(codesOn(shelfA)).toEqual(['B-001', 'B-002', 'B-003']);
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });
});
