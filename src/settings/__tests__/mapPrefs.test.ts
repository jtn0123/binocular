import * as SecureStore from 'expo-secure-store';

import { DEFAULT_MAP_PREFS, loadMapPrefs, parseMapPrefs, saveMapPrefs } from '../mapPrefs';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const setItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('map preference persistence', () => {
  it('ships with the drag on', () => {
    // The switch exists because the gesture layer crashed a field phone once;
    // the default is the answer to "is it fixed", and it must be deliberate.
    expect(DEFAULT_MAP_PREFS.dragEnabled).toBe(true);
  });

  it('round-trips the switches', async () => {
    await saveMapPrefs({ dragEnabled: false, showTicks: false });
    const written = setItemAsync.mock.calls[0][1];
    expect(parseMapPrefs(written)).toEqual({ dragEnabled: false, showTicks: false });
  });

  it('falls back to defaults for junk rather than pushing it into the map', () => {
    expect(parseMapPrefs(null)).toEqual(DEFAULT_MAP_PREFS);
    expect(parseMapPrefs('not json')).toEqual(DEFAULT_MAP_PREFS);
    expect(parseMapPrefs('{"dragEnabled":"yes"}')).toEqual(DEFAULT_MAP_PREFS);
  });

  it('survives a secure-store that refuses to read', async () => {
    // A preference must never be able to break the screen it configures.
    getItemAsync.mockRejectedValueOnce(new Error('no keystore'));
    await expect(loadMapPrefs()).resolves.toEqual(DEFAULT_MAP_PREFS);
  });

  it('survives a secure-store that refuses to write', async () => {
    setItemAsync.mockRejectedValueOnce(new Error('no keystore'));
    await expect(saveMapPrefs(DEFAULT_MAP_PREFS)).resolves.toBeUndefined();
  });
});
