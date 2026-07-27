import { z } from 'zod';

/**
 * Which build is the newest one published, and is it newer than this one?
 *
 * This replaces the note that used to sit in `settings/build.ts` saying the
 * app deliberately does *not* check for updates. That decision rested on one
 * fact — the repository is private, so an anonymous check is impossible — and
 * two rejected workarounds: shipping a token inside the APK, or standing up a
 * service. Both are still rejected. What changed is the third option nobody
 * had written down: the *user* supplies a read-only token, kept in the
 * platform secure store exactly like the Anthropic and OpenAI keys already
 * are (blueprint Q1). Nothing secret ships in the APK, and pulling one apart
 * still yields no access to the repository.
 *
 * A public repository needs no token at all, so the check is tried
 * unauthenticated first and only asks for one when GitHub refuses.
 *
 * Everything here is parsing and comparison — the network call is one
 * function at the bottom, and the pieces that decide *which* build and
 * *whether it is newer* are pure, because those are what hide bugs.
 */

export const RELEASES_OWNER = 'jtn0123';
export const RELEASES_REPO = 'binocular';

const RELEASES_API = `https://api.github.com/repos/${RELEASES_OWNER}/${RELEASES_REPO}/releases`;

/**
 * Only the fields actually read. GitHub sends a hundred more per release and
 * validating them would turn every unrelated API addition into a parse
 * failure — D9 asks for validation at the boundary, not for a mirror of
 * someone else's schema.
 */
const AssetSchema = z.object({
  name: z.string(),
  size: z.number(),
  /** API URL. With `Accept: application/octet-stream` it serves the bytes. */
  url: z.string(),
  browser_download_url: z.string(),
});

const ReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  html_url: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullish(),
  assets: z.array(AssetSchema),
});

const ReleasesSchema = z.array(ReleaseSchema);

export interface ReleaseAsset {
  name: string;
  bytes: number;
  /** Authenticated download; needs `Accept: application/octet-stream`. */
  apiUrl: string;
  /** Anonymous download, for a public repository. */
  browserUrl: string;
}

export interface AvailableBuild {
  tag: string;
  title: string;
  /** Android's upgrade counter, read from the asset name; null if absent. */
  versionCode: number | null;
  asset: ReleaseAsset;
  /** The release notes, as written by the publish workflow. */
  notes: string;
  pageUrl: string;
  prerelease: boolean;
}

/**
 * The workflow names every APK `…-vc<versionCode>.apk`, which is the only
 * number in a release that means anything to Android: it is the counter the
 * package manager compares when deciding whether an install is an upgrade.
 * The marketing version cannot do this job — `0.1.0+ci.46` and `0.1.0+ci.7`
 * do not order as strings, and `0.1.0` never changes between ad-hoc builds.
 */
export function versionCodeFromAssetName(name: string): number | null {
  const match = /-vc(\d+)\.apk$/i.exec(name);
  if (!match) return null;
  const code = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(code) ? code : null;
}

/**
 * The newest published build that actually has an APK on it.
 *
 * Drafts are skipped — they are not visible to the phone — but pre-releases
 * are *not*: every ad-hoc `Run workflow` build is published as a pre-release,
 * so skipping them would mean the updater ignored the normal case. This is
 * the same reasoning that makes the browser link point at `/releases` rather
 * than `/releases/latest`, which 404s when only pre-releases exist.
 *
 * GitHub returns releases newest-first and this trusts that order rather than
 * re-sorting by `published_at`: a re-published release keeps its position in
 * the list, and its timestamp is not the one that matters.
 */
export function pickBuild(releases: readonly z.infer<typeof ReleaseSchema>[]): AvailableBuild | null {
  for (const release of releases) {
    if (release.draft) continue;
    const asset = release.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
    if (!asset) continue;
    return {
      tag: release.tag_name,
      title: release.name?.trim() || release.tag_name,
      versionCode: versionCodeFromAssetName(asset.name),
      asset: {
        name: asset.name,
        bytes: asset.size,
        apiUrl: asset.url,
        browserUrl: asset.browser_download_url,
      },
      notes: release.body?.trim() ?? '',
      pageUrl: release.html_url,
      prerelease: release.prerelease,
    };
  }
  return null;
}

export type Comparison = 'newer' | 'current' | 'older' | 'unknown';

/**
 * `unknown` is a real answer and the UI must show it as one. If either side
 * has no version code — a dev build, or an APK named by hand — then whether
 * an update exists is genuinely not known, and saying "up to date" would be
 * the kind of confident falsehood D5 exists to prevent.
 */
export function compareBuild(running: number | null, available: number | null): Comparison {
  if (running === null || available === null) return 'unknown';
  if (available > running) return 'newer';
  if (available === running) return 'current';
  return 'older';
}

export type UpdateCheck =
  | { state: 'newer'; build: AvailableBuild }
  | { state: 'current'; build: AvailableBuild }
  | { state: 'older'; build: AvailableBuild }
  | { state: 'unknown'; build: AvailableBuild }
  | { state: 'none' }
  | { state: 'needs-token' }
  | { state: 'bad-token' }
  | { state: 'offline' }
  | { state: 'failed'; detail: string };

export function headers(token: string | null): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Reads the interesting parts of a failed response so the UI can say which
 * kind of failure it was. A private repository answers an anonymous request
 * with **404**, not 403 — GitHub hides existence rather than admitting it —
 * so a 404 here means "you need a token", not "no such repository".
 */
function failureFor(status: number, hadToken: boolean): UpdateCheck {
  if (status === 401) return { state: 'bad-token' };
  if (status === 403 || status === 404) {
    return hadToken ? { state: 'bad-token' } : { state: 'needs-token' };
  }
  return { state: 'failed', detail: `GitHub answered ${status}` };
}

/**
 * Asks GitHub what the newest build is.
 *
 * `runningVersionCode` is this APK's counter — `buildInfo().buildNumber`.
 * Network failure is reported as `offline` rather than thrown: the Settings
 * screen has to keep working in airplane mode (I4), and "could not ask" is
 * information, not an error state to recover from.
 */
export async function checkForUpdate(
  runningVersionCode: number | null,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheck> {
  let response: Response;
  try {
    response = await fetchImpl(`${RELEASES_API}?per_page=10`, { headers: headers(token) });
  } catch {
    return { state: 'offline' };
  }

  if (!response.ok) return failureFor(response.status, token !== null);

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { state: 'failed', detail: 'GitHub sent something that was not JSON' };
  }

  const releases = ReleasesSchema.safeParse(parsed);
  if (!releases.success) {
    return { state: 'failed', detail: 'The releases list was not in the expected shape' };
  }

  const build = pickBuild(releases.data);
  if (!build) return { state: 'none' };

  const comparison = compareBuild(runningVersionCode, build.versionCode);
  return { state: comparison, build };
}
