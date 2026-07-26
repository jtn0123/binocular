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
    expect(parseMapPrefs(JSON.stringify({ heat: 'scanned' }))).toEqual({ heat: 'scanned' });
    expect(parseMapPrefs(JSON.stringify({ heat: 'items' }))).toEqual({ heat: 'items' });
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
