/**
 * "1 bin", "4 bins", "2 shelves".
 *
 * Written out inline this is `${n} thing${n === 1 ? '' : 's'}`, which appears
 * three dozen times in this app and has already been wrong once: appending an
 * "s" to "shelf" produced "2 shelfves" on a screen someone read. Naming the
 * plural form rather than building it is what stops that — and where the two
 * forms differ by more than a letter, there is somewhere to say so.
 */
export function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
