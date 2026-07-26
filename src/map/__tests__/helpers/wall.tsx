import { fireEvent, within, type RenderResult } from '@testing-library/react-native';

/**
 * A synthetic wall: real layout geometry pushed into a rendered map.
 *
 * The drag's hit-test is arithmetic over rects gathered from `onLayout`
 * (src/map/dragGeometry.ts). Under jest nothing lays anything out, so every
 * rect is absent and every drop resolves to nothing — which is why the drag
 * could ship with a green suite and still be wrong on the device. This drives
 * the layout pass by hand with positions a real phone would produce, so the
 * arithmetic is exercised against a known truth.
 *
 * The numbers below are deliberately large and distinct at every nesting
 * level. A cell's content-space position is the sum of four offsets — area,
 * row, cells-container, cell — and if the screen drops or mis-orders any one
 * of them, the finger lands in a *different cell*, not merely a few pixels
 * off. A geometry with small offsets would let that bug pass.
 */
const SCROLL_TOP = 56; // ScrollView's y within the screen (header chrome)
const HEAT_BAR = 180; // tint row + legend, above the first area
const AREA_HEAD = 28; // area title, above its first row
const AREA_GAP = 24;
const ROW_HEAD = 34; // shelf name + actions, above the cells container
const ROW_GAP = 10;
const CELLS_X = 40; // cells container inset within the row
const CELL_W = 120;
const CELL_H = 76;
const CELL_GAP = 8;
const ROW_H = ROW_HEAD + CELL_H + 12;

interface Placed {
  /** Testing-library element to fire `layout` on. */
  el: unknown;
  depth: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface Wall {
  /** Gesture-space point at the centre of a cell, by short code. */
  onCell(code: string): { x: number; y: number };
  /** Gesture-space point in a row's empty space, right of its last cell. */
  onRowGap(rowIndex: number): { x: number; y: number };
  /** Gesture-space point below every row — a release over nothing. */
  offWall(): { x: number; y: number };
  /** Scroll-content-space position of a cell's centre, for assertions. */
  contentOf(code: string): { x: number; y: number };
}

export interface LayoutOptions {
  /**
   * Which end of the tree reports its layout first.
   *
   * React Native does not promise an order, and the screen must produce the
   * same rects either way — so both are exercised. `children` is the one that
   * catches a parent offset being read before it has been written.
   */
  order?: 'children-first' | 'parents-first';
  /** Content offset to report, as if the wall had been scrolled. */
  scrollY?: number;
}

/**
 * Lay out every area, row and cell the map has drawn, then return the
 * coordinates a finger would use to touch them.
 */
export async function layoutWall(
  screen: RenderResult,
  { order = 'children-first', scrollY = 0 }: LayoutOptions = {},
): Promise<Wall> {
  const placed: Placed[] = [];
  const cellContent = new Map<string, { x: number; y: number }>();
  const rowContent: { y: number; height: number; lastCellRight: number }[] = [];

  const scroll = screen.getByTestId('map-scroll');
  placed.push({
    el: scroll,
    depth: 0,
    rect: { x: 0, y: SCROLL_TOP, width: 400, height: 600 },
  });

  const areas = screen.getAllByTestId(/^map-area-/);
  let areaY = HEAT_BAR;
  for (const area of areas) {
    const rows = within(area).queryAllByTestId(/^map-row-/);
    const areaHeight = AREA_HEAD + rows.length * (ROW_H + ROW_GAP);
    placed.push({ el: area, depth: 1, rect: { x: 0, y: areaY, width: 400, height: areaHeight } });

    let rowY = AREA_HEAD;
    for (const row of rows) {
      placed.push({ el: row, depth: 2, rect: { x: 0, y: rowY, width: 400, height: ROW_H } });

      const cellsEl = within(row).getAllByTestId(/^map-cells-/)[0];
      placed.push({
        el: cellsEl,
        depth: 3,
        rect: { x: CELLS_X, y: ROW_HEAD, width: 360, height: CELL_H },
      });

      const cells = within(cellsEl).queryAllByTestId(/^map-cell-/);
      let cellX = 0;
      for (const cell of cells) {
        placed.push({
          el: cell,
          depth: 4,
          rect: { x: cellX, y: 0, width: CELL_W, height: CELL_H },
        });
        const code = String(cell.props.testID).replace('map-cell-', '');
        // Areas and rows are full-width and start at x = 0, so only the cells
        // container insets horizontally. Vertically all four levels stack.
        cellContent.set(code, {
          x: CELLS_X + cellX + CELL_W / 2,
          y: areaY + rowY + ROW_HEAD + CELL_H / 2,
        });
        cellX += CELL_W + CELL_GAP;
      }

      rowContent.push({
        y: areaY + rowY,
        height: ROW_H,
        lastCellRight: CELLS_X + cellX,
      });
      rowY += ROW_H + ROW_GAP;
    }
    areaY += areaHeight + AREA_GAP;
  }

  const bottom = areaY;

  const sorted = [...placed].sort((a, b) =>
    order === 'children-first' ? b.depth - a.depth : a.depth - b.depth,
  );
  for (const { el, rect } of sorted) {
    await fireEvent(el as Parameters<typeof fireEvent>[0], 'layout', {
      nativeEvent: { layout: rect },
    });
  }

  if (scrollY !== 0) {
    await fireEvent(scroll, 'scroll', {
      nativeEvent: {
        contentOffset: { x: 0, y: scrollY },
        contentSize: { width: 400, height: bottom },
        layoutMeasurement: { width: 400, height: 600 },
      },
    });
  }

  /** Content space → gesture space (relative to the detector). */
  const toGesture = (p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y + SCROLL_TOP - scrollY,
  });

  return {
    contentOf(code) {
      const p = cellContent.get(code);
      if (!p) throw new Error(`no cell ${code} on the wall`);
      return p;
    },
    onCell(code) {
      const p = cellContent.get(code);
      if (!p) throw new Error(`no cell ${code} on the wall`);
      return toGesture(p);
    },
    onRowGap(rowIndex) {
      const row = rowContent[rowIndex];
      if (!row) throw new Error(`no row ${rowIndex} on the wall`);
      return toGesture({ x: row.lastCellRight + 30, y: row.y + row.height / 2 });
    },
    offWall() {
      return toGesture({ x: 200, y: bottom + 120 });
    },
  };
}
