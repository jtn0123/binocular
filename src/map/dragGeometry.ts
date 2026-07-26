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

// ------------------------------------------------------- composing the wall

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What each level of the map reported about itself, each in its own parent's
 * coordinates — never pre-added together.
 *
 * Adding them at the moment a child reports was the original design and it was
 * wrong: React Native promises no order for `onLayout`, and a child commonly
 * reports before its parent, so the ancestors' offsets were still absent and
 * silently read as zero. Every cell was then recorded near the top of the
 * wall, and drops landed on whatever happened to be there — which on a device
 * is a drag that "works" only for the first shelf.
 *
 * Keeping the levels apart makes the composition order-independent: whatever
 * sequence the layout events arrive in, the sum is only taken once every part
 * of it exists, which is at the moment a finger actually asks.
 */
export interface WallBoxes {
  /** Each area within the scroll content, by area key. */
  areas: ReadonlyMap<string, Box>;
  /** Each row within its area, by row key. */
  rows: ReadonlyMap<string, Box>;
  /** Each row's cells container within that row, by row key. */
  cellsBoxes: ReadonlyMap<string, Box>;
  /** Each cell within its cells container, by bin id. */
  cells: ReadonlyMap<string, Box>;
}

/** The wall as the database currently describes it — the list of what exists. */
export interface WallModel {
  rows: readonly {
    rowKey: string;
    areaKey: string;
    shelfId: string | null;
    binIds: readonly string[];
  }[];
}

/**
 * Absolute, scroll-content-space rects for everything currently on the wall.
 *
 * Driven by the model rather than by the collected boxes, which is what keeps
 * the drag honest across a move: layout boxes are cached per bin and never
 * expire, so a bin that has left a row leaves its rect behind at coordinates
 * that now belong to whichever bin slid up into the gap. Walking the model
 * means anything no longer on the wall simply is not considered.
 *
 * A level whose box has not been reported yet is skipped rather than assumed
 * to sit at zero. A drop that does not happen is recoverable in a way that a
 * drop onto the wrong shelf is not.
 */
export function composeWall(
  boxes: WallBoxes,
  model: WallModel,
): { cells: CellRect[]; rows: RowRect[] } {
  const cells: CellRect[] = [];
  const rows: RowRect[] = [];

  for (const row of model.rows) {
    const area = boxes.areas.get(row.areaKey);
    const rowBox = boxes.rows.get(row.rowKey);
    if (!area || !rowBox) continue;

    rows.push({
      rowKey: row.rowKey,
      shelfId: row.shelfId,
      y: area.y + rowBox.y,
      height: rowBox.height,
    });

    const cellsBox = boxes.cellsBoxes.get(row.rowKey);
    if (!cellsBox) continue;
    for (const binId of row.binIds) {
      const cell = boxes.cells.get(binId);
      if (!cell) continue;
      cells.push({
        binId,
        rowKey: row.rowKey,
        shelfId: row.shelfId,
        x: area.x + rowBox.x + cellsBox.x + cell.x,
        y: area.y + rowBox.y + cellsBox.y + cell.y,
        width: cell.width,
        height: cell.height,
      });
    }
  }

  return { cells, rows };
}

/**
 * The cell containing a point, or null.
 *
 * Gutters between cells deliberately resolve to nothing rather than to the
 * nearest neighbour: a drop the user did not aim at is worse than a drop that
 * does not happen, because only one of the two is obvious immediately.
 */
export function cellAt(
  point: { x: number; y: number },
  rects: readonly CellRect[],
): CellRect | null {
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
