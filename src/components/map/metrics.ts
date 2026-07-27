/**
 * Fixed sizes for the shelf boards (D21).
 *
 * These are constants rather than measurements for a reason the drag depends
 * on: every bin card is the same width, so the slot under a finger is
 * arithmetic on the row's scroll offset instead of a measurement of each
 * card. That is what keeps the gesture to a single detector for the whole
 * map — see `src/map/dragGeometry.ts`.
 *
 * Change a number here and the drag still lines up; measure a card somewhere
 * else and it will not.
 */

/** A bin card, and therefore a slot, a gap and the landing placeholder. */
export const CARD_W = 118;
export const CARD_H = 96;
/** Space between two cards standing on the same plank. */
export const CARD_GAP = 8;
/** Left inset of the first card inside a board's well. */
export const BOARD_PAD_H = 15;

/** Card pitch — what one slot costs horizontally. */
export const SLOT_PITCH = CARD_W + CARD_GAP;

/**
 * Mid-lines of `count` cards in a row whose content starts at `contentLeft`
 * in viewport coordinates. Uniform pitch is the whole point; see above.
 */
export function slotMidlines(contentLeft: number, count: number): number[] {
  const mids: number[] = [];
  for (let i = 0; i < count; i++) {
    mids.push(contentLeft + i * SLOT_PITCH + CARD_W / 2);
  }
  return mids;
}
