import {
  CONTROLS_THRESHOLD,
  DEFAULT_FILTER,
  DEFAULT_SORT,
  filterCounts,
  filterItems,
  isLowStock,
  sortItems,
  viewItems,
} from '../itemView';
import type { ItemRow } from '../queries';

function item(over: Partial<ItemRow> & { name: string }): ItemRow {
  return {
    id: over.name,
    bin_id: 'b1',
    brand: null,
    category: 'other',
    quantity: 1,
    label_text: null,
    photo_uri: null,
    notes: null,
    checked_out_to: null,
    low_stock_threshold: null,
    source_scan_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const items: ItemRow[] = [
  item({ name: 'Zip ties', quantity: 3, created_at: '2026-03-01T00:00:00Z' }),
  item({ name: 'anchors', quantity: 40, created_at: '2026-01-05T00:00:00Z' }),
  item({ name: 'Hammer', checked_out_to: 'Dad', created_at: '2026-02-01T00:00:00Z' }),
  item({ name: 'Wood glue', quantity: 1, low_stock_threshold: 2 }),
  item({ name: 'Sandpaper', quantity: 9, low_stock_threshold: 2 }),
];

describe('sorting a bin', () => {
  it('sorts by name without case tripping it up', () => {
    expect(sortItems(items, 'name').map((i) => i.name)).toEqual([
      'anchors',
      'Hammer',
      'Sandpaper',
      'Wood glue',
      'Zip ties',
    ]);
  });

  it('sorts by quantity, most first, ties broken by name', () => {
    const tied = [item({ name: 'Beta', quantity: 5 }), item({ name: 'Alpha', quantity: 5 })];
    expect(sortItems(tied, 'quantity').map((i) => i.name)).toEqual(['Alpha', 'Beta']);
    expect(sortItems(items, 'quantity')[0].name).toBe('anchors');
  });

  it('sorts by most recently added', () => {
    expect(
      sortItems(items, 'added')
        .slice(0, 2)
        .map((i) => i.name),
    ).toEqual(['Zip ties', 'Hammer']);
  });

  it('never mutates the caller’s array', () => {
    const original = [...items];
    sortItems(items, 'quantity');
    expect(items).toEqual(original);
  });
});

describe('filtering a bin', () => {
  it('shows everything by default', () => {
    expect(filterItems(items, 'all')).toHaveLength(items.length);
    expect(DEFAULT_FILTER).toBe('all');
    expect(DEFAULT_SORT).toBe('name');
  });

  it('finds what is checked out', () => {
    expect(filterItems(items, 'checked_out').map((i) => i.name)).toEqual(['Hammer']);
  });

  it('treats at-threshold as running low, the same rule Home uses', () => {
    expect(isLowStock(item({ name: 'x', quantity: 2, low_stock_threshold: 2 }))).toBe(true);
    expect(isLowStock(item({ name: 'x', quantity: 3, low_stock_threshold: 2 }))).toBe(false);
    // No threshold set means the item is not tracked for stock at all.
    expect(isLowStock(item({ name: 'x', quantity: 0 }))).toBe(false);
    expect(filterItems(items, 'low_stock').map((i) => i.name)).toEqual(['Wood glue']);
  });

  it('counts each filter for the control labels', () => {
    expect(filterCounts(items)).toEqual({ all: 5, checked_out: 1, low_stock: 1 });
  });
});

describe('the combined view', () => {
  it('filters first, then sorts what is left', () => {
    const lowFirst = viewItems(
      [
        item({ name: 'Bolts', quantity: 2, low_stock_threshold: 5 }),
        item({ name: 'Anchors', quantity: 4, low_stock_threshold: 5 }),
        item({ name: 'Plenty', quantity: 99 }),
      ],
      'quantity',
      'low_stock',
    );
    expect(lowFirst.map((i) => i.name)).toEqual(['Anchors', 'Bolts']);
  });

  it('keeps the controls out of the way of a small bin', () => {
    expect(CONTROLS_THRESHOLD).toBeGreaterThan(1);
  });
});
