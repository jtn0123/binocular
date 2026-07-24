import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_CAPTURE_PREFS,
  loadCapturePrefs,
  normalizeZoom,
  parseCapturePrefs,
  saveCapturePrefs,
} from '../capturePrefs';

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

describe('capture preference persistence', () => {
  it('round-trips torch, zoom and flow', async () => {
    await saveCapturePrefs({ torch: true, zoom: 0.4, flow: 'keep_shooting' });
    const written = setItemAsync.mock.calls[0][1];
    expect(parseCapturePrefs(written)).toEqual({ torch: true, zoom: 0.4, flow: 'keep_shooting' });
  });

  it('defaults to torch off, no zoom, blocking review', () => {
    expect(DEFAULT_CAPTURE_PREFS).toEqual({ torch: false, zoom: 0, flow: 'review_now' });
    expect(parseCapturePrefs(null)).toEqual(DEFAULT_CAPTURE_PREFS);
  });

  it('falls back to defaults on junk rather than feeding the camera garbage', () => {
    expect(parseCapturePrefs('not json')).toEqual(DEFAULT_CAPTURE_PREFS);
    expect(parseCapturePrefs('{"torch":"yes"}')).toEqual(DEFAULT_CAPTURE_PREFS);
    expect(parseCapturePrefs('{"torch":true,"zoom":9,"flow":"keep_shooting"}')).toEqual(
      DEFAULT_CAPTURE_PREFS,
    );
    expect(parseCapturePrefs('{"torch":true,"zoom":0.5,"flow":"whenever"}')).toEqual(
      DEFAULT_CAPTURE_PREFS,
    );
  });

  it('clamps and rounds zoom to the stepper granularity', () => {
    expect(normalizeZoom(-1)).toBe(0);
    expect(normalizeZoom(5)).toBe(1);
    expect(normalizeZoom(0.30000000000000004)).toBe(0.3);
    expect(normalizeZoom(Number.NaN)).toBe(0);
  });

  it('never lets a secure-store failure break capture', async () => {
    getItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(loadCapturePrefs()).resolves.toEqual(DEFAULT_CAPTURE_PREFS);

    setItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(
      saveCapturePrefs({ torch: true, zoom: 0.2, flow: 'review_now' }),
    ).resolves.toBeUndefined();
  });

  it('reads back what was stored', async () => {
    getItemAsync.mockResolvedValueOnce('{"torch":true,"zoom":0.7,"flow":"keep_shooting"}');
    await expect(loadCapturePrefs()).resolves.toEqual({
      torch: true,
      zoom: 0.7,
      flow: 'keep_shooting',
    });
  });
});
