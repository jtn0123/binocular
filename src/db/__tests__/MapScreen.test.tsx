import { fireEvent, render } from '@testing-library/react-native';

import MapScreen from '../../../app/map';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';

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
// tap/press path — the one that must always work — is what gets exercised.
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    'activateAfterLongPress',
    'maxPointers',
    'shouldCancelWhenOutside',
    'onStart',
    'onUpdate',
    'onEnd',
  ]) {
    chain[method] = () => chain;
  }
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: () => undefined,
}));

describe('MapScreen renders (D21)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(db, { name: 'Bits', shortCode: 'B-001', shelfId: shelf.id });
    insertItem(db, { binId: bin.id, name: 'Torx bit', category: 'bit_blade_accessory' });
  });
  afterEach(() => db.close());

  it('draws the wall without crashing', async () => {
    const screen = await render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );
    expect(screen.getByTestId('map-cell-B-001')).toBeTruthy();
  });

  it('lifting is idempotent — a second lift of the same bin keeps it held', async () => {
    // On a device BOTH handlers fire for one long press: the pan gesture
    // activates at 300 ms and Pressable's own onLongPress at 500 ms. When
    // lifting toggled, that second call put the bin straight back down —
    // the drag then had nothing to carry and dropping did nothing at all.
    const screen = await render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );
    const cell = screen.getByTestId('map-cell-B-001');

    await fireEvent(cell, 'longPress');
    expect(screen.getByTestId('map-cancel-move')).toBeTruthy();

    await fireEvent(cell, 'longPress');
    expect(screen.getByTestId('map-cancel-move')).toBeTruthy();
  });

  it('tapping the held bin puts it back down', async () => {
    const screen = await render(
      <DbProvider adapter={db}>
        <MapScreen />
      </DbProvider>,
    );
    const cell = screen.getByTestId('map-cell-B-001');

    await fireEvent(cell, 'longPress');
    expect(screen.getByTestId('map-cancel-move')).toBeTruthy();

    await fireEvent.press(cell);
    expect(screen.queryByTestId('map-cancel-move')).toBeNull();
  });
});
