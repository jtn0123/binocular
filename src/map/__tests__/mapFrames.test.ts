import { renderHook } from '@testing-library/react-native';

import { buildMap, type MapArea, type MapInput } from '@/db/mapView';
import type { BinRow, LocationRow, ShelfRow } from '@/db/queries';
import { CARD_GAP, SLOT_MAX_W, slotMidlines, slotWidth } from '@/components/map/metrics';

import { useMapFrames } from '../useMapFrames';

/**
 * Turning four nested layouts into the one space the drag hit-tests in.
 *
 * A rack is an area, containing a recessed well, containing a board per
 * shelf, containing the strip the cards actually sit on — and React Native
 * reports each of those relative to its own parent. `measureRows` is the only
 * place those are summed, and it is summed against a *scroll* offset too.
 *
 * Everything downstream of this is already proven: `dragGeometry` is exact and
 * `metrics` is exact. So a wrong answer here is the one remaining way for a
 * drop to land in the wrong slot while every other test stays green, and it
 * would look like nothing at all in a rendered tree.
 */
describe('where the shelves are, as far as a finger is concerned', () => {
  const loc = (id: string, name: string): LocationRow => ({
    id,
    name,
    created_at: '',
    sort_order: 0,
  });
  const shelf = (id: string, locationId: string, name: string, capacity: number | null): ShelfRow => ({
    id,
    location_id: locationId,
    name,
    created_at: '',
    capacity,
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

  const input = (over: Partial<MapInput> = {}): MapInput => ({
    locations: [],
    shelves: [],
    bins: [],
    itemCounts: new Map(),
    ...over,
  });

  /** One rack, one shelf of `capacity` slots holding `filled` bins. */
  const oneShelf = (capacity: number | null, filled: number): MapArea[] =>
    buildMap(
      input({
        locations: [loc('l1', 'R1 · Garage')],
        shelves: [shelf('s1', 'l1', 'Top', capacity)],
        bins: Array.from({ length: filled }, (_, i) => bin(`b${i}`, 's1', `B-00${i}`)),
      }),
    );

  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  /**
   * A laid-out map: rack at (0, 40), well inset (8, 12) inside it, the shelf's
   * board 20 down from the well, and the card strip 15 in from the board.
   */
  const laidOut = async (areas: MapArea[], scrollY = 0) => {
    const { result } = await renderHook(() => useMapFrames());
    const frames = result.current;
    frames.setAreaFrame('l1', rect(0, 40, 360, 500));
    frames.setWellFrame('l1', rect(8, 12, 344, 470));
    frames.setBoardFrame('s1', rect(0, 20, 344, 100));
    frames.setStripFrame('s1', rect(15, 0, 300, 92));
    frames.setScrollY(scrollY);
    return { frames, rows: () => frames.measureRows(areas) };
  };

  it('sums the whole chain down to the board, not just the last link', async () => {
    // area.y 40 + well.y 12 + board.y 20 = 72. Dropping any one of those
    // puts every row on the wrong shelf, consistently, which reads as the
    // drag being "off by one" rather than as a measurement bug.
    const { rows } = await laidOut(oneShelf(4, 2));
    expect(rows()[0].top).toBe(72);
    expect(rows()[0].bottom).toBe(172);
  });

  it('subtracts the scroll, so a scrolled map is not measured where it used to be', async () => {
    const { rows } = await laidOut(oneShelf(4, 2), 50);
    expect(rows()[0].top).toBe(22);
  });

  /**
   * The one this exists for.
   *
   * Slots share the row's width, so a half-empty shelf's cells are *wider* and
   * sit further in than a full one's. Counting only the bins would compute the
   * pitch of a full shelf and place every landing index too far left — worst
   * exactly where there is most room to get it wrong.
   */
  it('counts the free slots, not just the bins', async () => {
    const half = await laidOut(oneShelf(4, 2));
    const full = await laidOut(oneShelf(4, 4));

    // Four cells either way, so the same pitch and the same first card.
    expect(half.rows()[0].cards[0].width).toBeCloseTo(full.rows()[0].cards[0].width);
    expect(half.rows()[0].cards[0].x).toBeCloseTo(full.rows()[0].cards[0].x);
  });

  it('places the cards where the shelf actually draws them', async () => {
    // The same two functions the board lays itself out with; if these ever
    // disagree, the cards and the slots under them part company.
    const { rows } = await laidOut(oneShelf(4, 2));
    const width = slotWidth(300, 4);
    const mids = slotMidlines(0 + 8 + 0 + 15, 300, 4);

    expect(rows()[0].cards.map((c) => c.x)).toEqual(mids.slice(0, 2).map((m) => m - width / 2));
    expect(rows()[0].cards[0].width).toBeCloseTo(width);
  });

  it('reports a card per bin and no more, however many slots are free', async () => {
    // The free slots set the pitch; they are not cards and cannot be dragged.
    const { rows } = await laidOut(oneShelf(8, 2));
    expect(rows()[0].cards).toHaveLength(2);
  });

  it('measures an unsized shelf against the bins it actually holds', async () => {
    // No capacity means no free slots to reserve room for.
    const { rows } = await laidOut(oneShelf(null, 3));
    expect(rows()[0].cards[0].width).toBeCloseTo(slotWidth(300, 3));
  });

  it('never measures a shelf whose width is not known yet', async () => {
    // A row placed approximately is worse than a row not placed at all: the
    // drop would land somewhere plausible and wrong.
    const { result } = await renderHook(() => useMapFrames());
    const frames = result.current;
    frames.setAreaFrame('l1', rect(0, 40, 360, 500));
    frames.setWellFrame('l1', rect(8, 12, 344, 470));
    frames.setBoardFrame('s1', rect(0, 20, 344, 100));
    // …but no strip frame.
    expect(frames.measureRows(oneShelf(4, 2))).toEqual([]);
  });

  it('skips a rack that has not laid out, rather than placing its shelves at zero', async () => {
    const { result } = await renderHook(() => useMapFrames());
    const frames = result.current;
    frames.setBoardFrame('s1', rect(0, 20, 344, 100));
    frames.setStripFrame('s1', rect(15, 0, 300, 92));
    expect(frames.measureRows(oneShelf(4, 2))).toEqual([]);
  });

  it('keeps a bare shelf measurable, so a bin can be dropped onto it', async () => {
    // An empty shelf has no cards to measure but is still a place to put one.
    const { rows } = await laidOut(oneShelf(4, 0));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cards).toEqual([]);
    expect(rows()[0].shelfId).toBe('s1');
  });

  it('caps a roomy shelf’s cells rather than letting two bins fill it', async () => {
    const { rows } = await laidOut(oneShelf(2, 2));
    expect(rows()[0].cards[0].width).toBe(SLOT_MAX_W);
    // Centred, so they sit in the middle of a wide plank, not against its edge.
    expect(rows()[0].cards[0].x).toBeGreaterThan(8 + 15);
  });

  it('spaces neighbours by one cell and one gap', async () => {
    const { rows } = await laidOut(oneShelf(4, 3));
    const [a, b] = rows()[0].cards;
    expect(b.x - a.x).toBeCloseTo(slotWidth(300, 4) + CARD_GAP);
  });

  describe('the tray, which is a row like any other', () => {
    it('is measured under the key the drag looks it up by', async () => {
      const areas = buildMap(
        input({
          locations: [loc('l1', 'R1 · Garage')],
          shelves: [shelf('s1', 'l1', 'Top', 4)],
          bins: [{ ...bin('b9', 's1', 'B-009'), shelf_id: null } as BinRow],
        }),
      );
      const { result } = await renderHook(() => useMapFrames());
      const frames = result.current;
      const unplaced = areas.findIndex((a) => a.locationId === null);
      const key = frames.areaKeyOf(unplaced, null);

      frames.setAreaFrame(key, rect(0, 600, 360, 120));
      frames.setWellFrame(key, rect(0, 0, 360, 120));
      frames.setBoardFrame('unshelved', rect(0, 0, 360, 100));
      frames.setStripFrame('unshelved', rect(15, 0, 300, 92));

      const rows = frames.measureRows(areas);
      expect(rows.map((r) => r.shelfId)).toContain(null);
    });
  });
});
