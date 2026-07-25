import { buildMap, locate, mapSize, UNPLACED, UNSHELVED, type MapInput } from '../mapView';
import type { BinRow, LocationRow, ShelfRow } from '../queries';

const loc = (id: string, name: string): LocationRow => ({ id, name, created_at: '' });
const shelf = (id: string, locationId: string, name: string): ShelfRow => ({
  id,
  location_id: locationId,
  name,
  created_at: '',
});
const bin = (id: string, shelfId: string | null, code: string): BinRow =>
  ({ id, shelf_id: shelfId, short_code: code, name: code, cover_photo_uri: null,
     last_scanned_at: null, created_at: '' }) as BinRow;

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
    expect(areas[0].rows).toEqual([{ shelfId: 's1', name: 'Shelf A', bins: [] }]);
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

  it('reports the area and row a bin sits in', () => {
    expect(locate(areas, 'b1')).toMatchObject({
      area: { name: 'Garage' },
      row: { name: 'Shelf A' },
    });
  });

  it('returns null for a bin that is not drawn', () => {
    expect(locate(areas, 'nope')).toBeNull();
  });
});
