/**
 * The geometry of a shelf (D21, v3).
 *
 * Slots *share* the row: `flex: 1 1 0` capped at `SLOT_MAX_W`, centred, with
 * no sideways scrolling. A rack is a grid you read at a glance, and a shelf
 * you have to scroll is a shelf whose contents you cannot count.
 *
 * Every cell in a row is still the same width, which is what keeps the drag
 * to one detector for the whole map: the slot under a finger is arithmetic on
 * the row's measured width rather than a measurement of every card. Change a
 * number here and the drag follows; measure a card somewhere else and it will
 * not (see `src/map/dragGeometry.ts`).
 */

/** A slot's height, and therefore a bin card's. */
export const CARD_H = 92;
/** Space between two cells on the same plank. */
export const CARD_GAP = 6;
/** A cell never grows past this, however empty the shelf is. */
export const SLOT_MAX_W = 76;
/** Left inset of the row inside the rack panel. */
export const BOARD_PAD_H = 15;

/**
 * How wide each cell is when `count` of them share `rowWidth`.
 *
 * Never below 1px: a row that has not laid out yet reports zero width, and a
 * negative slot would place every landing index at the same spot.
 */
export function slotWidth(rowWidth: number, count: number): number {
  if (count <= 0) return SLOT_MAX_W;
  const available = rowWidth - CARD_GAP * (count - 1);
  return Math.max(1, Math.min(SLOT_MAX_W, available / count));
}

/**
 * Mid-lines of `count` centred cells in a row that starts at `contentLeft`
 * and is `rowWidth` wide, in viewport coordinates.
 *
 * Centred is the part worth stating: the design lays a shelf out with
 * `justify-content: center`, so a half-full shelf's cells sit in the middle
 * of the plank and their left edge is *not* the row's left edge.
 */
export function slotMidlines(
  contentLeft: number,
  rowWidth: number,
  count: number,
): number[] {
  const width = slotWidth(rowWidth, count);
  const spread = count * width + CARD_GAP * Math.max(0, count - 1);
  const left = contentLeft + Math.max(0, (rowWidth - spread) / 2);
  const mids: number[] = [];
  for (let i = 0; i < count; i++) {
    mids.push(left + i * (width + CARD_GAP) + width / 2);
  }
  return mids;
}
