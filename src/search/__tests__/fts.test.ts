import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { searchItems, searchPlaces, toFtsQuery } from '../fts';

describe('FTS search (blueprint §8.3)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
  });

  describe('toFtsQuery', () => {
    it('builds quoted prefix tokens', () => {
      expect(toFtsQuery('scre')).toBe('"scre"*');
      expect(toFtsQuery('deck screw')).toBe('"deck"* "screw"*');
    });

    it('survives user punctuation that would break FTS grammar', () => {
      expect(toFtsQuery('3" screws (deck)')).toBe('"3"* "screws"* "deck"*');
      expect(toFtsQuery('AND OR NOT')).toBe('"AND"* "OR"* "NOT"*');
      expect(toFtsQuery('   ')).toBeNull();
      expect(toFtsQuery('()"')).toBeNull();
    });
  });

  it('prefix search finds items and updates track renames and deletes', () => {
    const bin = createBin(db, { name: 'Hand tools', shortCode: 'B-001' });
    const item = insertItem(db, {
      binId: bin.id,
      name: 'Phillips screwdriver',
      category: 'hand_tool',
    });

    expect(searchItems(db, 'scre').map((r) => r.name)).toEqual(['Phillips screwdriver']);

    db.runSync('UPDATE items SET name = ? WHERE id = ?', ['Flat pry bar', item.id]);
    expect(searchItems(db, 'scre')).toHaveLength(0);
    expect(searchItems(db, 'pry').map((r) => r.name)).toEqual(['Flat pry bar']);

    db.runSync('DELETE FROM items WHERE id = ?', [item.id]);
    expect(searchItems(db, 'pry')).toHaveLength(0);
  });

  it('finds items by their tag, ranked below a name match', () => {
    const bin = createBin(db, { name: 'Fixings', shortCode: 'B-004' });
    insertItem(db, { binId: bin.id, name: 'Deck screws', category: 'fastener' });
    insertItem(db, { binId: bin.id, name: 'Wall plugs', category: 'fastener' });
    // The editor calls this field "Tag", so the tag has to be searchable.
    expect(
      searchItems(db, 'fastener')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['Deck screws', 'Wall plugs']);

    // An item actually *named* for the term still comes first.
    insertItem(db, { binId: bin.id, name: 'Fastener assortment box', category: 'hardware' });
    expect(searchItems(db, 'fastener')[0].name).toBe('Fastener assortment box');
  });

  describe('shelves and locations', () => {
    beforeEach(() => {
      const garage = createLocation(db, { name: 'Garage' });
      const shed = createLocation(db, { name: 'Garden shed' });
      createShelf(db, { locationId: garage.id, name: 'Workbench shelf' });
      createShelf(db, { locationId: shed.id, name: 'Top shelf' });
    });

    it('finds a shelf by name, with the location it sits in', () => {
      expect(searchPlaces(db, 'workbench')).toEqual([
        {
          kind: 'shelf',
          id: expect.any(String),
          name: 'Workbench shelf',
          parentName: 'Garage',
        },
      ]);
    });

    it('finds a location by name', () => {
      expect(searchPlaces(db, 'garden')).toEqual([
        { kind: 'location', id: expect.any(String), name: 'Garden shed', parentName: null },
      ]);
    });

    it('lists locations before shelves when both match', () => {
      const benchArea = createLocation(db, { name: 'Bench area' });
      createShelf(db, { locationId: benchArea.id, name: 'Bench shelf' });

      const hits = searchPlaces(db, 'bench');
      expect(hits[0]).toMatchObject({ kind: 'location', name: 'Bench area' });
      expect(
        hits
          .slice(1)
          .map((h) => h.name)
          .sort(),
      ).toEqual(['Bench shelf', 'Workbench shelf']);
    });

    it('is case-insensitive and matches mid-name', () => {
      expect(searchPlaces(db, 'BENCH').map((h) => h.name)).toEqual(['Workbench shelf']);
    });

    it('treats user wildcards as text, not operators', () => {
      expect(searchPlaces(db, '%')).toEqual([]);
      expect(searchPlaces(db, '_')).toEqual([]);
    });

    it('returns nothing for a place that does not exist', () => {
      expect(searchPlaces(db, 'attic')).toEqual([]);
    });
  });

  it('matches label_text and notes, and carries the full breadcrumb', () => {
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-002', shelfId: shelf.id });
    insertItem(db, {
      binId: bin.id,
      name: 'Deck screws',
      category: 'fastener',
      labelText: 'GRK R4 #9 x 2-1/2 in',
    });

    const results = searchItems(db, 'grk');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'Deck screws',
      binCode: 'B-002',
      binName: 'Fasteners',
      shelfName: 'Shelf A',
      locationName: 'Garage',
    });
  });

  it('ranks name hits above label_text hits', () => {
    const bin = createBin(db, { name: 'Misc', shortCode: 'B-001' });
    insertItem(db, {
      binId: bin.id,
      name: 'Wood glue',
      category: 'adhesive_finish',
      labelText: 'clamp before drying',
    });
    insertItem(db, { binId: bin.id, name: 'Bar clamp', category: 'hand_tool' });

    const results = searchItems(db, 'clamp');
    expect(results.map((r) => r.name)).toEqual(['Bar clamp', 'Wood glue']);
  });

  it('unassigned-bin items still resolve with null breadcrumb parts', () => {
    const bin = createBin(db, { name: 'Loose', shortCode: 'B-009' });
    insertItem(db, { binId: bin.id, name: 'Zip ties', category: 'hardware' });
    const results = searchItems(db, 'zip');
    expect(results[0].binCode).toBe('B-009');
    expect(results[0].shelfName).toBeNull();
    expect(results[0].locationName).toBeNull();
  });

  it('searches 1,000 items in under 100ms (blueprint AC)', () => {
    const bin = createBin(db, { name: 'Big bin', shortCode: 'B-001' });
    db.withTransactionSync(() => {
      for (let i = 0; i < 1000; i++) {
        insertItem(db, {
          binId: bin.id,
          name: `Item ${i} ${i % 7 === 0 ? 'screwdriver' : 'widget'}`,
          category: 'other',
          labelText: `label ${i}`,
        });
      }
    });
    const start = performance.now();
    const results = searchItems(db, 'screw');
    const elapsed = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});
