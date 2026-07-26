/**
 * Where every cell sits inside the map's scroll content, and what a finger at
 * a given point is over.
 *
 * Pure and unit-tested, deliberately. The withdrawn drag resolved a drop by
 * calling `measureInWindow` on every registered target and awaiting
 * `Promise.all` — a native fan-out no test could reach, and one that hangs
 * forever on RN 0.86 Fabric when a node has unmounted (the callback is simply
 * never invoked, so the promise never settles). Rects are collected from
 * `onLayout` as the map draws instead, and the question "what is under the
 * finger" becomes arithmetic.
 */

export interface CellRect {
  binId: string;
  /** Row this cell belongs to, so a drop can name its destination shelf. */
  rowKey: string;
  shelfId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RowRect {
  rowKey: string;
  shelfId: string | null;
  y: number;
  height: number;
}

export interface DropResolution {
  shelfId: string | null;
  /** Slide in front of this bin, or append to the row when absent. */
  beforeBinId?: string;
}

/**
 * The cell containing a point, or null.
 *
 * Gutters between cells deliberately resolve to nothing rather than to the
 * nearest neighbour: a drop the user did not aim at is worse than a drop that
 * does not happen, because only one of the two is obvious immediately.
 */
export function cellAt(point: { x: number; y: number }, rects: readonly CellRect[]): CellRect | null {
  for (const rect of rects) {
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      return rect;
    }
  }
  return null;
}

/** The row whose vertical band contains a point, or null. */
export function rowAt(point: { y: number }, rows: readonly RowRect[]): RowRect | null {
  for (const row of rows) {
    if (point.y >= row.y && point.y <= row.y + row.height) return row;
  }
  return null;
}

/**
 * What releasing at this point means.
 *
 * Cell beats row: releasing over a bin slides in front of it, releasing
 * anywhere else in the row appends. Releasing outside every row is not a drop
 * — the caller cancels rather than guessing a destination.
 */
export function resolveDrop(
  point: { x: number; y: number },
  rects: readonly CellRect[],
  rows: readonly RowRect[],
  draggedBinId: string,
): DropResolution | null {
  const cell = cellAt(point, rects);
  if (cell) {
    // Releasing on the bin you are carrying is a cancel, not a no-op move.
    if (cell.binId === draggedBinId) return null;
    return { shelfId: cell.shelfId, beforeBinId: cell.binId };
  }
  const row = rowAt(point, rows);
  if (row) return { shelfId: row.shelfId };
  return null;
}
