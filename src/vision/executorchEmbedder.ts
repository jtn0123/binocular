import { normalisePhotoUri } from '../scan/photos';

import { setEmbedder, type Embedder } from './visualMemory';

/**
 * The on-device encoder behind visual memory (blueprint D20).
 *
 * The ONLY file that knows the ExecuTorch API — the same §3 boundary that
 * confines the Anthropic SDK to claudeProvider.ts and ML Kit to
 * localProvider.ts. Everything else in the app talks to the `Embedder`
 * interface, which is why the whole feature is testable with a fake and why
 * the app is fully functional with no encoder at all.
 *
 * Both packages are required lazily. That is not a micro-optimisation: it is
 * what lets Jest run without a native module, and what lets the app boot on a
 * build where ExecuTorch is absent instead of dying at import time.
 *
 * D20: the model is **downloaded on first use, never bundled**. Until the user
 * asks for it in Settings, nothing here runs and visual memory reports itself
 * unavailable.
 */

/**
 * The int8 CLIP image encoder. Quantized rather than fp32 deliberately — it
 * is a smaller download and faster per photo on a phone, and the job here is
 * ranking a few hundred of the user's own photos by resemblance, not squeezing
 * out the last point of retrieval accuracy.
 *
 * This string is also what lands in `item_embeddings.model`, so changing the
 * encoder invalidates every stored vector by comparison rather than by
 * migration (see D20 and embeddingQueries.listCandidates).
 */
export const ENCODER_MODEL = 'clip-vit-base-patch32-image-quantized';

/** Substring of the local filename the fetcher derives from the model URL. */
const MODEL_FILE = 'clip_vit_base_patch32_image_xnnpack_int8.pte';

interface ExecutorchApi {
  ImageEmbeddingsModule: {
    fromModelName(
      namedSources: { modelName: string; modelSource: string },
      onDownloadProgress?: (progress: number) => void,
    ): Promise<{ forward(input: string): Promise<Float32Array>; delete(): void }>;
  };
  CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED: { modelName: string; modelSource: string };
  initExecutorch(config: { resourceFetcher: unknown }): void;
}

interface FetcherApi {
  listDownloadedFiles(): Promise<string[]>;
  deleteResources(...sources: string[]): Promise<void>;
  getFilesTotalSize(...sources: string[]): Promise<number>;
}

let cached: { executorch: ExecutorchApi; fetcher: FetcherApi } | null = null;

/**
 * Resolves the native packages once, wiring the Expo resource fetcher into
 * ExecuTorch. Returns null when they are not part of this build — the caller's
 * cue to say "not available here" rather than to fail.
 */
function nativeApi(): { executorch: ExecutorchApi; fetcher: FetcherApi } | null {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executorch = require('react-native-executorch') as ExecutorchApi;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExpoResourceFetcher } = require('react-native-executorch-expo-resource-fetcher') as {
      ExpoResourceFetcher: FetcherApi;
    };
    // Must happen before any fetch; idempotent, so calling it here rather than
    // at app start keeps the whole dependency behind this one lazy path.
    executorch.initExecutorch({ resourceFetcher: ExpoResourceFetcher });
    cached = { executorch, fetcher: ExpoResourceFetcher };
    return cached;
  } catch {
    return null;
  }
}

/** Whether this build contains the encoder runtime at all. */
export function isEncoderSupported(): boolean {
  return nativeApi() !== null;
}

/** Whether the model weights are already on this phone. */
export async function isEncoderDownloaded(): Promise<boolean> {
  const api = nativeApi();
  if (!api) return false;
  try {
    const files = await api.fetcher.listDownloadedFiles();
    return files.some((uri) => uri.includes(MODEL_FILE));
  } catch {
    return false;
  }
}

/**
 * How large the download is, in bytes, or null if it cannot be determined —
 * asked over the network, so Settings can state the cost before the user
 * commits to it on workshop Wi-Fi.
 */
export async function encoderDownloadBytes(): Promise<number | null> {
  const api = nativeApi();
  if (!api) return null;
  try {
    const bytes = await api.fetcher.getFilesTotalSize(
      api.executorch.CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED.modelSource,
    );
    return bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}

let loaded: { forward(input: string): Promise<Float32Array>; delete(): void } | null = null;

/**
 * Loads the encoder, downloading the weights first if they are not here yet,
 * and makes it the active embedder. `onProgress` reports 0..1 while
 * downloading and is never called once the file is local.
 *
 * Returns false when the runtime is missing, which is a legitimate state
 * rather than an error: the rest of the app is unaffected.
 */
export async function loadEncoder(onProgress?: (progress: number) => void): Promise<boolean> {
  const api = nativeApi();
  if (!api) return false;
  if (loaded) return true;

  const module = await api.executorch.ImageEmbeddingsModule.fromModelName(
    api.executorch.CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED,
    onProgress,
  );
  loaded = module;

  const embedder: Embedder = {
    model: ENCODER_MODEL,
    // Same repair the upload path needs: expo-file-system can hand back a
    // `file:////…` uri that native code cannot resolve. Stored rows still
    // carry the broken form, so it is fixed on the way to the encoder.
    embed: (photoUri) => module.forward(normalisePhotoUri(photoUri)),
  };
  setEmbedder(embedder);
  return true;
}

/**
 * Startup path: activate the encoder only if its weights are already here.
 *
 * Never downloads. Turning visual memory on is a decision the user makes once
 * in Settings; an app launch must not spend their data on it, and I4 means a
 * cold start in a workshop with no signal has to behave identically.
 */
export async function activateEncoderIfDownloaded(): Promise<boolean> {
  if (!(await isEncoderDownloaded())) return false;
  try {
    return await loadEncoder();
  } catch {
    // A corrupt or half-written model file must not stop the app from
    // starting; the feature simply stays unavailable until re-downloaded.
    return false;
  }
}

/**
 * Frees the weights and stops visual memory. Stored vectors are deliberately
 * left alone — they are small, and keeping them means re-downloading the
 * encoder restores the memory instantly instead of re-encoding every photo.
 */
export async function removeEncoder(): Promise<void> {
  const api = nativeApi();
  setEmbedder(null);
  if (loaded) {
    try {
      loaded.delete();
    } catch {
      // Best-effort native teardown; the JS side is already detached.
    }
    loaded = null;
  }
  if (!api) return;
  await api.fetcher.deleteResources(
    api.executorch.CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED.modelSource,
  );
}

/** Test seam: forget the cached native handles. */
export function resetEncoderForTests(): void {
  cached = null;
  loaded = null;
}
