import { DEFAULT_MAP_PREFS, parseMapPrefs } from '../mapPrefs';

/**
 * The tint mode was component state seeded to 'none', so it reset on every
 * visit — worst for the staleness tint, which answers "what have I not looked
 * at in months" and is therefore the one mode used across visits weeks apart.
 *
 * Same best-effort contract as capturePrefs: a corrupted or hand-edited value
 * falls back to the default rather than pushing junk into the tint.
 */
describe('map preferences', () => {
  it('falls back to no tint when nothing is stored', () => {
    expect(parseMapPrefs(null)).toEqual(DEFAULT_MAP_PREFS);
  });

  it('restores a stored tint mode', () => {
    expect(parseMapPrefs(JSON.stringify({ heat: 'scanned' }))).toEqual({
      heat: 'scanned',
      drag: false,
    });
    expect(parseMapPrefs(JSON.stringify({ heat: 'items' }))).toEqual({ heat: 'items', drag: false });
  });

  /**
   * The drag flag arrived after the tint did, so a preferences blob written by
   * an older build has no `drag` key. Rejecting it would silently reset the
   * tint someone had chosen.
   */
  it('keeps a tint stored before the drag flag existed', () => {
    expect(parseMapPrefs(JSON.stringify({ heat: 'scanned' })).heat).toBe('scanned');
  });

  it('restores the drag flag, and defaults it off', () => {
    expect(parseMapPrefs(JSON.stringify({ heat: 'none', drag: true })).drag).toBe(true);
    expect(parseMapPrefs(null).drag).toBe(false);
    // The safe interaction is the default: a drag layer killed the process
    // once, and the shipped default should be the one known to survive.
    expect(DEFAULT_MAP_PREFS.drag).toBe(false);
  });

  it('rejects a mode the map cannot render', () => {
    expect(parseMapPrefs(JSON.stringify({ heat: 'rainbow' }))).toEqual(DEFAULT_MAP_PREFS);
  });

  it('survives junk rather than throwing on the way into the screen', () => {
    expect(parseMapPrefs('not json at all')).toEqual(DEFAULT_MAP_PREFS);
    expect(parseMapPrefs('{}')).toEqual(DEFAULT_MAP_PREFS);
    expect(parseMapPrefs('[]')).toEqual(DEFAULT_MAP_PREFS);
  });
});
