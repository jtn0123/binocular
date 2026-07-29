import { plural } from '../text';

describe('counting things out loud', () => {
  it('leaves one alone', () => {
    expect(plural(1, 'bin')).toBe('1 bin');
  });

  it('adds the s for everything else, including none of them', () => {
    expect(plural(4, 'bin')).toBe('4 bins');
    expect(plural(0, 'bin')).toBe('0 bins');
  });

  it('takes the plural rather than guessing it', () => {
    // "2 shelfves" reached a screen once. A word whose plural is not its
    // singular plus an s has to be given, not derived.
    expect(plural(2, 'shelf', 'shelves')).toBe('2 shelves');
    expect(plural(1, 'shelf', 'shelves')).toBe('1 shelf');
  });
});
