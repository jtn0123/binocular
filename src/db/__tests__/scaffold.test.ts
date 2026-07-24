import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import { createLocation, createShelf, getBin, listAllShelves, listLocations } from '../queries';
import { ensureDefaultShelf, quickCreateBin } from '../scaffold';
import { runMigrations } from '../schema';

describe('first-run scaffolding (field-test finding: no-QR bin creation)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  it('creates Workshop / Shelf A on a completely empty database', () => {
    const shelf = ensureDefaultShelf(db);
    expect(shelf.name).toBe('Shelf A');
    const locations = listLocations(db);
    expect(locations).toHaveLength(1);
    expect(locations[0].name).toBe('Workshop');
    expect(shelf.location_id).toBe(locations[0].id);
  });

  it('reuses an existing shelf instead of scaffolding a duplicate', () => {
    const location = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: location.id, name: 'Top shelf' });
    expect(ensureDefaultShelf(db).id).toBe(shelf.id);
    expect(listLocations(db)).toHaveLength(1);
    expect(listAllShelves(db)).toHaveLength(1);
  });

  it('quickCreateBin makes a shelved bin with the next sequential code', () => {
    const first = quickCreateBin(db);
    expect(first.short_code).toBe('B-001');
    expect(first.name).toBe('Bin B-001');
    expect(first.shelf_id).not.toBeNull();

    const second = quickCreateBin(db);
    expect(second.short_code).toBe('B-002');
    // Same default shelf, no duplicate scaffolding.
    expect(second.shelf_id).toBe(first.shelf_id);
    expect(listLocations(db)).toHaveLength(1);
    expect(getBin(db, second.id)).not.toBeNull();
  });
});
