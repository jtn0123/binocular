import { CARD_GAP, SLOT_MAX_W, slotMidlines, slotWidth } from '../metrics';

/**
 * Where the slots on a shelf actually are.
 *
 * This is the arithmetic the drag hit-tests against: `dragGeometry` asks which
 * midline a finger is nearest, and the shelf draws its cards from the same two
 * functions. They therefore have to agree exactly — a card drawn centred while
 * the midlines are computed flush left would land every drop one slot off, and
 * nothing about the rendered tree would look wrong.
 */
describe('how wide a slot is', () => {
  it('stops growing once a shelf is roomy', () => {
    // Otherwise two bins on a wide shelf become two enormous cards.
    expect(slotWidth(600, 2)).toBe(SLOT_MAX_W);
  });

  it('shares the row out when the shelf is crowded', () => {
    // 300 wide, 5 cells, 4 gaps of 6 → 276/5.
    expect(slotWidth(300, 5)).toBeCloseTo(55.2);
  });

  it('accounts for the gaps, not just the cells', () => {
    const width = slotWidth(300, 5);
    expect(width * 5 + CARD_GAP * 4).toBeCloseTo(300);
  });

  it('never returns zero for a row that has not been measured yet', () => {
    // A row reports zero width before layout. A zero or negative slot would
    // put every landing index at the same coordinate, so the first drag after
    // a rack change would drop into whichever slot sorted first.
    expect(slotWidth(0, 4)).toBeGreaterThan(0);
    expect(slotWidth(-50, 4)).toBeGreaterThan(0);
  });

  it('has an answer for a shelf with no slots at all', () => {
    expect(slotWidth(300, 0)).toBe(SLOT_MAX_W);
    expect(slotWidth(300, -1)).toBe(SLOT_MAX_W);
  });
});

describe('where the slots sit', () => {
  it('centres a half-empty shelf rather than crowding it to the left', () => {
    // The design lays a plank out with `justify-content: center`, so the first
    // cell of a two-cell row on a wide shelf is nowhere near the row's edge.
    const [first] = slotMidlines(0, 600, 2);
    const spread = 2 * SLOT_MAX_W + CARD_GAP;
    expect(first).toBeCloseTo((600 - spread) / 2 + SLOT_MAX_W / 2);
  });

  it('is symmetric about the middle of the row', () => {
    const mids = slotMidlines(0, 600, 3);
    const centre = 600 / 2;
    expect(mids[1]).toBeCloseTo(centre);
    expect(centre - mids[0]).toBeCloseTo(mids[2] - centre);
  });

  it('spaces them by exactly one slot and one gap', () => {
    const mids = slotMidlines(0, 300, 5);
    const step = slotWidth(300, 5) + CARD_GAP;
    for (let i = 1; i < mids.length; i++) expect(mids[i] - mids[i - 1]).toBeCloseTo(step);
  });

  it('offsets by where the row starts on screen', () => {
    // Midlines are viewport coordinates: the hit test compares them against a
    // finger, which knows nothing about the row's own coordinate space.
    const at0 = slotMidlines(0, 300, 4);
    const at40 = slotMidlines(40, 300, 4);
    expect(at40.map((m) => m - 40)).toEqual(at0);
  });

  it('gives one midline per slot, and none for an empty shelf', () => {
    expect(slotMidlines(0, 300, 4)).toHaveLength(4);
    expect(slotMidlines(0, 300, 0)).toEqual([]);
  });

  it('keeps a full row inside the row it was given', () => {
    const width = slotWidth(300, 5);
    const mids = slotMidlines(0, 300, 5);
    expect(mids[0] - width / 2).toBeGreaterThanOrEqual(0);
    expect(mids[4] + width / 2).toBeLessThanOrEqual(300.001);
  });
});
