import type { ItemRow } from './queries';

/**
 * Ordering and filtering for a bin's contents (field-test finding: a bin with
 * forty things in it was an undifferentiated alphabetical wall — "what's
 * checked out of here?" meant reading every row).
 *
 * Pure functions over rows the caller already has: no extra query, no index,
 * and the bin screen stays a view rather than a second source of truth about
 * what "running low" means.
 */
export type ItemSort = 'name' | 'quantity' | 'added';
export type ItemFilter = 'all' | 'checked_out' | 'low_stock';

export const DEFAULT_SORT: ItemSort = 'name';
export const DEFAULT_FILTER: ItemFilter = 'all';

/** Below this a bin reads fine as a plain list; the controls are noise. */
export const CONTROLS_THRESHOLD = 6;

/** Same rule as the Home "Running low" block, in one place. */
export function isLowStock(item: ItemRow): boolean {
  return item.low_stock_threshold !== null && item.quantity <= item.low_stock_threshold;
}

export function filterItems(items: readonly ItemRow[], filter: ItemFilter): ItemRow[] {
  switch (filter) {
    case 'checked_out':
      return items.filter((item) => item.checked_out_to !== null);
    case 'low_stock':
      return items.filter(isLowStock);
    case 'all':
    default:
      return [...items];
  }
}

export function sortItems(items: readonly ItemRow[], sort: ItemSort): ItemRow[] {
  const byName = (a: ItemRow, b: ItemRow) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sorted = [...items];
  switch (sort) {
    case 'quantity':
      // Most-of first — "what do I have a pile of?" — name breaking ties so
      // the order is stable rather than whatever SQLite happened to return.
      return sorted.sort((a, b) => b.quantity - a.quantity || byName(a, b));
    case 'added':
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b));
    case 'name':
    default:
      return sorted.sort(byName);
  }
}

export function viewItems(
  items: readonly ItemRow[],
  sort: ItemSort,
  filter: ItemFilter,
): ItemRow[] {
  return sortItems(filterItems(items, filter), sort);
}

/** How many rows each filter would show — for labelling the controls. */
export function filterCounts(items: readonly ItemRow[]): Record<ItemFilter, number> {
  return {
    all: items.length,
    checked_out: items.filter((item) => item.checked_out_to !== null).length,
    low_stock: items.filter(isLowStock).length,
  };
}
