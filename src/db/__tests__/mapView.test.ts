import {
  buildMap,
  describePlace,
  heatTier,
  locate,
  locateMany,
  mapSize,
  planDrop,
  rowGaps,
  UNPLACED,
  UNSHELVED,
  type MapCell,
  type MapInput,
} from '../mapView';
import type { BinRow, LocationRow, ShelfRow } from '../queries';

const loc = (id: string, name: string): LocationRow => ({ id, name, created_at: '', sort_order: 0 });
const shelf = (id: string, locationId: string, name: string, capacity: number | null = null): ShelfRow => ({
  id,
  location_id: locationId,
  name,
  created_at: '',
  capacity,
  sort_order: 0,
});
const bin = (id: string, shelfId: string | null, code: string): BinRow =>
  ({ id, shelf_id: shelfId, short_code: code, name: code, cover_photo_uri: null,
     last_scanned_at: null, created_at: '', sort_order: 0 }) as BinRow;

const input = (over: Partial<MapInput> = {}): MapInput => ({
  locations: [],
  shelves: [],
  bins: [],
  itemCounts: new Map(),
  ...over,
});

describe('the workshop map (D21)', () => {
  it('draws nothing for an empty workshop', () => {
    expect(buildMap(input())).toEqual([]);
  });

  it('turns shelves into rows and bins into cells', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A'), shelf('s2', 'l1', 'Shelf B')],
        bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002'), bin('b3', 's2', 'B-003')],
        itemCounts: new Map([
          ['b1', 4],
          ['b3', 1],
        ]),
      }),
    );

    expect(areas).toHaveLength(1);
    expect(areas[0].name).toBe('Garage');
    expect(areas[0].rows.map((r) => r.name)).toEqual(['Shelf A', 'Shelf B']);
    expect(areas[0].rows[0].bins.map((c) => c.code)).toEqual(['B-001', 'B-002']);
    expect(areas[0].bins).toBe(3);
  });

  it('marks an empty bin so it can be drawn as space, not stock', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A')],
        bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002')],
        itemCounts: new Map([['b1', 7]]),
      }),
    );
    expect(areas[0].rows[0].bins.map((c) => [c.items, c.empty])).toEqual([
      [7, false],
      [0, true],
    ]);
  });

  it('keeps a shelf you have not filled yet', () => {
    // It is part of the wall. Hiding it would make the picture lie.
    const areas = buildMap(
      input({ locations: [loc('l1', 'Garage')], shelves: [shelf('s1', 'l1', 'Shelf A')] }),
    );
    expect(areas[0].rows).toEqual([{ shelfId: 's1', name: 'Shelf A', bins: [], capacity: null }]);
  });

  it('gives a bin with no shelf a row of its own rather than dropping it', () => {
    const areas = buildMap(input({ bins: [bin('b9', null, 'B-009')] }));
    expect(areas).toHaveLength(1);
    expect(areas[0].name).toBe(UNPLACED);
    expect(areas[0].rows[0].name).toBe(UNSHELVED);
    expect(areas[0].rows[0].bins[0].code).toBe('B-009');
  });

  it('puts the unplaced row last, after the real locations', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A')],
        bins: [bin('b1', 's1', 'B-001'), bin('b9', null, 'B-009')],
      }),
    );
    expect(areas.map((a) => a.name)).toEqual(['Garage', UNPLACED]);
  });

  it('drops a location with no shelves and no bins', () => {
    const areas = buildMap(input({ locations: [loc('l1', 'Garage'), loc('l2', 'Shed')] }));
    expect(areas).toEqual([]);
  });

  it('does not put a bin on a shelf in another location', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage'), loc('l2', 'Shed')],
        shelves: [shelf('s1', 'l1', 'Shelf A'), shelf('s2', 'l2', 'Shelf Z')],
        bins: [bin('b1', 's2', 'B-001')],
      }),
    );
    expect(areas.find((a) => a.name === 'Garage')?.bins).toBe(0);
    expect(areas.find((a) => a.name === 'Shed')?.bins).toBe(1);
  });

  it('counts every bin it drew', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A')],
        bins: [bin('b1', 's1', 'B-001'), bin('b9', null, 'B-009')],
      }),
    );
    expect(mapSize(areas)).toBe(2);
  });
});

describe('finding a bin on the map', () => {
  const areas = buildMap(
    input({
      locations: [loc('l1', 'Garage')],
      shelves: [shelf('s1', 'l1', 'Shelf A')],
      bins: [bin('b1', 's1', 'B-001')],
    }),
  );

  it('reports the area, row and cell a bin sits in', () => {
    expect(locate(areas, 'b1')).toMatchObject({
      area: { name: 'Garage' },
      row: { name: 'Shelf A' },
      cell: { code: 'B-001' },
    });
  });

  it('returns null for a bin that is not drawn', () => {
    expect(locate(areas, 'nope')).toBeNull();
  });

  it('names the place so the screen can say where to walk', () => {
    expect(describePlace(locate(areas, 'b1')!)).toBe('Garage › Shelf A');
  });

  it('does not read out the placeholder names as if they were a place', () => {
    // "Not in a location › Not on a shelf" is worse than saying nothing.
    const loose = buildMap(input({ bins: [bin('b9', null, 'B-009')] }));
    expect(describePlace(locate(loose, 'b9')!)).toBe('Not filed anywhere yet');
  });
});

describe('finding several bins at once (multi-highlight)', () => {
  const areas = buildMap(
    input({
      locations: [loc('l1', 'Garage')],
      shelves: [shelf('s1', 'l1', 'Shelf A'), shelf('s2', 'l1', 'Shelf B')],
      bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002'), bin('b3', 's2', 'B-003')],
    }),
  );

  it('returns every drawn match in draw order, regardless of ask order', () => {
    const finds = locateMany(areas, ['b3', 'b1']);
    expect(finds.map((f) => f.cell.code)).toEqual(['B-001', 'B-003']);
  });

  it('silently skips ids that are not on the map', () => {
    expect(locateMany(areas, ['b2', 'ghost']).map((f) => f.cell.code)).toEqual(['B-002']);
  });

  it('finds nothing when asked for nothing', () => {
    expect(locateMany(areas, [])).toEqual([]);
  });
});

describe('shelf capacity and gaps (D21)', () => {
  it('draws free declared space as gaps', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A', 6)],
        bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002')],
      }),
    );
    expect(areas[0].rows[0].capacity).toBe(6);
    expect(rowGaps(areas[0].rows[0])).toBe(4);
  });

  it('never draws negative space for an over-full shelf', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A', 1)],
        bins: [bin('b1', 's1', 'B-001'), bin('b2', 's1', 'B-002')],
      }),
    );
    expect(rowGaps(areas[0].rows[0])).toBe(0);
  });

  it('an unsized shelf has no gaps to draw', () => {
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A')],
        bins: [bin('b1', 's1', 'B-001')],
      }),
    );
    expect(rowGaps(areas[0].rows[0])).toBe(0);
  });
});

describe('planning a drop (D21)', () => {
  const areas = () =>
    buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A'), shelf('s2', 'l1', 'Shelf B')],
        bins: [
          bin('b1', 's1', 'B-001'),
          bin('b2', 's1', 'B-002'),
          bin('b3', 's1', 'B-003'),
          bin('b4', 's2', 'B-004'),
          bin('b9', null, 'B-009'),
        ],
      }),
    );

  it('reorders within a shelf by inserting before the tapped bin', () => {
    const plan = planDrop(areas(), 'b3', { shelfId: 's1', beforeBinId: 'b1' });
    expect(plan).toMatchObject({
      shelfId: 's1',
      orderedIds: ['b3', 'b1', 'b2'],
      crossShelf: false,
    });
  });

  it('moving forward past your own slot lands where the eye expects', () => {
    const plan = planDrop(areas(), 'b1', { shelfId: 's1', beforeBinId: 'b3' });
    expect(plan?.orderedIds).toEqual(['b2', 'b1', 'b3']);
  });

  it('a drop with no target bin appends to the end of the row', () => {
    const plan = planDrop(areas(), 'b1', { shelfId: 's1' });
    expect(plan?.orderedIds).toEqual(['b2', 'b3', 'b1']);
  });

  it('a cross-shelf drop is flagged as the move that asks first, and says where to', () => {
    const plan = planDrop(areas(), 'b1', { shelfId: 's2' });
    expect(plan).toMatchObject({
      shelfId: 's2',
      orderedIds: ['b4', 'b1'],
      crossShelf: true,
      place: 'Garage › Shelf B',
    });
  });

  it('dropping into the unshelved row unfiles the bin — and still asks', () => {
    const plan = planDrop(areas(), 'b1', { shelfId: null });
    expect(plan).toMatchObject({ shelfId: null, orderedIds: ['b9', 'b1'], crossShelf: true });
  });

  it('filing an unshelved bin onto a shelf is a cross-shelf move too', () => {
    const plan = planDrop(areas(), 'b9', { shelfId: 's2' });
    expect(plan).toMatchObject({ shelfId: 's2', orderedIds: ['b4', 'b9'], crossShelf: true });
  });

  it('returns null for drops that change nothing', () => {
    // Onto itself, onto its own end slot while already last, or already in place.
    expect(planDrop(areas(), 'b1', { shelfId: 's1', beforeBinId: 'b1' })).toBeNull();
    expect(planDrop(areas(), 'b3', { shelfId: 's1' })).toBeNull();
    expect(planDrop(areas(), 'b1', { shelfId: 's1', beforeBinId: 'b2' })).toBeNull();
  });

  it('returns null when the bin or the destination is not drawn', () => {
    expect(planDrop(areas(), 'ghost', { shelfId: 's1' })).toBeNull();
    expect(planDrop(areas(), 'b1', { shelfId: 'nope' })).toBeNull();
  });

  /**
   * The drag names a slot, not a neighbour. Indexes are counted over the row
   * *without* the lifted bin, which is what the on-screen measurement reports
   * — the lifted card is drawn as a hole and the landing slot stands in it.
   */
  describe('by slot index (the drag path)', () => {
    it('drops into the slot the finger is over', () => {
      // Shelf A without b3 is [b1, b2]; slot 1 is the gap between them.
      expect(planDrop(areas(), 'b3', { shelfId: 's1', index: 1 })?.orderedIds).toEqual([
        'b1',
        'b3',
        'b2',
      ]);
    });

    it('slot zero is the front of the row', () => {
      expect(planDrop(areas(), 'b3', { shelfId: 's1', index: 0 })?.orderedIds).toEqual([
        'b3',
        'b1',
        'b2',
      ]);
    });

    it('dragging right past a neighbour really lands past it', () => {
      // The off-by-one that made a rightward drag settle back in its own gap:
      // b1 lifted leaves [b2, b3], so slot 2 is the end and slot 1 is between.
      expect(planDrop(areas(), 'b1', { shelfId: 's1', index: 1 })?.orderedIds).toEqual([
        'b2',
        'b1',
        'b3',
      ]);
      expect(planDrop(areas(), 'b1', { shelfId: 's1', index: 2 })?.orderedIds).toEqual([
        'b2',
        'b3',
        'b1',
      ]);
    });

    it('a slot past the end of the row clamps to the end rather than vanishing', () => {
      // Releasing over the empty half of a short shelf reports a big index.
      expect(planDrop(areas(), 'b1', { shelfId: 's1', index: 99 })?.orderedIds).toEqual([
        'b2',
        'b3',
        'b1',
      ]);
    });

    it('carries a slot across shelves, still flagged as the move that asks', () => {
      expect(planDrop(areas(), 'b1', { shelfId: 's2', index: 0 })).toMatchObject({
        orderedIds: ['b1', 'b4'],
        crossShelf: true,
        place: 'Garage › Shelf B',
      });
    });

    it('a slot that changes nothing is still nothing', () => {
      // b1 is already first; slot 0 of [b2, b3] puts it back exactly there.
      expect(planDrop(areas(), 'b1', { shelfId: 's1', index: 0 })).toBeNull();
    });

    it('an index wins over a stale beforeBinId rather than fighting it', () => {
      expect(
        planDrop(areas(), 'b3', { shelfId: 's1', index: 0, beforeBinId: 'b2' })?.orderedIds,
      ).toEqual(['b3', 'b1', 'b2']);
    });
  });
});

describe('heat tinting (D21)', () => {
  const cell = (over: Partial<MapCell>): MapCell => ({
    binId: 'b',
    code: 'B-001',
    name: 'b',
    items: 0,
    empty: true,
    photoUri: null,
    lastScannedAt: null,
    ...over,
  });
  const now = '2026-07-25T12:00:00Z';

  it('makes fuller bins glow hotter', () => {
    expect(heatTier(cell({ items: 0 }), 'items', now)).toBe(0);
    expect(heatTier(cell({ items: 1 }), 'items', now)).toBe(1);
    expect(heatTier(cell({ items: 5 }), 'items', now)).toBe(2);
    expect(heatTier(cell({ items: 10 }), 'items', now)).toBe(3);
  });

  it('marks the bins the camera has not visited lately, never-audited hottest', () => {
    expect(heatTier(cell({ lastScannedAt: '2026-07-20T00:00:00Z' }), 'scanned', now)).toBe(0);
    expect(heatTier(cell({ lastScannedAt: '2026-06-01T00:00:00Z' }), 'scanned', now)).toBe(1);
    expect(heatTier(cell({ lastScannedAt: '2026-01-01T00:00:00Z' }), 'scanned', now)).toBe(2);
    expect(heatTier(cell({ lastScannedAt: null }), 'scanned', now)).toBe(3);
  });

  it('mode none tints nothing, whatever the cell holds', () => {
    expect(heatTier(cell({ items: 40 }), 'none', now)).toBe(0);
  });
});

describe('what a map cell carries', () => {
  it('brings the bin cover photo along so a cell can look like the bin', () => {
    const withPhoto = { ...bin('b1', 's1', 'B-001'), cover_photo_uri: 'file:///cover.jpg' };
    const areas = buildMap(
      input({
        locations: [loc('l1', 'Garage')],
        shelves: [shelf('s1', 'l1', 'Shelf A')],
        bins: [withPhoto, bin('b2', 's1', 'B-002')],
      }),
    );
    expect(areas[0].rows[0].bins.map((c) => c.photoUri)).toEqual(['file:///cover.jpg', null]);
  });
});
