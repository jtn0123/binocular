import type { DbAdapter } from './adapter';
import {
  createBin,
  createLocation,
  createShelf,
  listAllShelves,
  nextShortCode,
  type BinRow,
  type ShelfRow,
} from './queries';

/**
 * First-run scaffolding: the field test showed that a brand-new user with no
 * QR labels needs a one-tap way to get a bin. Bins require a shelf in a
 * location, so quick creation lazily builds a sensible default hierarchy
 * ("Workshop" / "Shelf A") the first time — the user can rename or
 * reorganize in Browse later. Manual, user-initiated creation only (the
 * AI-write invariant is untouched).
 */
export function ensureDefaultShelf(db: DbAdapter): ShelfRow {
  const shelves = listAllShelves(db);
  if (shelves.length > 0) return shelves[0];
  const location = createLocation(db, { name: 'Workshop' });
  return createShelf(db, { locationId: location.id, name: 'Shelf A' });
}

/** Create a bin in one tap: next sequential code, default shelf if needed. */
export function quickCreateBin(db: DbAdapter): BinRow {
  let bin: BinRow | null = null;
  db.withTransactionSync(() => {
    const shelf = ensureDefaultShelf(db);
    const shortCode = nextShortCode(db);
    bin = createBin(db, { name: `Bin ${shortCode}`, shortCode, shelfId: shelf.id });
  });
  if (!bin) throw new Error('quickCreateBin: transaction did not run');
  return bin;
}
