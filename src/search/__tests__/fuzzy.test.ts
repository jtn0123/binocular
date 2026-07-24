import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { searchItemsWithFallback } from '../fts';
import { bestMatch, editDistanceWithin, loadVocabulary, maxDistanceFor } from '../fuzzy';

describe('edit distance', () => {
  it('measures the usual slips', () => {
    expect(editDistanceWithin('screwdrver', 'screwdriver', 2)).toBe(1); // omission
    expect(editDistanceWithin('screwdriverr', 'screwdriver', 2)).toBe(1); // doubled
    expect(editDistanceWithin('screwdrivet', 'screwdriver', 2)).toBe(1); // fat finger
    expect(editDistanceWithin('sockte', 'socket', 2)).toBe(2); // transposition
  });

  it('gives up rather than reporting a distance beyond the budget', () => {
    expect(editDistanceWithin('hammer', 'screwdriver', 2)).toBeNull();
    expect(editDistanceWithin('cat', 'dog', 1)).toBeNull();
  });

  it('is zero for an identical term', () => {
    expect(editDistanceWithin('clamp', 'clamp', 1)).toBe(0);
  });

  it('lets longer words stray further, and refuses to guess at short ones', () => {
    expect(maxDistanceFor('nut')).toBe(0);
    expect(maxDistanceFor('screw')).toBe(1);
    expect(maxDistanceFor('screwdriver')).toBe(2);
  });
});

describe('bestMatch', () => {
  const vocabulary = [
    { term: 'screwdriver', doc: 3 },
    { term: 'screws', doc: 9 },
    { term: 'sockets', doc: 4 },
    { term: 'dock', doc: 1 },
    { term: 'deck', doc: 7 },
  ];

  it('corrects a near miss to an indexed word', () => {
    expect(bestMatch('screwdrver', vocabulary)).toBe('screwdriver');
  });

  it('leaves a token alone when it already prefixes something indexed', () => {
    // "deck" is spelled fine; it is the other token in "deck scrws" that
    // found nothing, and correcting this one would give "dock screws".
    expect(bestMatch('deck', vocabulary)).toBeNull();
    expect(bestMatch('screw', vocabulary)).toBeNull();
  });

  it('refuses to guess at very short tokens', () => {
    expect(bestMatch('nut', vocabulary)).toBeNull();
  });

  it('returns null when nothing is close', () => {
    expect(bestMatch('lawnmower', vocabulary)).toBeNull();
  });
});

describe('search fallback end to end', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    const bin = createBin(db, { name: 'Hand tools', shortCode: 'B-001' });
    insertItem(db, { binId: bin.id, name: 'Phillips screwdriver', category: 'hand_tool' });
    insertItem(db, { binId: bin.id, name: 'Deck screws', category: 'fastener' });
  });
  afterEach(() => {
    db.close();
  });

  it('exposes the index vocabulary (migration 007)', () => {
    const terms = loadVocabulary(db).map((v) => v.term);
    expect(terms).toContain('screwdriver');
    expect(terms).toContain('phillips');
  });

  it('finds the item despite the typo, and says what it searched for', () => {
    const outcome = searchItemsWithFallback(db, 'screwdrver');
    expect(outcome.results.map((r) => r.name)).toEqual(['Phillips screwdriver']);
    expect(outcome.corrected).toBe('screwdriver');
  });

  it('does not announce a correction when the query was fine', () => {
    const outcome = searchItemsWithFallback(db, 'screw');
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.corrected).toBeNull();
  });

  it('corrects only the token that missed', () => {
    const outcome = searchItemsWithFallback(db, 'deck scrws');
    expect(outcome.results.map((r) => r.name)).toEqual(['Deck screws']);
    expect(outcome.corrected).toBe('deck screws');
  });

  it('still reports nothing for something the workshop does not have', () => {
    const outcome = searchItemsWithFallback(db, 'lawnmower');
    expect(outcome.results).toEqual([]);
    expect(outcome.corrected).toBeNull();
  });

  it('leaves the fast path alone — a matching query never scans the vocabulary', () => {
    const spy = jest.spyOn(db, 'getAllSync');
    searchItemsWithFallback(db, 'screwdriver');
    const scannedVocab = spy.mock.calls.some((call) => String(call[0]).includes('item_vocab'));
    expect(scannedVocab).toBe(false);
    spy.mockRestore();
  });
});
