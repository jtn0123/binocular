import type { DbAdapter } from './adapter';
import {
  createBin,
  createLocation,
  createShelf,
  insertItem,
  listLocations,
} from './queries';

/**
 * Demo data for development and manual testing: 1 location, 2 shelves,
 * 4 bins, 12 items. Deterministic ids so re-runs and tests are stable.
 * No-op unless the database is completely empty.
 */
export function seedIfEmpty(db: DbAdapter): boolean {
  if (listLocations(db).length > 0) return false;

  db.withTransactionSync(() => {
    const garage = createLocation(db, { id: 'seed-loc-garage', name: 'Garage' });
    const shelfA = createShelf(db, { id: 'seed-shelf-a', locationId: garage.id, name: 'Shelf A' });
    const shelfB = createShelf(db, { id: 'seed-shelf-b', locationId: garage.id, name: 'Shelf B' });

    const electrical = createBin(db, {
      id: 'seed-bin-1',
      shortCode: 'B-001',
      name: 'Electrical connectors',
      shelfId: shelfA.id,
    });
    const fasteners = createBin(db, {
      id: 'seed-bin-2',
      shortCode: 'B-002',
      name: 'Fasteners',
      shelfId: shelfA.id,
    });
    const handTools = createBin(db, {
      id: 'seed-bin-3',
      shortCode: 'B-003',
      name: 'Hand tools',
      shelfId: shelfB.id,
    });
    const adhesives = createBin(db, {
      id: 'seed-bin-4',
      shortCode: 'B-004',
      name: 'Adhesives & finish',
      shelfId: shelfB.id,
    });

    insertItem(db, {
      id: 'seed-item-01',
      binId: electrical.id,
      name: 'Wire nuts',
      category: 'electrical',
      quantity: 40,
      labelText: 'Ideal 341 orange wire connectors, 100 ct',
      lowStockThreshold: 10,
    });
    insertItem(db, {
      id: 'seed-item-02',
      binId: electrical.id,
      name: 'Spade terminals',
      category: 'electrical',
      quantity: 25,
    });
    insertItem(db, {
      id: 'seed-item-03',
      binId: electrical.id,
      name: 'Heat shrink tubing',
      category: 'electrical',
      quantity: 1,
      notes: 'Assorted diameters, mostly black',
    });
    insertItem(db, {
      id: 'seed-item-04',
      binId: fasteners.id,
      name: 'Deck screws',
      category: 'fastener',
      quantity: 200,
      brand: 'GRK',
      labelText: 'GRK R4 #9 x 2-1/2 in',
      lowStockThreshold: 50,
    });
    insertItem(db, {
      id: 'seed-item-05',
      binId: fasteners.id,
      name: 'Drywall anchors',
      category: 'fastener',
      quantity: 30,
    });
    insertItem(db, {
      id: 'seed-item-06',
      binId: fasteners.id,
      name: 'M6 hex bolts',
      category: 'fastener',
      quantity: 18,
    });
    insertItem(db, {
      id: 'seed-item-07',
      binId: handTools.id,
      name: 'Phillips screwdriver',
      category: 'hand_tool',
      quantity: 3,
    });
    insertItem(db, {
      id: 'seed-item-08',
      binId: handTools.id,
      name: 'Adjustable wrench',
      category: 'hand_tool',
      quantity: 1,
      brand: 'Crescent',
    });
    insertItem(db, {
      id: 'seed-item-09',
      binId: handTools.id,
      name: 'Tape measure',
      category: 'measuring',
      quantity: 2,
      brand: 'Stanley',
    });
    insertItem(db, {
      id: 'seed-item-10',
      binId: handTools.id,
      name: 'Needle-nose pliers',
      category: 'hand_tool',
      quantity: 1,
    });
    insertItem(db, {
      id: 'seed-item-11',
      binId: adhesives.id,
      name: 'Wood glue',
      category: 'adhesive_finish',
      quantity: 1,
      brand: 'Titebond',
      labelText: 'Titebond III Ultimate, 16 oz',
    });
    insertItem(db, {
      id: 'seed-item-12',
      binId: adhesives.id,
      name: "Painter's tape",
      category: 'adhesive_finish',
      quantity: 2,
      lowStockThreshold: 1,
    });
  });
  return true;
}
