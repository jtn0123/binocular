import { cellAt, resolveDrop, rowAt, type CellRect, type RowRect } from '../dragGeometry';

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
