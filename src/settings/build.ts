import Constants from 'expo-constants';

/**
 * Which build is running, and where a newer one comes from.
 *
 * Now that builds arrive as GitHub Releases rather than a cable
 * (docs/RELEASES.md), "am I on the latest?" is a real question — and the
 * phone in the workshop is the one place that can't answer it from memory.
 *
 * What this deliberately does NOT do is poll for a version. The repository
 * is private, so an anonymous check is impossible, and the alternatives —
 * shipping a token in the APK, or standing up a service — are both worse
 * than one tap to the page that already lists every build. Same honesty rule
 * as D5 and D15: show what is known, never a number that was guessed at.
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
