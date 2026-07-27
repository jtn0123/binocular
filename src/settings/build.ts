import Constants from 'expo-constants';

/**
 * Which build is running, and where a newer one comes from.
 *
 * Now that builds arrive as GitHub Releases rather than a cable
 * (docs/RELEASES.md), "am I on the latest?" is a real question — and the
 * phone in the workshop is the one place that can't answer it from memory.
 *
 * This file used to say there was **no update check**, on the grounds that
 * the repository is private so an anonymous check is impossible, and that
 * both workarounds — a token shipped in the APK, or a service to stand up —
 * were worse than one tap to the page listing every build.
 *
 * That reasoning still holds against both of those workarounds, and neither
 * was taken. What it missed is a third option: the person who owns the
 * repository supplies a read-only token themselves, and it lives in the
 * platform secure store beside the vision API keys (blueprint Q1). Nothing
 * secret is in the APK, so unzipping a build still yields no access. The
 * check and the download live in `src/update`; this file stays the answer to
 * "which build is this", which is the part that works with no network at all.
 *
 * The honesty rule that produced the original note is unchanged and now
 * applies to more surface: the button says "Check for updates" because it
 * does check, "unknown" is a state the UI shows rather than rounding to "up
 * to date", and nothing claims to install anything — Android does that, and
 * only after the user confirms it.
 */
/**
 * The releases *list*, deliberately not `/releases/latest`: that URL resolves
 * only to the newest **non**-pre-release, and an ad-hoc `Run workflow` build
 * is published as a pre-release by default. With only pre-releases published
 * — which is the normal state between named versions — `/latest` is a 404,
 * so the one button whose whole job is "get me the newest build" would land
 * on an error page. The list shows every build, newest first.
 */
export const RELEASES_URL = 'https://github.com/jtn0123/binocular/releases';

export interface BuildInfo {
  /** Marketing version, e.g. "0.1.0" or "0.1.0+ci.12". */
  version: string;
  /** Android's upgrade counter; null on a platform or config without one. */
  buildNumber: number | null;
  /** Whether this is a Metro/dev-client build rather than a release APK. */
  isDev: boolean;
}

export function buildInfo(): BuildInfo {
  const versionCode = Constants.expoConfig?.android?.versionCode;
  return {
    version: Constants.expoConfig?.version ?? 'unknown',
    buildNumber: typeof versionCode === 'number' ? versionCode : null,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  };
}

/** One line for the Settings row: "0.1.0+ci.12 · build 1012 · release". */
export function describeBuild(info: BuildInfo): string {
  return [
    info.version,
    info.buildNumber === null ? null : `build ${info.buildNumber}`,
    info.isDev ? 'dev' : 'release',
  ]
    .filter(Boolean)
    .join(' · ');
}
