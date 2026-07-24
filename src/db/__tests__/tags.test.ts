import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import { createBin, insertItem, itemsForBin, softDeleteItem } from '../queries';
import { runMigrations } from '../schema';
import {
  binTagTally,
  createTag,
  deleteTag,
  FALLBACK_TAG,
  getTag,
  listTagSlugs,
  renameTag,
  resolveTag,
  SEEDED_TAG_SLUGS,
  tagUsageCounts,
  TagError,
  toSlug,
} from '../tags';

describe('tag vocabulary (D19)', () => {
  let db: NodeDbAdapter;
  let binId: string;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    binId = createBin(db, { name: 'Fixings', shortCode: 'B-001' }).id;
  });
  afterEach(() => {
    db.close();
  });

  it('the exported seed list matches what migration 008 actually inserts', () => {
    // scripts/eval.ts has no database and uses SEEDED_TAG_SLUGS; this is what
    // stops the two drifting apart.
    expect(listTagSlugs(db)).toEqual([...SEEDED_TAG_SLUGS]);
  });

  it('migration 008 seeds the twelve tags that used to be hardcoded', () => {
    expect(listTagSlugs(db)).toEqual([
      'hand_tool',
      'power_tool',
      'fastener',
      'electrical',
      'plumbing',
      'adhesive_finish',
      'safety',
      'measuring',
      'bit_blade_accessory',
      'hardware',
      'material',
      'other',
    ]);
  });

  describe('slugs', () => {
    it('turns a typed name into a legal slug', () => {
      expect(toSlug('Marine hardware')).toBe('marine_hardware');
      expect(toSlug('  Paint & finish  ')).toBe('paint_finish');
      expect(toSlug('3M tape')).toBe('3m_tape');
    });

    it('refuses names with nothing usable in them', () => {
      expect(toSlug('')).toBeNull();
      expect(toSlug('   ')).toBeNull();
      expect(toSlug('!!!')).toBeNull();
    });

    it('produces a slug the §6.1 AI contract would accept', () => {
      expect(toSlug('Garden & Yard')).toMatch(/^[a-z0-9_]+$/);
    });
  });

  describe('creating', () => {
    it('adds a tag that the picker will then offer', () => {
      const tag = createTag(db, 'Marine');
      expect(tag).toMatchObject({ slug: 'marine', label: 'Marine' });
      expect(listTagSlugs(db)).toContain('marine');
    });

    it('refuses a duplicate', () => {
      createTag(db, 'Marine');
      expect(() => createTag(db, 'marine')).toThrow(TagError);
    });

    it('refuses an empty name', () => {
      expect(() => createTag(db, '  ')).toThrow(TagError);
    });
  });

  describe('renaming', () => {
    it('carries every item with it', () => {
      insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      insertItem(db, { binId, name: 'Junction box', category: 'electrical' });
      insertItem(db, { binId, name: 'Deck screws', category: 'fastener' });

      renameTag(db, 'electrical', 'Electrical & wiring');

      expect(getTag(db, 'electrical')).toBeNull();
      expect(getTag(db, 'electrical_wiring')?.label).toBe('Electrical & wiring');
      const items = itemsForBin(db, binId);
      expect(items.filter((i) => i.category === 'electrical_wiring')).toHaveLength(2);
      // An unrelated tag is untouched.
      expect(items.filter((i) => i.category === 'fastener')).toHaveLength(1);
      // Nothing is left pointing at a tag that no longer exists.
      expect(items.some((i) => i.category === 'electrical')).toBe(false);
    });

    it('carries recently-deleted items too, so a restore is not a ghost', () => {
      const item = insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      softDeleteItem(db, item.id);

      renameTag(db, 'electrical', 'Sparky');

      const snapshot = db.getFirstSync<{ category: string }>(
        'SELECT category FROM deleted_items WHERE id = ?',
        [item.id],
      );
      expect(snapshot?.category).toBe('sparky');
    });

    it('relabels without touching items when the slug is unchanged', () => {
      insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      renameTag(db, 'electrical', 'Electrical');
      expect(getTag(db, 'electrical')?.label).toBe('Electrical');
      expect(itemsForBin(db, binId)[0].category).toBe('electrical');
    });

    it('refuses to collide with an existing tag', () => {
      expect(() => renameTag(db, 'electrical', 'Plumbing')).toThrow(TagError);
    });
  });

  describe('deleting', () => {
    it('reassigns its items to other rather than orphaning them', () => {
      insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      insertItem(db, { binId, name: 'Conduit', category: 'electrical' });

      expect(deleteTag(db, 'electrical')).toEqual({ reassigned: 2 });
      expect(getTag(db, 'electrical')).toBeNull();
      expect(itemsForBin(db, binId).every((i) => i.category === FALLBACK_TAG)).toBe(true);
    });

    it('never deletes the fallback tag', () => {
      expect(() => deleteTag(db, FALLBACK_TAG)).toThrow(TagError);
      expect(getTag(db, FALLBACK_TAG)).not.toBeNull();
    });

    it('reports zero when nothing was using it', () => {
      expect(deleteTag(db, 'plumbing')).toEqual({ reassigned: 0 });
    });
  });

  it('counts usage per tag for the manage screen', () => {
    insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
    insertItem(db, { binId, name: 'Conduit', category: 'electrical' });
    insertItem(db, { binId, name: 'Deck screws', category: 'fastener' });
    expect(tagUsageCounts(db)).toEqual({ electrical: 2, fastener: 1 });
  });

  describe('what a bin actually holds', () => {
    it('tallies its tags, commonest first', () => {
      insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      insertItem(db, { binId, name: 'Conduit', category: 'electrical' });
      insertItem(db, { binId, name: 'Junction box', category: 'electrical' });
      insertItem(db, { binId, name: 'Deck screws', category: 'fastener' });

      expect(binTagTally(db, binId)).toEqual([
        { slug: 'electrical', label: 'Electrical', count: 3 },
        { slug: 'fastener', label: 'Fastener', count: 1 },
      ]);
    });

    it('shows the tag label, so a rename is reflected immediately', () => {
      insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
      renameTag(db, 'electrical', 'Sparky bits');
      expect(binTagTally(db, binId)[0]).toMatchObject({ label: 'Sparky bits' });
    });

    it('caps the list so a mixed bin does not print a paragraph', () => {
      for (const category of ['electrical', 'fastener', 'plumbing', 'safety']) {
        insertItem(db, { binId, name: `${category} thing`, category });
      }
      expect(binTagTally(db, binId)).toHaveLength(3);
      expect(binTagTally(db, binId, 10)).toHaveLength(4);
    });

    it('is empty for an empty bin', () => {
      expect(binTagTally(db, binId)).toEqual([]);
    });
  });

  describe('resolving outside input (§6.1)', () => {
    it('passes a tag this workshop has', () => {
      expect(resolveTag(db, 'electrical')).toBe('electrical');
    });

    it('maps an unknown tag to other instead of failing the scan', () => {
      expect(resolveTag(db, 'marine')).toBe(FALLBACK_TAG);
      createTag(db, 'Marine');
      expect(resolveTag(db, 'marine')).toBe('marine');
    });

    it('maps a tag the user just deleted', () => {
      deleteTag(db, 'plumbing');
      expect(resolveTag(db, 'plumbing')).toBe(FALLBACK_TAG);
    });
  });
});
