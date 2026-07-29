/**
 * What the shelves of a rack are called, by how many there are.
 *
 * A rack is read top to bottom, so the names are a *ladder*: the two ends are
 * always Top and Bottom, and the rungs between them fill in as the rack grows.
 * Four is what a fresh rack is built with, and the pair in the middle there —
 * Upper, Lower — is what the design draws.
 *
 * Which means the names are not really names, they are positions. A rack that
 * loses its third shelf has not lost "Lower"; it has become a three-shelf rack,
 * whose middle shelf is called Middle. That is what `isShelfLadder` is for:
 * as long as nobody has typed a name of their own, the ladder can be re-read
 * at the new height and stays true. The moment someone calls a shelf "Paint
 * tins" it is a name, it means something the rack does not know, and no
 * stepper may touch it again.
 *
 * The vocabulary genuinely runs out at five — there is no sixth word for a
 * position between "upper" and "top". Past that the ends keep their words and
 * the rungs are numbered from the top. Plainer than it is pretty, but it still
 * reads correctly wherever a shelf is named out loud ("R1 · Shelf 3").
 */
const LADDERS: Record<number, readonly string[]> = {
  1: ['Top'],
  2: ['Top', 'Bottom'],
  3: ['Top', 'Middle', 'Bottom'],
  4: ['Top', 'Upper', 'Lower', 'Bottom'],
  5: ['Top', 'Upper', 'Middle', 'Lower', 'Bottom'],
};

/** The names a rack this tall is given, top to bottom. Never empty. */
export function shelfLadder(count: number): string[] {
  const height = Math.max(1, Math.trunc(count));
  const named = LADDERS[height];
  if (named) return [...named];
  return Array.from({ length: height }, (_, index) => {
    if (index === 0) return 'Top';
    if (index === height - 1) return 'Bottom';
    return `Shelf ${index + 1}`;
  });
}

/**
 * Whether these are still the names the rack was given, in the right order.
 *
 * The test is deliberately the whole ladder rather than "do these words look
 * like shelf words": Top / Bottom / Top is not a rack anyone was given, so
 * something has been typed, and typing is the signal to leave well alone.
 */
export function isShelfLadder(names: readonly string[]): boolean {
  if (names.length === 0) return false;
  const ladder = shelfLadder(names.length);
  return names.every((name, index) => name === ladder[index]);
}
