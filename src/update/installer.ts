import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import type { AvailableBuild } from './releases';

/**
 * Fetching an APK and handing it to Android's installer.
 *
 * Two things this deliberately does **not** do, because claiming either
 * would be a lie the first time someone relied on it:
 *
 * 1. **It does not install anything.** Android does. The app can only hand
 *    the package manager a file and an intent; the system then shows its own
 *    confirmation sheet, and the user taps Update there. There is no silent
 *    path for a sideloaded app and there should not be one.
 * 2. **It does not verify the download itself.** It does not need to, and a
 *    checksum in the release notes would be security theatre — it travels
 *    over the same connection as the file. The real check is Android's:
 *    an APK signed with a different key than the installed app is *refused*,
 *    not merely warned about. That is what makes "download over HTTPS from a
 *    release and install" safe here, and it is why docs/RELEASES.md is so
 *    insistent about never changing the signing key.
 */

/** Where a downloaded build waits. Cache, so Android can evict a stale one. */
const FOLDER = 'updates';

export type InstallSupport =
  | { supported: true }
  | { supported: false; reason: string };

/**
 * iOS cannot sideload an APK and never will — the App Store is the only
 * install path. Reported rather than hidden so the Settings row can explain
 * itself instead of silently missing a button.
 */
export function installSupport(): InstallSupport {
  if (Platform.OS !== 'android') {
    return {
      supported: false,
      reason: 'Installing a build from inside the app is Android-only. On this platform, update through the store or a development build.',
    };
  }
  return { supported: true };
}

function updatesDir(): Directory {
  const dir = new Directory(Paths.cache, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Throws away anything downloaded earlier. A 100 MB APK per build adds up
 * fast on a phone that is also holding the workshop's photos, and a
 * half-finished download from a cancelled attempt must never be offered to
 * the installer as though it were complete.
 */
export function clearDownloads(): void {
  const dir = new Directory(Paths.cache, FOLDER);
  if (dir.exists) dir.delete();
}

export interface DownloadHandle {
  /** Resolves with the finished file, or null if it was cancelled. */
  done: Promise<File | null>;
  cancel: () => void;
}

/**
 * Downloads the APK for `build`.
 *
 * With a token the API asset URL is used, because that is the only one that
 * works for a private repository — it answers with the bytes when asked for
 * `application/octet-stream`, redirecting to a short-lived signed URL that
 * the HTTP client follows. Without a token the browser URL is the right one:
 * the API asset URL would 404 anonymously for exactly the same reason the
 * releases list does.
 */
export function downloadBuild(
  build: AvailableBuild,
  token: string | null,
  onProgress: (bytesWritten: number, totalBytes: number) => void,
): DownloadHandle {
  clearDownloads();
  const destination = new File(updatesDir(), build.asset.name);

  const task = File.createDownloadTask(
    token ? build.asset.apiUrl : build.asset.browserUrl,
    destination,
    {
      headers: {
        Accept: 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // `totalBytes` is -1 when the server sends no Content-Length. The
      // release already told us the size, so fall back to that rather than
      // showing a total of minus one byte.
      onProgress: ({ bytesWritten, totalBytes }) =>
        onProgress(bytesWritten, totalBytes > 0 ? totalBytes : build.asset.bytes),
    },
  );

  return { done: task.downloadAsync(), cancel: () => task.cancel() };
}

/**
 * Hands the downloaded APK to Android's package installer.
 *
 * The file has to be passed as a `content://` URI from the app's
 * FileProvider — a bare `file://` URI has been refused since Android 7, and
 * the read permission has to travel with the intent, which is what the flag
 * is for. The install itself then belongs to the system: this resolves as
 * soon as the sheet is shown, not when the install finishes, because the app
 * is about to be replaced and will not be running to hear the answer.
 */
export async function installBuild(file: File): Promise<void> {
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    // FLAG_GRANT_READ_URI_PERMISSION — without it the installer cannot read
    // the file it was just handed.
    flags: 1,
  });
}
