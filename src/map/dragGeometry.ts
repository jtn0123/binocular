/**
 * Where a dragged bin would land (blueprint D21).
 *
 * The screen owns the gesture; this owns the arithmetic. Same reasoning as
 * `mapView.ts`: "which slot is under my finger" is the part that hides bugs,
 * and a component driven by a native gesture is the worst place to test it.
 *
 * Two rules here were learned the hard way in the prototype, and both are the
 * reason this is a *frozen snapshot* rather than a live measurement:
 *
 * 1. The landing slot displaces the cards it sits between. Re-measuring
 *    mid-drag feeds the slot's own shift back into the index, so the bin
 *    oscillates and a rightward drag settles one slot short — back in the gap
 *    it started from.
 * 2. The lifted bin is excluded from the snapshot entirely. It is drawn as a
 *    hole, and the landing slot stands in for it, so counting it would offset
 *    every index to its right.
 *
 * Coordinates are all relative to the map's scroll *viewport* — the same
 * space a gesture reports its position in. Vertical scrolling that happens
 * during the drag is corrected with a delta rather than a re-measure, which
 * is what lets edge auto-scroll work without reopening rule 1.
 */

/** A rectangle in viewport coordinates. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One bin card, measured where it actually sits on screen. */
export interface CardMeasurement {
  binId: string;
  /** Left edge, viewport coordinates. */
  x: number;
  width: number;
}

/** One shelf row, measured where it actually sits on screen. */
export interface RowMeasurement {
  /** null is the unshelved tray row — a legitimate drop target (D21). */
  shelfId: string | null;
  /** Top edge of the row's drop band, viewport coordinates. */
  top: number;
  /** Bottom edge of the row's drop band, viewport coordinates. */
  bottom: number;
  /** Cards in draw order. */
  cards: readonly CardMeasurement[];
}

interface FrozenRow {
  shelfId: string | null;
  top: number;
  bottom: number;
  /** Card centre-lines, ascending, the lifted bin removed. */
  mids: number[];
}

/** The map as it stood the instant a bin left the shelf. */
export interface DragGeometry {
  /** Vertical scroll offset when the snapshot was taken. */
  scrollY: number;
  rows: FrozenRow[];
}

/** Where a drag would drop: a row, and the slot index within it. */
export interface DropSlot {
  shelfId: string | null;
  index: number;
  /** True when the target came from the wall strip, which drops at the end. */
  viaWall?: boolean;
}

/**
 * A row accepts a finger a little outside its band. A shelf is ~100pt tall
 * and a thumb is wider than the gap between two rows, so without this the
 * dead zone between shelves reads as "cancel" during an ordinary move.
 */
const ROW_SLOP = 6;

/** Freezes the current layout for the duration of one drag. */
export function freezeGeometry(
  rows: readonly RowMeasurement[],
  scrollY: number,
  liftedBinId: string,
): DragGeometry {
  return {
    scrollY,
    rows: rows.map((row) => ({
      shelfId: row.shelfId,
      top: row.top,
      bottom: row.bottom,
      mids: row.cards
        .filter((card) => card.binId !== liftedBinId)
        .map((card) => card.x + card.width / 2),
    })),
  };
}

/**
 * The slot under a point, or null when the finger is over no shelf at all —
 * which is a real answer, not a failure: releasing there cancels the move and
 * the bin flies home.
 *
 * `scrollY` is the map's *current* offset; the difference from the frozen one
 * is how far the rows have travelled under the finger since lift-off.
 */
export function hitTest(
  geometry: DragGeometry,
  point: { x: number; y: number },
  scrollY: number,
): DropSlot | null {
  const dy = scrollY - geometry.scrollY;
  for (const row of geometry.rows) {
    if (point.y < row.top - dy - ROW_SLOP) continue;
    if (point.y > row.bottom - dy + ROW_SLOP) continue;
    return { shelfId: row.shelfId, index: slotIndex(row.mids, point.x) };
  }
  return null;
}

/**
 * How many cards sit to the left of x — the insertion index. Separate so the
 * "past the last card lands at the end" rule is visible and testable.
 */
function slotIndex(mids: readonly number[], x: number): number {
  for (let i = 0; i < mids.length; i++) {
    if (x < mids[i]) return i;
  }
  return mids.length;
}

/**
 * Which bin a finger came down on, from live measurements.
 *
 * This is how one detector covers a whole wall of bins: the gesture asks the
 * layout what it grabbed instead of every card owning a handler that knows
 * it was grabbed. Unlike `hitTest` this reads the current rows, because at
 * the moment of the grab the current rows are the truth.
 */
export function binAt(
  rows: readonly RowMeasurement[],
  point: { x: number; y: number },
): string | null {
  for (const row of rows) {
    if (point.y < row.top || point.y > row.bottom) continue;
    for (const card of row.cards) {
      if (point.x >= card.x && point.x <= card.x + card.width) return card.binId;
    }
  }
  return null;
}

/**
 * How far to scroll when the finger is held near the top or bottom edge, so a
 * bin can reach a shelf that is off-screen without being put down first.
 * Returns points to add to the offset — 0 for the whole middle of the screen.
 */
export function autoScrollStep(
  pointY: number,
  viewport: { top: number; bottom: number },
  step = 10,
): number {
  /** Roughly a bin card: close enough to the edge to mean "keep going". */
  const EDGE = 70;
  if (pointY < viewport.top + EDGE) return -step;
  if (pointY > viewport.bottom - EDGE) return step;
  return 0;
}
