import {
  autoScrollStep,
  binAt,
  freezeGeometry,
  hitTest,
  type RowMeasurement,
} from '../dragGeometry';

/**
 * The two bugs this module exists to prevent both looked like "the bin does
 * not stay where I dropped it", and both were arithmetic. They are asserted
 * here rather than discovered on a shelf.
 */
describe('drag geometry', () => {
  /** Shelf A at y 0–100 with three 100pt cards; Shelf B at y 120–220, empty. */
  const rows: RowMeasurement[] = [
    {
      shelfId: 'A',
      top: 0,
      bottom: 100,
      cards: [
        { binId: 'b1', x: 0, width: 100 },
        { binId: 'b2', x: 100, width: 100 },
        { binId: 'b3', x: 200, width: 100 },
      ],
    },
    { shelfId: 'B', top: 120, bottom: 220, cards: [] },
  ];

  const geo = (lifted = 'b1') => freezeGeometry(rows, 0, lifted);

  it('leaves the lifted bin out, so the slot it vacated is not counted twice', () => {
    // b1 is drawn as a hole and the landing slot stands in for it. Counting
    // it would push every index to its right out by one.
    expect(geo('b1').rows[0].mids).toEqual([150, 250]);
    expect(geo('b2').rows[0].mids).toEqual([50, 250]);
  });

  it('drops in front of the card the finger is over', () => {
    // With b1 lifted the remaining mids are b2 (150) and b3 (250).
    expect(hitTest(geo(), { x: 10, y: 50 }, 0)).toEqual({ shelfId: 'A', index: 0 });
    expect(hitTest(geo(), { x: 200, y: 50 }, 0)).toEqual({ shelfId: 'A', index: 1 });
  });

  it('past the last card lands at the end of the row, not nowhere', () => {
    expect(hitTest(geo(), { x: 900, y: 50 }, 0)).toEqual({ shelfId: 'A', index: 2 });
  });

  it('an empty shelf still accepts a bin, at slot one', () => {
    expect(hitTest(geo(), { x: 40, y: 160 }, 0)).toEqual({ shelfId: 'B', index: 0 });
  });

  it('a finger just off a row still counts as that row', () => {
    // A thumb is wider than the gap between two shelves; without the slop the
    // dead band between them reads as "cancel" mid-move.
    expect(hitTest(geo(), { x: 10, y: -4 }, 0)?.shelfId).toBe('A');
    expect(hitTest(geo(), { x: 10, y: 104 }, 0)?.shelfId).toBe('A');
  });

  it('over no shelf at all is null — releasing there cancels', () => {
    expect(hitTest(geo(), { x: 10, y: 110 }, 0)).toBeNull();
    expect(hitTest(geo(), { x: 10, y: 900 }, 0)).toBeNull();
  });

  it('corrects for scrolling since lift-off instead of re-measuring', () => {
    // Auto-scroll moved the map 120pt under a finger that never left y=50.
    // Shelf B has travelled up into that spot; the frozen snapshot still
    // resolves it, which is what makes edge auto-scroll usable at all.
    expect(hitTest(geo(), { x: 40, y: 50 }, 120)).toEqual({ shelfId: 'B', index: 0 });
  });

  it('the frozen snapshot does not move when the real rows do', () => {
    // Rule 1: the landing slot displaces its neighbours, so re-measuring
    // mid-drag feeds that shift back into the index. Freezing is the fix, and
    // a later mutation of the source measurements must not reach the snapshot.
    const frozen = geo();
    rows[0].cards = [{ binId: 'b9', x: 0, width: 100 }];
    expect(frozen.rows[0].mids).toEqual([150, 250]);
    rows[0].cards = [
      { binId: 'b1', x: 0, width: 100 },
      { binId: 'b2', x: 100, width: 100 },
      { binId: 'b3', x: 200, width: 100 },
    ];
  });

  describe('picking up the bin under the finger', () => {
    // One detector covers the whole wall, so the grab is a lookup rather than
    // a handler firing on the card that owns it.
    it('names the card the finger came down on', () => {
      expect(binAt(rows, { x: 50, y: 50 })).toBe('b1');
      expect(binAt(rows, { x: 150, y: 50 })).toBe('b2');
      expect(binAt(rows, { x: 250, y: 50 })).toBe('b3');
    });

    it('a press on bare shelf grabs nothing, and drags nothing', () => {
      expect(binAt(rows, { x: 900, y: 50 })).toBeNull();
      expect(binAt(rows, { x: 50, y: 160 })).toBeNull();
      expect(binAt(rows, { x: 50, y: 110 })).toBeNull();
    });
  });

  describe('edge auto-scroll', () => {
    const viewport = { top: 0, bottom: 600 };

    it('does nothing through the whole middle of the screen', () => {
      expect(autoScrollStep(300, viewport)).toBe(0);
    });

    it('pulls the map up near the top edge and down near the bottom', () => {
      expect(autoScrollStep(20, viewport)).toBeLessThan(0);
      expect(autoScrollStep(580, viewport)).toBeGreaterThan(0);
    });
  });
});
