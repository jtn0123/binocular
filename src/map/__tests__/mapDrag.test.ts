import { renderHook } from '@testing-library/react-native';

import { buildMap, withTray, type MapArea } from '@/db/mapView';
import type { BinRow, LocationRow, ShelfRow } from '@/db/queries';
import type { RowMeasurement } from '../dragGeometry';
import type { MapFrames } from '../useMapFrames';

import { useMapDrag } from '../useMapDrag';

/**
 * Captured pan handlers, so a test can play a gesture without a touchscreen.
 * `mock`-prefixed so jest's module factory may close over it.
 */
const mockPans: {
  handlers: Record<string, (e?: unknown) => void>;
  config: Record<string, unknown>;
}[] = [];

jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const pan: {
        handlers: Record<string, unknown>;
        config: Record<string, unknown>;
        [key: string]: unknown;
      } = { handlers: {}, config: {} };
      for (const method of [
        'activateAfterLongPress',
        'activeOffsetX',
        'enabled',
        'failOffsetY',
        'maxPointers',
        'shouldCancelWhenOutside',
      ]) {
        pan[method] = (value: unknown) => {
          pan.config[method] = value;
          return pan;
        };
      }
      for (const method of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
        pan[method] = (fn: unknown) => {
          pan.handlers[method] = fn;
          return pan;
        };
      }
      mockPans.push(pan as (typeof mockPans)[number]);
      return pan;
    },
  },
}));

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => ({ value: initial }),
  // The handlers are ordinary functions off the UI thread here, so a captured
  // `runOnJS(fn)` is just `fn` and calling it runs the real drag logic.
  runOnJS: (fn: unknown) => fn,
  withTiming: (value: unknown) => value,
}));

/**
 * The drag, played as a sequence of gesture callbacks.
 *
 * Every prior test of this feature asserted on geometry or on the press path,
 * and that is exactly how **a hold that never moved putting the bin straight
 * back down** shipped green: the arithmetic was right, the presses were right,
 * and the wiring between the gesture and them was not. These drive the
 * handlers the gesture would drive, against measurements the screen would
 * have reported, and assert on what the map screen is told happened.
 */
describe('a drag, from finger down to finger up', () => {
  /** Shelf A at y 0–100 with two 100pt cards; Shelf B at y 120–220, empty. */
  const rows: RowMeasurement[] = [
    {
      shelfId: 's1',
      top: 0,
      bottom: 100,
      cards: [
        { binId: 'b1', x: 0, width: 100 },
        { binId: 'b2', x: 100, width: 100 },
      ],
    },
    { shelfId: 's2', top: 120, bottom: 220, cards: [] },
  ];

  const loc = (id: string, name: string): LocationRow => ({
    id,
    name,
    created_at: '',
    sort_order: 0,
  });
  const shelf = (id: string, locationId: string, name: string): ShelfRow => ({
    id,
    location_id: locationId,
    name,
    created_at: '',
    capacity: 4,
    sort_order: 0,
  });
  const bin = (id: string, shelfId: string, code: string): BinRow =>
    ({
      id,
      shelf_id: shelfId,
      short_code: code,
      name: code,
      cover_photo_uri: null,
      last_scanned_at: null,
      created_at: '',
      sort_order: 0,
    }) as BinRow;

  // `withTray`, as the screen does: the tray is a legitimate drop target, and
  // without its row in `areas` the drag treats a drop on it as a stale frame.
  const areas: MapArea[] = withTray(
    buildMap({
      locations: [loc('l1', 'R1 · Garage')],
      shelves: [shelf('s1', 'l1', 'Top'), shelf('s2', 'l1', 'Lower')],
      bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002')],
      itemCounts: new Map(),
    }),
  );

  /** Only the four the drag actually reads; the rest would be dead weight. */
  const frames = {
    getScrollY: () => 0,
    getViewport: () => ({ x: 0, y: 0, width: 360, height: 600 }),
    scrollTo: () => undefined,
    measureRows: () => rows,
  } as unknown as MapFrames;

  let onLift: jest.Mock;
  let onDrop: jest.Mock;
  let onEdgeDrop: jest.Mock;
  let onCancel: jest.Mock;
  let onDragStart: jest.Mock;

  const point = (x: number, y: number) => ({ x, y, absoluteX: x, absoluteY: y });

  /** Renders the hook and hands back a way to play the gesture. */
  const start = async (enabled = true) => {
    mockPans.length = 0;
    const { result } = await renderHook(() =>
      useMapDrag({ areas, enabled, frames, onLift, onDrop, onEdgeDrop, onCancel, onDragStart }),
    );
    const handlers = mockPans[0].handlers;
    // From here on the updates come from gesture callbacks, which on a device
    // arrive from outside React entirely. Saying so keeps the run's output
    // free of act warnings that would otherwise bury a real failure.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    return {
      down: (x: number, y: number) => handlers.onStart?.(point(x, y)),
      move: (x: number, y: number) => handlers.onUpdate?.(point(x, y)),
      up: () => handlers.onFinalize?.(),
      pan: mockPans[0],
      drag: result.current,
    };
  };

  beforeEach(() => {
    onLift = jest.fn();
    onDrop = jest.fn();
    onEdgeDrop = jest.fn();
    onCancel = jest.fn();
    onDragStart = jest.fn();
  });
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('picks up the bin under the finger', async () => {
    const gesture = await start();
    gesture.down(50, 50);

    expect(onLift).toHaveBeenCalledWith('b1');
    expect(onDragStart).toHaveBeenCalled();
  });

  it('picks up nothing when the finger came down on bare shelf', async () => {
    const gesture = await start();
    gesture.down(50, 150);
    expect(onLift).not.toHaveBeenCalled();
  });

  /**
   * The regression this whole file exists for.
   *
   * The pan activates on the hold itself and the edge auto-scroll ticks the
   * tracker on a clock, so a motionless finger still resolves the slot it is
   * sitting on. Releasing then took the ordinary drop path, `planDrop`
   * correctly answered "this changes nothing", and the bin went straight back
   * down — which silently removed lift-and-place, the one path that must
   * always work and the only one a screen reader drives.
   */
  it('a hold that never travelled is a lift, not a drop', async () => {
    const gesture = await start();
    gesture.down(50, 50);
    gesture.up();

    expect(onLift).toHaveBeenCalledWith('b1');
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a hand that only trembled is still a lift', async () => {
    // Nobody holds a phone perfectly still, least of all wearing gloves.
    const gesture = await start();
    gesture.down(50, 50);
    gesture.move(52, 53);
    gesture.up();

    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('travelling far enough and landing on a slot is a drop', async () => {
    const gesture = await start();
    gesture.down(50, 50);
    gesture.move(250, 50);
    gesture.up();

    // Past the last remaining card on that shelf, so the end of the row.
    expect(onDrop).toHaveBeenCalledWith('b1', { shelfId: 's1', index: 1 });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('carries the bin to another shelf', async () => {
    const gesture = await start();
    gesture.down(50, 50);
    gesture.move(50, 160);
    gesture.up();

    expect(onDrop).toHaveBeenCalledWith('b1', { shelfId: 's2', index: 0 });
  });

  it('released over nothing, the bin goes back where it came from', async () => {
    const gesture = await start();
    gesture.down(50, 50);
    gesture.move(50, 400);
    gesture.up();

    expect(onCancel).toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('a finger up with nothing in hand does nothing at all', async () => {
    // The gesture can finalize before `beginDrag` ever ran on the JS thread.
    const gesture = await start();
    gesture.up();

    expect(onLift).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('hands the switch straight to the gesture when the drag is turned off', async () => {
    // The setting exists because this gesture once killed the process on a
    // field phone, so "off" has to mean the recognizer never runs — not that
    // the handlers politely decline once it has.
    expect((await start(false)).pan.config.enabled).toBe(false);
    expect((await start(true)).pan.config.enabled).toBe(true);
  });

  it('waits for a real hold before it claims the touch', async () => {
    // A pan that activated on movement alone would steal every scroll of the
    // rack panel and every swipe along the wall.
    expect((await start()).pan.config.activateAfterLongPress).toBeGreaterThanOrEqual(300);
  });

  describe('the side rails', () => {
    const railFrame = { x: 320, y: 200, width: 40, height: 200 };

    it('sends the bin to the next rack instead of dropping it here', async () => {
      const gesture = await start();
      gesture.drag.setEdgeFrame('next', railFrame);
      gesture.down(50, 50);
      gesture.move(340, 300);
      gesture.up();

      expect(onEdgeDrop).toHaveBeenCalledWith('b1', 'next');
      expect(onDrop).not.toHaveBeenCalled();
    });

    it('forgets a rail once it is gone, so it cannot keep catching drops', async () => {
      // A rail unmounts when you reach the end of the wall. Its last known
      // frame used to stay registered and go on swallowing drops over empty
      // space, which read as bins vanishing into the edge of the screen.
      const gesture = await start();
      gesture.drag.setEdgeFrame('next', railFrame);
      gesture.drag.setEdgeFrame('next', null);
      gesture.down(50, 50);
      gesture.move(340, 300);
      gesture.up();

      expect(onEdgeDrop).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('the tray, which lives outside the map’s own scroll', () => {
    it('takes a bin dropped onto it, with no slot to speak of', async () => {
      const gesture = await start();
      gesture.drag.setWallFrame('unshelved', { x: 0, y: 500, width: 360, height: 60 });
      gesture.down(50, 50);
      gesture.move(180, 520);
      gesture.up();

      expect(onDrop).toHaveBeenCalledWith('b1', { shelfId: null });
    });

    it('ignores a shelf frame left behind by a shelf that has been deleted', async () => {
      // Frames outlive the row that reported them until the next layout.
      const gesture = await start();
      gesture.drag.setWallFrame('gone-shelf', { x: 0, y: 500, width: 360, height: 60 });
      gesture.down(50, 50);
      gesture.move(180, 520);
      gesture.up();

      expect(onDrop).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
