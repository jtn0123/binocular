import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import { createBin, insertItem } from '../queries';
import { runMigrations } from '../schema';
import { createTag, deleteTag } from '../tags';
import {
  findDuplicate,
  meaningfulTokens,
  pickSuggestion,
  suggestTag,
  tagSupportFor,
} from '../tagSuggest';

describe('tokens worth scoring', () => {
  it('keeps words long enough to mean something, lowercased and deduped', () => {
    expect(meaningfulTokens('Deck Screws deck')).toEqual(['deck', 'screws']);
  });

  it('drops noise that would match half the workshop', () => {
    // "10" and "in" say nothing about which tag an item belongs to.
    expect(meaningfulTokens('10 mm in')).toEqual([]);
    expect(meaningfulTokens('')).toEqual([]);
  });

  it('splits on punctuation the same way search does', () => {
    expect(meaningfulTokens('3/8" drive socket')).toEqual(['drive', 'socket']);
  });
});

describe('picking a winner', () => {
  it('takes a clear leader', () => {
    expect(pickSuggestion({ electrical: 6, fastener: 1 })).toEqual({
      slug: 'electrical',
      support: 6,
    });
  });

  it('says nothing when the evidence is thin', () => {
    // One past item is a coincidence, not a pattern.
    expect(pickSuggestion({ electrical: 1 })).toBeNull();
    expect(pickSuggestion({})).toBeNull();
  });

  it('says nothing when the history is split', () => {
    // Mis-filing an item silently is worse than not guessing.
    expect(pickSuggestion({ electrical: 3, fastener: 3 })).toBeNull();
    expect(pickSuggestion({ electrical: 4, fastener: 3 })).toBeNull();
  });

  it('never suggests the fallback tag', () => {
    expect(pickSuggestion({ other: 99 })).toBeNull();
    // ...but a real tag still wins past a pile of `other`.
    expect(pickSuggestion({ other: 99, electrical: 4 })).toMatchObject({ slug: 'electrical' });
  });

  it('breaks exact ties deterministically rather than at random', () => {
    expect(pickSuggestion({ zzz: 5, aaa: 5 })).toBeNull();
  });
});

describe('learning from this workshop', () => {
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

  function history() {
    insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
    insertItem(db, { binId, name: 'Wire strippers', category: 'electrical' });
    insertItem(db, { binId, name: 'Speaker wire', category: 'electrical' });
    insertItem(db, { binId, name: 'Deck screws', category: 'fastener' });
    insertItem(db, { binId, name: 'Wood screws', category: 'fastener' });
  }

  it('suggests the tag this workshop has always used for that word', () => {
    history();
    expect(suggestTag(db, 'Wire connectors')).toMatchObject({ slug: 'electrical' });
    expect(suggestTag(db, 'Drywall screws')).toMatchObject({ slug: 'fastener' });
  });

  it('says nothing about a word it has never seen', () => {
    history();
    expect(suggestTag(db, 'Kayak paddle')).toBeNull();
  });

  it('says nothing on an empty database — no history, no guess', () => {
    expect(suggestTag(db, 'Wire nuts')).toBeNull();
  });

  it('counts support across every matching word in the name', () => {
    history();
    const support = tagSupportFor(db, 'wire screws');
    expect(support.electrical).toBe(3);
    expect(support.fastener).toBe(2);
  });

  it('ignores a tag that has since been deleted', () => {
    history();
    expect(suggestTag(db, 'Wire connectors')).toMatchObject({ slug: 'electrical' });

    // Deleting reassigns those items to `other`, which can never be suggested.
    deleteTag(db, 'electrical');
    expect(suggestTag(db, 'Wire connectors')).toBeNull();
  });

  it('picks up a tag the user added themselves', () => {
    createTag(db, 'Marine');
    insertItem(db, { binId, name: 'Stainless shackle', category: 'marine' });
    insertItem(db, { binId, name: 'Shackle pin', category: 'marine' });
    expect(suggestTag(db, 'Bow shackle')).toMatchObject({ slug: 'marine', support: 2 });
  });

  it('treats the brand as extra evidence when given', () => {
    insertItem(db, { binId, name: 'Wera driver', category: 'hand_tool' });
    insertItem(db, { binId, name: 'Wera bits', category: 'hand_tool' });
    expect(suggestTag(db, 'Ratchet', 'Wera')).toMatchObject({ slug: 'hand_tool' });
  });
});

describe('duplicate warning', () => {
  let db: NodeDbAdapter;
  let binId: string;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    binId = createBin(db, { name: 'Fixings', shortCode: 'B-004' }).id;
  });
  afterEach(() => {
    db.close();
  });

  it('finds the item you already have, and where it lives', () => {
    insertItem(db, { binId, name: 'Wire nuts', category: 'electrical', quantity: 40 });
    expect(findDuplicate(db, '  wire NUTS ')).toMatchObject({
      name: 'Wire nuts',
      quantity: 40,
      binCode: 'B-004',
      binName: 'Fixings',
    });
  });

  it('does not flag a merely similar name', () => {
    insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
    expect(findDuplicate(db, 'Wire nut')).toBeNull();
    expect(findDuplicate(db, 'Wire nuts large')).toBeNull();
  });

  it('does not flag the item being edited against itself', () => {
    const item = insertItem(db, { binId, name: 'Wire nuts', category: 'electrical' });
    expect(findDuplicate(db, 'Wire nuts', item.id)).toBeNull();
  });

  it('is quiet on an empty name', () => {
    expect(findDuplicate(db, '   ')).toBeNull();
  });
});
