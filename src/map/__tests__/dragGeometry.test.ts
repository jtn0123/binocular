import {
  cellAt,
  composeWall,
  resolveDrop,
  rowAt,
  type CellRect,
  type RowRect,
} from '../dragGeometry';

/**
 * Under the withdrawn drag this logic was a native `measureInWindow` fan-out
 * and no test could reach it. As arithmetic over rects collected at layout, it
 * is ordinary code with ordinary tests.
 */
const CELLS: CellRect[] = [
  { binId: 'a', rowKey: 'shelf-1', shelfId: 'shelf-1', x: 0, y: 0, width: 100, height: 80 },
  { binId: 'b', rowKey: 'shelf-1', shelfId: 'shelf-1', x: 108, y: 0, width: 100, height: 80 },
  { binId: 'c', rowKey: 'shelf-2', shelfId: 'shelf-2', x: 0, y: 200, width: 100, height: 80 },
];

const ROWS: RowRect[] = [
  { rowKey: 'shelf-1', shelfId: 'shelf-1', y: 0, height: 90 },
  { rowKey: 'shelf-2', shelfId: 'shelf-2', y: 200, height: 90 },
  { rowKey: 'unshelved', shelfId: null, y: 300, height: 60 },
];

describe('finding what is under the finger', () => {
  it('finds a cell from a point inside it', () => {
    expect(cellAt({ x: 50, y: 40 }, CELLS)?.binId).toBe('a');
    expect(cellAt({ x: 150, y: 40 }, CELLS)?.binId).toBe('b');
  });

  it('counts the edges as inside', () => {
    expect(cellAt({ x: 0, y: 0 }, CELLS)?.binId).toBe('a');
    expect(cellAt({ x: 100, y: 80 }, CELLS)?.binId).toBe('a');
  });

  it('resolves the 8px gutter to nothing, not to a neighbour', () => {
    // A drop the user did not aim at is worse than a drop that does not
    // happen: only one of the two is obvious straight away.
    expect(cellAt({ x: 104, y: 40 }, CELLS)).toBeNull();
  });

  it('finds nothing below every cell', () => {
    expect(cellAt({ x: 50, y: 500 }, CELLS)).toBeNull();
  });

  it('finds a row from its vertical band', () => {
    expect(rowAt({ y: 85 }, ROWS)?.rowKey).toBe('shelf-1');
    expect(rowAt({ y: 250 }, ROWS)?.rowKey).toBe('shelf-2');
    expect(rowAt({ y: 150 }, ROWS)).toBeNull();
  });
});

describe('resolving a release into a drop', () => {
  it('releasing over a bin slides in front of it', () => {
    expect(resolveDrop({ x: 150, y: 40 }, CELLS, ROWS, 'a')).toEqual({
      shelfId: 'shelf-1',
      beforeBinId: 'b',
    });
  });

  it('releasing over empty space in a row appends to it', () => {
    expect(resolveDrop({ x: 300, y: 40 }, CELLS, ROWS, 'c')).toEqual({ shelfId: 'shelf-1' });
  });

  it('a cell beats the row it sits in', () => {
    const drop = resolveDrop({ x: 50, y: 220 }, CELLS, ROWS, 'a');
    expect(drop).toEqual({ shelfId: 'shelf-2', beforeBinId: 'c' });
  });

  it('releasing on the bin you are carrying is a cancel', () => {
    expect(resolveDrop({ x: 50, y: 40 }, CELLS, ROWS, 'a')).toBeNull();
  });

  it('releasing outside every row is not a drop', () => {
    // Guessing a destination here is how a bin ends up somewhere nobody chose.
    expect(resolveDrop({ x: 50, y: 900 }, CELLS, ROWS, 'a')).toBeNull();
  });

  it('handles the unshelved row, which has no shelf id', () => {
    expect(resolveDrop({ x: 50, y: 320 }, CELLS, ROWS, 'a')).toEqual({ shelfId: null });
  });

  it('copes with an empty map rather than throwing mid-gesture', () => {
    expect(resolveDrop({ x: 10, y: 10 }, [], [], 'a')).toBeNull();
    expect(cellAt({ x: 0, y: 0 }, [])).toBeNull();
    expect(rowAt({ y: 0 }, [])).toBeNull();
  });

  it('works with a negative offset, which overscroll produces', () => {
    expect(resolveDrop({ x: 50, y: -20 }, CELLS, ROWS, 'b')).toBeNull();
  });
});

/**
 * Composing the wall from the boxes each level reported.
 *
 * The first version added these up at the moment a child reported its layout,
 * which meant reading its ancestors' offsets before they had arrived — React
 * Native gives no ordering guarantee for `onLayout`, and a child commonly
 * reports first. Every cell was recorded as if its area and row sat at the
 * origin, so drops landed on whatever occupied the top of the wall.
 */
describe('composing the wall', () => {
  const boxes = {
    areas: new Map([['garage', { x: 0, y: 180, width: 400, height: 300 }]]),
    rows: new Map([
      ['shelf-1', { x: 0, y: 28, width: 400, height: 122 }],
      ['shelf-2', { x: 0, y: 160, width: 400, height: 122 }],
    ]),
    cellsBoxes: new Map([
      ['shelf-1', { x: 40, y: 34, width: 360, height: 76 }],
      ['shelf-2', { x: 40, y: 34, width: 360, height: 76 }],
    ]),
    cells: new Map([
      ['a', { x: 0, y: 0, width: 120, height: 76 }],
      ['b', { x: 128, y: 0, width: 120, height: 76 }],
      ['c', { x: 0, y: 0, width: 120, height: 76 }],
    ]),
  };
  const model = {
    rows: [
      { rowKey: 'shelf-1', areaKey: 'garage', shelfId: 'shelf-1', binIds: ['a', 'b'] },
      { rowKey: 'shelf-2', areaKey: 'garage', shelfId: 'shelf-2', binIds: ['c'] },
    ],
  };

  it('adds every level of offset, once', () => {
    const { cells } = composeWall(boxes, model);
    // 180 (area) + 28 (row) + 34 (cells container) + 0 (cell)
    expect(cells.find((c) => c.binId === 'a')).toMatchObject({ x: 40, y: 242 });
    expect(cells.find((c) => c.binId === 'b')).toMatchObject({ x: 168, y: 242 });
    // The second row sits 132 lower.
    expect(cells.find((c) => c.binId === 'c')).toMatchObject({ x: 40, y: 374 });
  });

  it('places rows in the same space as the cells inside them', () => {
    const { rows } = composeWall(boxes, model);
    expect(rows).toEqual([
      { rowKey: 'shelf-1', shelfId: 'shelf-1', y: 208, height: 122 },
      { rowKey: 'shelf-2', shelfId: 'shelf-2', y: 340, height: 122 },
    ]);
    // A cell must land inside its own row's band, or a near-miss on the cell
    // appends to a shelf the finger was never over.
    const { cells } = composeWall(boxes, model);
    const a = cells.find((c) => c.binId === 'a')!;
    expect(a.y).toBeGreaterThanOrEqual(rows[0].y);
    expect(a.y + a.height).toBeLessThanOrEqual(rows[0].y + rows[0].height);
  });

  /**
   * Boxes are cached per bin and never expire, so a bin that has left the wall
   * — deleted, or filtered out — leaves its rect behind at coordinates that
   * now belong to whatever slid up into the gap. `cellAt` returns the first
   * rect containing the point, so a leftover can win over the real cell and
   * send a bin somewhere nobody pointed at. Walking the model, not the cache,
   * is what stops that.
   */
  it('ignores boxes for bins that are no longer on the wall', () => {
    const shrunk = {
      rows: [{ rowKey: 'shelf-1', areaKey: 'garage', shelfId: 'shelf-1', binIds: ['a'] }],
    };
    const { cells, rows } = composeWall(boxes, shrunk);
    expect(cells.map((c) => c.binId)).toEqual(['a']);
    expect(rows.map((r) => r.rowKey)).toEqual(['shelf-1']);
  });

  /**
   * Before every box has arrived, a partial sum is not a smaller error than a
   * missing one — it is a confident wrong answer. Better to resolve to nothing
   * and have the bin put down, which is obvious and undoable.
   */
  it('leaves out anything whose layout has not been reported', () => {
    const { cells, rows } = composeWall({ ...boxes, areas: new Map() }, model);
    expect(cells).toEqual([]);
    expect(rows).toEqual([]);

    const noCellsBox = composeWall({ ...boxes, cellsBoxes: new Map() }, model);
    expect(noCellsBox.cells).toEqual([]);
    // The rows are still placeable, so a drop onto a shelf still works.
    expect(noCellsBox.rows).toHaveLength(2);
  });
});
