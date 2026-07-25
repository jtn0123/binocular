/**
 * The encoder's *contract*, exercised without the native runtime.
 *
 * What matters here is not the model — no test can run CLIP — but the states
 * around it: a build with no ExecuTorch, weights that have not been downloaded
 * yet, and the boundary that turns `forward()` into the `Embedder` the rest of
 * the app talks to. Those are the paths a user actually meets first.
 *
 * The `mock` prefixes are load-bearing: jest hoists `jest.mock` above the
 * imports, and only `mock*` names may be referenced from a factory.
 */
import {
  activateEncoderIfDownloaded,
  encoderDownloadBytes,
  ENCODER_MODEL,
  isEncoderDownloaded,
  isEncoderSupported,
  loadEncoder,
  removeEncoder,
  resetEncoderForTests,
} from '../executorchEmbedder';
import { getEmbedder, isVisualMemoryAvailable, setEmbedder } from '../visualMemory';

// Declared after the imports but read only when a factory runs — and the
// factories are lazy, because executorchEmbedder requires the native packages
// inside a function rather than at module scope.
const mockForward = jest.fn(async (_uri: string) => new Float32Array([1, 0, 0]));
const mockDelete = jest.fn();
const mockFromModelName = jest.fn(async () => ({ forward: mockForward, delete: mockDelete }));
const mockListDownloadedFiles = jest.fn(async () => [] as string[]);
const mockDeleteResources = jest.fn(async () => {});
const mockGetFilesTotalSize = jest.fn(async () => 90_000_000);
const mockInitExecutorch = jest.fn();
const mockState = { available: true };

jest.mock(
  'react-native-executorch',
  () => {
    if (!mockState.available) throw new Error('native module missing');
    return {
      initExecutorch: mockInitExecutorch,
      ImageEmbeddingsModule: { fromModelName: mockFromModelName },
      CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED: {
        modelName: 'clip-vit-base-patch32-image-quantized',
        modelSource: 'https://example.test/clip_vit_base_patch32_image_xnnpack_int8.pte',
      },
    };
  },
  { virtual: true },
);

jest.mock(
  'react-native-executorch-expo-resource-fetcher',
  () => {
    if (!mockState.available) throw new Error('native module missing');
    return {
      ExpoResourceFetcher: {
        listDownloadedFiles: mockListDownloadedFiles,
        deleteResources: mockDeleteResources,
        getFilesTotalSize: mockGetFilesTotalSize,
      },
    };
  },
  { virtual: true },
);

const DOWNLOADED =['file:///models/example.test_clip_vit_base_patch32_image_xnnpack_int8.pte'];

describe('the on-device encoder (D20)', () => {
  beforeEach(() => {
    mockState.available = true;
    jest.clearAllMocks();
    mockListDownloadedFiles.mockResolvedValue([]);
    mockGetFilesTotalSize.mockResolvedValue(90_000_000);
    mockFromModelName.mockResolvedValue({ forward: mockForward, delete: mockDelete });
    mockForward.mockResolvedValue(new Float32Array([1, 0, 0]));
    resetEncoderForTests();
    setEmbedder(null);
  });
  afterEach(() => setEmbedder(null));

  // Declared first on purpose: a throwing module factory is not cached, but a
  // successful one is, so the unsupported case has to run before anything
  // resolves the mock for real.
  describe('on a build without ExecuTorch', () => {
    beforeEach(() => {
      mockState.available = false;
      resetEncoderForTests();
    });

    it('says so rather than throwing', async () => {
      expect(isEncoderSupported()).toBe(false);
      await expect(isEncoderDownloaded()).resolves.toBe(false);
      await expect(encoderDownloadBytes()).resolves.toBeNull();
      await expect(loadEncoder()).resolves.toBe(false);
      await expect(activateEncoderIfDownloaded()).resolves.toBe(false);
    });

    it('leaves visual memory unavailable, which is the whole app still working', async () => {
      await loadEncoder();
      expect(isVisualMemoryAvailable()).toBe(false);
    });

    it('removing is a no-op, not an error', async () => {
      await expect(removeEncoder()).resolves.toBeUndefined();
    });
  });

  it('reports whether the weights are already here', async () => {
    await expect(isEncoderDownloaded()).resolves.toBe(false);
    mockListDownloadedFiles.mockResolvedValue(DOWNLOADED);
    await expect(isEncoderDownloaded()).resolves.toBe(true);
  });

  it('states the download size so the offer can name its cost', async () => {
    await expect(encoderDownloadBytes()).resolves.toBe(90_000_000);
  });

  it('treats an unanswerable size as unknown rather than zero', async () => {
    mockGetFilesTotalSize.mockResolvedValueOnce(0);
    await expect(encoderDownloadBytes()).resolves.toBeNull();
  });

  describe('loading', () => {
    it('becomes the active embedder, tagged with the model that made the vectors', async () => {
      await expect(loadEncoder()).resolves.toBe(true);
      const embedder = getEmbedder();
      expect(embedder?.model).toBe(ENCODER_MODEL);
      expect(Array.from(await embedder!.embed('file:///photos/socket.jpg'))).toEqual([1, 0, 0]);
      expect(mockForward).toHaveBeenCalledWith('file:///photos/socket.jpg');
    });

    it('wires the Expo fetcher in before asking for anything', async () => {
      await loadEncoder();
      expect(mockInitExecutorch).toHaveBeenCalled();
    });

    it('reports progress while downloading', async () => {
      const seen: number[] = [];
      mockFromModelName.mockImplementationOnce(async (...args: unknown[]) => {
        const onProgress = args[1] as ((p: number) => void) | undefined;
        onProgress?.(0.5);
        onProgress?.(1);
        return { forward: mockForward, delete: mockDelete };
      });

      await loadEncoder((p) => seen.push(p));
      expect(seen).toEqual([0.5, 1]);
    });

    it('loads once and reuses it', async () => {
      await loadEncoder();
      await loadEncoder();
      expect(mockFromModelName).toHaveBeenCalledTimes(1);
    });

    it('lets a failed download surface instead of pretending it worked', async () => {
      mockFromModelName.mockRejectedValueOnce(new Error('connection lost'));
      await expect(loadEncoder()).rejects.toThrow('connection lost');
      expect(isVisualMemoryAvailable()).toBe(false);
    });
  });

  describe('startup activation', () => {
    it('never downloads when the weights are absent', async () => {
      await expect(activateEncoderIfDownloaded()).resolves.toBe(false);
      // The rule that keeps a cold start offline-safe (I4): opting in is a
      // decision made once in Settings, not something a launch does silently.
      expect(mockFromModelName).not.toHaveBeenCalled();
    });

    it('brings the encoder back when they are here', async () => {
      mockListDownloadedFiles.mockResolvedValue(DOWNLOADED);
      await expect(activateEncoderIfDownloaded()).resolves.toBe(true);
      expect(isVisualMemoryAvailable()).toBe(true);
    });

    it('survives a corrupt model file rather than blocking the app', async () => {
      mockListDownloadedFiles.mockResolvedValue(DOWNLOADED);
      mockFromModelName.mockRejectedValueOnce(new Error('not a valid .pte'));
      await expect(activateEncoderIfDownloaded()).resolves.toBe(false);
      expect(isVisualMemoryAvailable()).toBe(false);
    });
  });

  describe('removal', () => {
    it('turns visual memory off and frees the weights', async () => {
      await loadEncoder();
      expect(isVisualMemoryAvailable()).toBe(true);

      await removeEncoder();
      expect(isVisualMemoryAvailable()).toBe(false);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteResources).toHaveBeenCalledWith(
        expect.stringContaining('clip_vit_base_patch32_image_xnnpack_int8.pte'),
      );
    });

    it('still detaches when the native teardown throws', async () => {
      await loadEncoder();
      mockDelete.mockImplementationOnce(() => {
        throw new Error('already unloaded');
      });
      await expect(removeEncoder()).resolves.toBeUndefined();
      expect(isVisualMemoryAvailable()).toBe(false);
    });
  });
});
