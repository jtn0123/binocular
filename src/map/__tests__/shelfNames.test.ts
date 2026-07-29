import { isShelfLadder, shelfLadder } from '../shelfNames';

/**
 * What a rack's shelves are called, by how many there are.
 *
 * The names are positions rather than names — "Lower" describes where a shelf
 * is, not what is on it — so they have to stay true as a rack changes height.
 * A four-shelf rack cut to three that still reads Top / Upper / Lower is
 * describing a rack that no longer exists.
 */
describe('the ladder a rack’s shelves are named down', () => {
  it('has Top and Bottom at the ends, at every height that has two', () => {
    for (let height = 2; height <= 8; height++) {
      const ladder = shelfLadder(height);
      expect(ladder).toHaveLength(height);
      expect(ladder[0]).toBe('Top');
      expect(ladder.at(-1)).toBe('Bottom');
    }
  });

  it('calls a single shelf the top one, not the bottom one', () => {
    // A rack with one shelf is a rack you put things on top of.
    expect(shelfLadder(1)).toEqual(['Top']);
  });

  it('names the four a fresh rack is built with the way the design draws them', () => {
    expect(shelfLadder(4)).toEqual(['Top', 'Upper', 'Lower', 'Bottom']);
  });

  it('fills the rungs in from the outside as the rack grows', () => {
    // Each height reads as a description of that rack, not as the previous
    // one with a word bolted on.
    expect(shelfLadder(2)).toEqual(['Top', 'Bottom']);
    expect(shelfLadder(3)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(shelfLadder(5)).toEqual(['Top', 'Upper', 'Middle', 'Lower', 'Bottom']);
  });

  it('never repeats a name, so no two shelves on a rack are called the same', () => {
    for (let height = 1; height <= 8; height++) {
      expect(new Set(shelfLadder(height)).size).toBe(height);
    }
  });

  it('numbers the rungs once the words run out, keeping the ends', () => {
    // There is no sixth word for a position between "upper" and "top". Plain
    // is better than invented: "R1 · Shelf 3" still says where to look.
    expect(shelfLadder(6)).toEqual(['Top', 'Shelf 2', 'Shelf 3', 'Shelf 4', 'Shelf 5', 'Bottom']);
  });

  it('refuses to describe a rack with no shelves on it', () => {
    // The stepper clamps at one shelf; this is the belt to that brace, since
    // a zero-length ladder would rename every shelf on the rack to undefined.
    expect(shelfLadder(0)).toEqual(['Top']);
    expect(shelfLadder(-3)).toEqual(['Top']);
  });
});

describe('telling a rack that was named from one that was left alone', () => {
  it('recognises every height it generates', () => {
    for (let height = 1; height <= 8; height++) {
      expect(isShelfLadder(shelfLadder(height))).toBe(true);
    }
  });

  it('says no the moment one shelf has been named by hand', () => {
    // The point of the check: one typed name and these are names, not
    // positions, and nothing may rewrite them.
    expect(isShelfLadder(['Top', 'Paint tins', 'Lower', 'Bottom'])).toBe(false);
  });

  it('says no to the right words in the wrong order', () => {
    // Not a rack anyone was given, so something moved them — and a stepper
    // that "restored" the order would be undoing a decision.
    expect(isShelfLadder(['Bottom', 'Upper', 'Lower', 'Top'])).toBe(false);
  });

  it('says no to a ladder for a different height', () => {
    // Three shelves called Top / Upper / Lower is what a rack looks like
    // after something already went wrong; it is not a rack of three.
    expect(isShelfLadder(['Top', 'Upper', 'Lower'])).toBe(false);
  });

  it('says no to a rack with no shelves rather than vacuously yes', () => {
    expect(isShelfLadder([])).toBe(false);
  });

  it('is case- and space-sensitive, because a person typed it', () => {
    expect(isShelfLadder(['top', 'bottom'])).toBe(false);
    expect(isShelfLadder(['Top ', 'Bottom'])).toBe(false);
  });
});
