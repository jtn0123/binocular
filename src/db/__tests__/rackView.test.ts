import {
  areaFill,
  buildMap,
  composeRackName,
  nextRackCode,
  openRowOf,
  overflowTarget,
  planMultiDrop,
  rackCodeOf,
  rackLabelOf,
  rackRoom,
  withTray,
  UNPLACED,
  type MapInput,
} from '../mapView';
import type { BinRow, LocationRow, ShelfRow } from '../queries';

const loc = (id: string, name: string): LocationRow => ({ id, name, created_at: '', sort_order: 0 });
const shelf = (
  id: string,
  locationId: string,
  name: string,
  capacity: number | null = null,
): ShelfRow => ({
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

describe('rack names (v3 wall)', () => {
  it('splits a name into the code on the label and the label on the wall', () => {
    expect(rackCodeOf('R1 · Door', 0)).toBe('R1');
    expect(rackLabelOf('R1 · Door')).toBe('Door');
  });

  it('gives a rack that was never coded a positional one', () => {
    expect(rackCodeOf('Garage', 2)).toBe('R3');
    expect(rackLabelOf('Garage')).toBe('Garage');
  });

  it('does not mistake an ordinary word for a code', () => {
    // "GA" from "Garage" would put a nonsense sticker on every rack.
    expect(rackCodeOf('Garage · Back wall', 0)).toBe('R1');
  });

  it('accepts a two-letter code and normalises its case', () => {
    expect(rackCodeOf('ab12 · Loft', 0)).toBe('AB12');
  });

  it('round-trips through compose, and drops the separator with no label', () => {
    expect(composeRackName('R2', 'Main run')).toBe('R2 · Main run');
    expect(rackLabelOf(composeRackName('R2', '  Main run  '))).toBe('Main run');
    expect(composeRackName('R2', '   ')).toBe('R2');
  });

  it('mints the next code from the highest one used, not from the count', () => {
    // R2 came off the wall; its label may still be stuck to a shelf, so the
    // new rack must not be called R2 as well.
    expect(nextRackCode(['R1 · Door', 'R3 · Corner'])).toBe('R4');
    expect(nextRackCode([])).toBe('R1');
  });

  it('numbers an uncoded wall from its positional codes', () => {
    expect(nextRackCode(['Garage', 'Shed'])).toBe('R3');
  });
});

describe('how full a rack is', () => {
  const areas = buildMap(
    input({
      locations: [loc('l1', 'R1 · Door')],
      shelves: [shelf('s1', 'l1', 'Top', 4), shelf('s2', 'l1', 'Upper', 2)],
      bins: [bin('b1', 's1', 'B-001'), bin('b2', 's2', 'B-002'), bin('b3', 's2', 'B-003')],
    }),
  );

  it('counts bins filed against slots declared', () => {
    expect(areaFill(areas[0])).toEqual({ filled: 3, slots: 6 });
  });

  it('reports the room left, and which shelf a sent bin would land on', () => {
    expect(rackRoom(areas[0])).toBe(3);
    expect(openRowOf(areas[0])?.name).toBe('Top');
  });

  it('treats an unsized shelf as always having room', () => {
    const loose = buildMap(
      input({ locations: [loc('l1', 'R1 · Door')], shelves: [shelf('s1', 'l1', 'Top')] }),
    );
    expect(rackRoom(loose[0])).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports a packed rack as having no room, so a rail can say so first', () => {
    const packed = buildMap(
      input({
        locations: [loc('l1', 'R1 · Door')],
        shelves: [shelf('s1', 'l1', 'Top', 1)],
        bins: [bin('b1', 's1', 'B-001')],
      }),
    );
    expect(rackRoom(packed[0])).toBe(0);
    expect(openRowOf(packed[0])).toBeNull();
  });
});

describe('the way out of an over-full shelf', () => {
  it('offers the nearest shelf in the same rack with room', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'R1 · Door')],
        shelves: [shelf('s1', 'l1', 'Top', 1), shelf('s2', 'l1', 'Upper', 4)],
        bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002')],
      }),
    );
    expect(overflowTarget(areas, areas[0], areas[0].rows[0])?.name).toBe('Upper');
  });

  it('falls back to the tray only when the whole rack is packed', () => {
    const areas = withTray(
      buildMap(
        input({
          locations: [loc('l1', 'R1 · Door')],
          shelves: [shelf('s1', 'l1', 'Top', 1), shelf('s2', 'l1', 'Upper', 1)],
          bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002'), bin('b3', 's2', 'B-003')],
        }),
      ),
    );
    const rack = areas[0];
    expect(overflowTarget(areas, rack, rack.rows[0])?.shelfId).toBeNull();
  });

  it('offers the tray no way out of itself', () => {
    // The tray is where overflow goes, so it is the one row with nowhere to
    // send anything. Offering "move it to the tray" to a bin already in the
    // tray is a quick fix that fixes nothing.
    const areas = withTray(
      buildMap(
        input({
          locations: [loc('l1', 'R1 · Door')],
          shelves: [shelf('s1', 'l1', 'Top', 1)],
          bins: [bin('b1', 's1', 'B-001'), bin('b2', null, 'B-002')],
        }),
      ),
    );
    const tray = areas.find((a) => a.locationId === null)!;
    expect(overflowTarget(areas, tray, tray.rows[0])).toBeNull();
  });
});

describe('the unshelved tray', () => {
  it('is added when nothing is in it, so it is still somewhere to put a bin', () => {
    const areas = withTray(
      buildMap(
        input({ locations: [loc('l1', 'R1 · Door')], shelves: [shelf('s1', 'l1', 'Top', 4)] }),
      ),
    );
    expect(areas[areas.length - 1].name).toBe(UNPLACED);
    expect(areas[areas.length - 1].rows[0].shelfId).toBeNull();
  });

  it('is not duplicated when bins are already loose', () => {
    const areas = withTray(buildMap(input({ bins: [bin('b9', null, 'B-009')] })));
    expect(areas.filter((a) => a.locationId === null)).toHaveLength(1);
    expect(areas[0].rows[0].bins).toHaveLength(1);
  });
});

describe('moving a stack of bins at once', () => {
  const areas = buildMap(
    input({
      locations: [loc('l1', 'R1 · Door')],
      shelves: [shelf('s1', 'l1', 'Top', 4), shelf('s2', 'l1', 'Upper', 4)],
      bins: [
        bin('b1', 's1', 'B-001'),
        bin('b2', 's1', 'B-002'),
        bin('b3', 's2', 'B-003'),
        bin('b4', 's2', 'B-004'),
      ],
    }),
  );

  it('lands them contiguously, in the order they were picked', () => {
    const plan = planMultiDrop(areas, ['b1', 'b2'], { shelfId: 's2', index: 1 });
    expect(plan?.orderedIds).toEqual(['b3', 'b1', 'b2', 'b4']);
    expect(plan?.shelfId).toBe('s2');
    expect(plan?.place).toBe('R1 · Door › Upper');
  });

  it('does not let a stack count itself when it moves within its own shelf', () => {
    // Without excluding the carried bins, index 2 would mean "after b2" —
    // a slot that stops existing the moment they leave it.
    const plan = planMultiDrop(areas, ['b1'], { shelfId: 's1', index: 1 });
    expect(plan?.orderedIds).toEqual(['b2', 'b1']);
  });

  it('drops at the end when the bin it was aimed at is one of the carried', () => {
    // Tapping a bin that is itself in your hand names no surviving slot, so
    // the stack goes to the end rather than in front of a bin about to move.
    const plan = planMultiDrop(areas, ['b1', 'b3'], { shelfId: 's2', beforeBinId: 'b3' });
    expect(plan?.orderedIds).toEqual(['b4', 'b1', 'b3']);
  });

  it('lands at the end when aimed at a bin that is not on that shelf', () => {
    // The bin you tapped can have moved, or been deleted, between the tap and
    // the drop. The end of the row is somewhere real; halfway through a shelf
    // that no longer contains it is not.
    const plan = planMultiDrop(areas, ['b1'], { shelfId: 's2', beforeBinId: 'b9' });
    expect(plan?.orderedIds).toEqual(['b3', 'b4', 'b1']);
  });

  it('returns null for a move that would change nothing', () => {
    expect(planMultiDrop(areas, ['b1', 'b2'], { shelfId: 's1', index: 0 })).toBeNull();
    expect(planMultiDrop(areas, [], { shelfId: 's2', index: 0 })).toBeNull();
    expect(planMultiDrop(areas, ['b1'], { shelfId: 'nope', index: 0 })).toBeNull();
  });
});
