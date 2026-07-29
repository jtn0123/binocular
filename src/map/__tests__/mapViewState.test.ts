import * as SecureStore from 'expo-secure-store';

import { DEFAULT_MAP_VIEW, loadMapView, parseMapView, saveMapView } from '../mapViewState';

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

describe('where you were on the wall', () => {
  it('starts at the first rack, no tint, tray shut', () => {
    expect(DEFAULT_MAP_VIEW).toEqual({ rackIndex: 0, heat: 'none', trayOpen: false });
  });

  it('reads back what was stored', () => {
    expect(parseMapView('{"rackIndex":2,"heat":"scanned","trayOpen":true}')).toEqual({
      rackIndex: 2,
      heat: 'scanned',
      trayOpen: true,
    });
  });

  it('falls back per field, so one bad key does not reset the rest', () => {
    // A required object would throw away the whole view the first time this
    // file gains a key, because what is on disk would not have it.
    expect(parseMapView('{"rackIndex":"third","heat":"items","trayOpen":true}')).toEqual({
      rackIndex: 0,
      heat: 'items',
      trayOpen: true,
    });
  });

  it('rejects a lens it does not have', () => {
    expect(parseMapView('{"heat":"rainbow"}').heat).toBe('none');
  });

  it('refuses a negative rack rather than indexing backwards off the wall', () => {
    expect(parseMapView('{"rackIndex":-3}').rackIndex).toBe(0);
  });

  it('treats nothing stored, and unreadable bytes, as the default', () => {
    expect(parseMapView(null)).toEqual(DEFAULT_MAP_VIEW);
    expect(parseMapView('not json')).toEqual(DEFAULT_MAP_VIEW);
  });

  it('survives a store that throws — view state must never break the map', async () => {
    getItemAsync.mockRejectedValueOnce(new Error('keychain locked'));
    await expect(loadMapView()).resolves.toEqual(DEFAULT_MAP_VIEW);

    setItemAsync.mockRejectedValueOnce(new Error('keychain locked'));
    await expect(saveMapView(DEFAULT_MAP_VIEW)).resolves.toBeUndefined();
  });
});
