import { fireEvent, render } from '@testing-library/react-native';

import BrowseScreen from '../../../app/(tabs)/browse';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf } from '../../db/queries';
import { runMigrations } from '../../db/schema';

// `mock`-prefixed so jest's module factory may close over them.
const mockPush = jest.fn();
const mockHrefs: string[] = [];

/**
 * The way into the map, from the screen that offers it (D21).
 *
 * `Link` is rendered as a plain pressable that records its href, so the
 * assertion is about where the button actually points — the thing that would
 * break silently if the route were renamed.
 */
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require('react-native');
  return {
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: () => undefined,
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => {
      mockHrefs.push(typeof href === 'string' ? href : JSON.stringify(href));
      return (
        <Pressable accessibilityRole="button" testID={`link-${href}`} onPress={() => mockPush(href)}>
          <Text>{typeof href === 'string' ? href : ''}</Text>
          {children}
        </Pressable>
      );
    },
  };
});

describe('the map button (D21)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    mockPush.mockClear();
    mockHrefs.length = 0;
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    const garage = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: garage.id, name: 'Shelf A' });
    createBin(db, { name: 'Bits', shortCode: 'B-001', shelfId: shelf.id });
  });
  afterEach(() => db.close());

  it('is on the browse screen, and points at the map', async () => {
    const screen = await render(
      <DbProvider adapter={db}>
        <BrowseScreen />
      </DbProvider>,
    );
    expect(screen.getByLabelText('See the workshop as a map')).toBeTruthy();
    expect(mockHrefs).toContain('/map');
  });

  it('opens the map when pressed', async () => {
    const screen = await render(
      <DbProvider adapter={db}>
        <BrowseScreen />
      </DbProvider>,
    );
    await fireEvent.press(screen.getByLabelText('See the workshop as a map'));
    expect(mockPush).toHaveBeenCalledWith('/map');
  });
});
