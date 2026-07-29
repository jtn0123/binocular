import { fireEvent, render } from '@testing-library/react-native';
// Namespaced: a bare `react-native` import shares a babel binding with
// `@testing-library/react-native` and the two quietly overwrite each other.
import * as RN from 'react-native';

import { buildMap, type MapArea, type MapInput } from '@/db/mapView';
import type { BinRow, LocationRow, ShelfRow } from '@/db/queries';

import { HitsBar } from '../HitsBar';
import { MapFindBar, type MapFindBarProps } from '../MapBanner';
import { RackPickSheet } from '../RackPickSheet';
import { RackRail } from '../RackRail';
import { RackScrubber, scrollTargetFor, type RackSegment } from '../RackScrubber';
import { ShelfBoard } from '../ShelfBoard';
import { WallSheet } from '../WallSheet';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const pass = (value: unknown) => value;
  return {
    __esModule: true,
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

/**
 * The v3 map chrome, asserted against what actually renders.
 *
 * These read the rendered tree rather than going through the library's
 * queries, because most of what is under test here is *style* — and a style
 * that is wrong only on a device (see the dashed-border note below) is
 * exactly what a behavioural assertion sails straight past.
 */
interface Node {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown[];
}

/** Every node in a rendered tree, depth-first. */
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object') return [];
  const node = tree as Node;
  return [node, ...(node.children ?? []).flatMap(nodes)];
}

function byTestId(tree: unknown, testID: string): Node | null {
  return nodes(tree).find((n) => n.props?.testID === testID) ?? null;
}

/** The flattened style actually handed to the native view. */
function styleOf(node: Node | null): RN.ViewStyle {
  return (RN.StyleSheet.flatten(node?.props?.style as RN.ViewStyle) ?? {}) as RN.ViewStyle;
}

/** Every string of text in a tree, for asserting on copy. */
function textsOf(tree: unknown): string[] {
  return nodes(tree).flatMap((n) =>
    (n.children ?? []).filter((c): c is string => typeof c === 'string'),
  );
}

const draw = async (element: React.ReactElement) => (await render(element)).toJSON();

const loc = (id: string, name: string): LocationRow => ({ id, name, created_at: '', sort_order: 0 });
const shelf = (id: string, locationId: string, name: string, capacity: number | null): ShelfRow => ({
  id,
  location_id: locationId,
  name,
  created_at: '',
  capacity,
  sort_order: 0,
});
const bin = (id: string, shelfId: string | null, code: string): BinRow =>
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

const input = (over: Partial<MapInput> = {}): MapInput => ({
  locations: [],
  shelves: [],
  bins: [],
  itemCounts: new Map(),
  ...over,
});

/** One rack with a filled slot and a free one, so both cell states are drawn. */
const oneRack = (): MapArea[] =>
  buildMap(
    input({
      locations: [loc('l1', 'R1 · Garage')],
      shelves: [shelf('s1', 'l1', 'Top', 2)],
      bins: [bin('b1', 's1', 'B-001')],
    }),
  );

/**
 * Borders that toggle between dashed and solid.
 *
 * On Android a view that has rendered `borderStyle: 'dashed'` keeps it when
 * the next style simply omits the key — there is no prop change to send, so
 * the native view never hears about it. The symptom was a bin that stayed
 * dotted for the rest of the session after one drag, and it is invisible in
 * a snapshot because the style object is right; only the device is wrong.
 *
 * So every base style a dashed variant sits on top of restates `solid`, and
 * these pin that down where it would otherwise rot silently.
 */
describe('borders that have been dashed once', () => {
  const rail = (carrying: boolean) => (
    <RackRail
      side="next"
      code="R2"
      more={false}
      carrying={carrying}
      hot={false}
      onPress={() => {}}
      onFrame={() => {}}
    />
  );

  it('the rack rail says solid when it is not armed', async () => {
    const tree = await draw(rail(false));
    expect(styleOf(byTestId(tree, 'map-rail-next')).borderStyle).toBe('solid');
  });

  it('is dashed while armed, so the two states really do differ', async () => {
    const tree = await draw(rail(true));
    expect(styleOf(byTestId(tree, 'map-rail-next')).borderStyle).toBe('dashed');
  });

  it('the find bar says solid, next to the dashed carrying one', async () => {
    const tree = await draw(<MapFindBar {...findProps({ searching: true, query: 'nope' })} />);
    expect(styleOf(byTestId(tree, 'map-banner-nohits')).borderStyle).toBe('solid');
  });

  it('a filled wall cell says solid, beside the dashed free one', async () => {
    const tree = await draw(<WallSheet {...wallProps(oneRack())} />);
    // Cells carry no handle of their own, so they are picked out of the tree
    // by the size only they have.
    const borders = nodes(tree)
      .map(styleOf)
      .filter((s) => s.height === 11 && s.borderWidth === 1)
      .map((s) => s.borderStyle);
    expect(borders).toContain('solid');
    expect(borders).toContain('dashed');
  });
});

describe('the find bar', () => {
  it('draws nothing at all when the map is at rest', async () => {
    // The design has no idle banner: the wall is the content, and a standing
    // line of chrome explaining that the wall is a wall costs a whole shelf.
    expect(await draw(<MapFindBar {...findProps()} />)).toBeNull();
  });
});

describe('the rack scrubber', () => {
  const segments = (n: number): RackSegment[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `r${i}`,
      code: `R${i + 1}`,
      label: `Rack ${i + 1}`,
      fill: '0/4',
      ratio: 0,
      room: 4,
      hits: 0,
      current: i === 0,
    }));

  const scrubber = (n: number, editing: boolean) =>
    draw(
      <RackScrubber
        segments={segments(n)}
        editing={editing}
        onGo={() => {}}
        onOpenWall={() => {}}
        onAddRack={() => {}}
      />,
    );

  /**
   * The strip is the whole wall at a glance, which only works if the
   * segments divide up the width they have. The version before this gave
   * each one its natural size inside a scroller: the wall ran off the end at
   * three racks, and "+ RACK" — pinned outside so it stayed reachable —
   * sheared the last rack in half.
   *
   * These pin the sharing itself, because the symptom was pure layout: every
   * segment was present, correct and carrying the right text, and the rack
   * you could not see was one you could not see *on the device only*.
   */
  it('lets the content stretch to the strip, so segments share rather than queue', async () => {
    const strip = byTestId(await scrubber(3, true), 'map-rack-strip');
    const content = RN.StyleSheet.flatten(
      strip?.props?.contentContainerStyle as RN.ViewStyle,
    ) as RN.ViewStyle;
    // Without this the row is only as wide as its contents and every `flex`
    // below divides up nothing.
    expect(content.flexGrow).toBe(1);
  });

  it('gives the rack you are on a double share and the rest an equal one', async () => {
    const tree = await scrubber(3, true);
    const here = styleOf(byTestId(tree, 'map-rack-R1'));
    const other = styleOf(byTestId(tree, 'map-rack-R2'));
    expect(here.flexGrow).toBe(2);
    expect(other.flexGrow).toBe(1);
    expect(other.flexBasis).toBe(0);
  });

  it.each([1, 3, 8])('draws every rack and "+ RACK" together at %i racks', async (count) => {
    const strip = byTestId(await scrubber(count, true), 'map-rack-strip');
    // Both live in the strip, as the design has them — nothing is pinned over
    // the top of anything else.
    expect(byTestId(strip, `map-rack-R${count}`)).not.toBeNull();
    expect(byTestId(strip, 'map-add-rack')).not.toBeNull();
  });

  it('keeps "+ RACK" its own size while the racks give way', async () => {
    // It is a command, not a place: shrinking it to fit more wall in would
    // eventually leave a button too small to hit.
    expect(styleOf(byTestId(await scrubber(8, true), 'map-add-rack')).flexShrink).toBe(0);
  });

  it('offers it only while the wall is being edited', async () => {
    expect(byTestId(await scrubber(3, false), 'map-add-rack')).toBeNull();
    expect(byTestId(await scrubber(3, true), 'map-add-rack')).not.toBeNull();
  });

  /**
   * Keeping your place on a wall too long to fit.
   *
   * Only reachable on a real strip that has actually overflowed, so it is
   * asserted as arithmetic — the alternative is a screen test that has to
   * fake three layout passes to make one decision.
   */
  describe('scrolling a rack into view', () => {
    const seen = { x: 100, width: 60 };

    it('stays put when the rack is already on screen', async () => {
      // A strip that re-centres on every page is a strip you cannot keep your
      // place in, even when it never showed you anything new.
      expect(scrollTargetFor(seen, 300, 50)).toBeNull();
    });

    it('comes back left for a rack that has scrolled off behind you', async () => {
      expect(scrollTargetFor(seen, 300, 200)).toBe(92);
    });

    it('goes right for one past the far edge, landing it just inside', async () => {
      // 160 is its right edge; 300 wide viewport; 8 of daylight after it.
      expect(scrollTargetFor(seen, 100, 0)).toBe(68);
    });

    it('never scrolls to a negative offset for the first rack', async () => {
      expect(scrollTargetFor({ x: 0, width: 60 }, 300, 20)).toBe(0);
    });

    it('does nothing before the strip has been measured', async () => {
      // Layout has not run yet, so every answer would be arithmetic on zero.
      expect(scrollTargetFor(seen, 0, 0)).toBeNull();
      expect(scrollTargetFor(undefined, 300, 0)).toBeNull();
    });
  });
});

describe('the hits bar', () => {
  it('takes only the height it needs', async () => {
    // A horizontal ScrollView in a flex column claims every spare pixel: the
    // chips ended up marooned mid-screen with the shelves crushed under them.
    // Nothing about the content was wrong, so only the style catches it.
    const tree = await draw(
      <HitsBar hereCount={2} elsewhere={[{ index: 1, code: 'R2', count: 1 }]} onGo={() => {}} />,
    );
    expect(styleOf(byTestId(tree, 'map-hits-bar')).flexGrow).toBe(0);
  });

  it('names the rack the other matches are on', async () => {
    const tree = await draw(
      <HitsBar hereCount={2} elsewhere={[{ index: 1, code: 'R2', count: 3 }]} onGo={() => {}} />,
    );
    expect(textsOf(tree).join(' ')).toContain('2 hits here');
    expect(byTestId(tree, 'map-hit-R2')).not.toBeNull();
  });

  it('says nothing at all when every match is on this rack', async () => {
    const tree = await draw(<HitsBar hereCount={3} elsewhere={[]} onGo={() => {}} />);
    expect(byTestId(tree, 'map-hits-bar')).toBeNull();
  });
});

describe('the rack picker', () => {
  it('says which racks it is offering, and why only those', async () => {
    const tree = await draw(
      <RackPickSheet
        request={{
          code: 'B-001',
          name: 'Electrical connectors',
          which: 'Racks right of R1',
          candidates: oneRack().map((area, index) => ({ index, area })),
        }}
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    // Without this the sheet asks "Which rack?" and never says why these are
    // the only ones on offer.
    expect(textsOf(tree)).toContain('Racks right of R1');
  });
});

function findProps(over: Partial<MapFindBarProps> = {}): MapFindBarProps {
  return {
    focused: null,
    findCount: 0,
    findIndex: 0,
    onStepFocus: () => {},
    searching: false,
    query: '',
    wantedButMissing: false,
    ...over,
  };
}

function wallProps(racks: MapArea[]) {
  return {
    racks,
    currentIndex: 0,
    matchedBinIds: [] as string[],
    editing: false,
    onToggleEdit: () => {},
    onClose: () => {},
    onGo: () => {},
    onMove: () => {},
    onRename: () => {},
    onRemove: () => {},
    onAddRack: () => {},
    trayLabel: 'Not on a shelf · 0 bins',
  };
}

/**
 * The per-shelf width stepper.
 *
 * Both directions used to clamp against the *bin count* rather than the
 * current width, which made each button do the opposite of what it said in
 * exactly the situations someone would be pressing it: on an over-full shelf
 * and on an unsized one.
 */
describe('sizing one shelf', () => {
  const shelfRow = (capacity: number | null, bins: number) =>
    buildMap(
      input({
        locations: [loc('l1', 'R1 · Garage')],
        shelves: [shelf('s1', 'l1', 'Top', capacity)],
        bins: Array.from({ length: bins }, (_, i) => bin(`b${i}`, 's1', `B-00${i}`)),
      }),
    )[0].rows[0];

  /** Rendered, not serialised: these are presses, and presses need the tree. */
  const board = async (
    capacity: number | null,
    bins: number,
    onWidth: (w: number) => void = () => {},
  ) =>
    render(
      <ShelfBoard
        row={shelfRow(capacity, bins)}
        lit={false}
        landingIndex={null}
        draggingBinId={null}
        heldBinId={null}
        selectedBinIds={[]}
        matchedBinIds={[]}
        focusedBinId={null}
        settlingBinId={null}
        showTicks={false}
        editing
        heatFor={() => null}
        onCellPress={() => {}}
        onCellLongPress={() => {}}
        onDropAtEnd={() => {}}
        onEditShelf={() => {}}
        onAddBin={() => {}}
        onRename={() => {}}
        onWidth={onWidth}
        onRemove={null}
        overflow={null}
      />,
    );

  /** Presses a stepper and reports every width it asked for. */
  const nudge = async (
    which: 'shrink' | 'grow',
    capacity: number | null,
    bins: number,
  ): Promise<number[]> => {
    const asked: number[] = [];
    const screen = await board(capacity, bins, (w) => asked.push(w));
    await fireEvent.press(screen.getByTestId(`map-shelf-${which}-s1`));
    return asked;
  };

  it('takes one slot off a roomy shelf', async () => {
    expect(await nudge('shrink', 4, 1)).toEqual([3]);
  });

  it('adds one to a shelf with room to grow', async () => {
    expect(await nudge('grow', 4, 1)).toEqual([5]);
  });

  it('will not widen a shelf when asked to narrow it', async () => {
    // Five bins in two declared slots. "One slot fewer" once read
    // `max(1, 5, 1)` and set the width to five — widening the shelf, and
    // taking the over-full warning with it.
    expect(await nudge('shrink', 2, 5)).toEqual([]);
  });

  it('will not size an unsized shelf below what it is already holding', async () => {
    // Nine bins, no declared width. "One slot more" read `min(8, 10)` and
    // declared eight — manufacturing the over-full state outright.
    expect(await nudge('grow', null, 9)).toEqual([]);
  });

  it('stops at the widest a rack goes rather than pretending', async () => {
    expect(await nudge('grow', 8, 1)).toEqual([]);
  });

  it('never declares fewer slots than the shelf is holding', async () => {
    // Three bins in three slots: there is nowhere down to go.
    expect(await nudge('shrink', 3, 3)).toEqual([]);
  });

  it('sizes an unsized shelf from what it holds, upwards', async () => {
    expect(await nudge('grow', null, 2)).toEqual([3]);
  });
});
