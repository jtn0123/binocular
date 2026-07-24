import { describeBuild, RELEASES_URL, type BuildInfo } from '../build';

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  version: '0.1.0',
  buildNumber: 1012,
  isDev: false,
  ...over,
});

describe('build description', () => {
  it('names the version, the upgrade counter and the build type', () => {
    expect(describeBuild(info({ version: '0.1.0+ci.12' }))).toBe(
      '0.1.0+ci.12 · build 1012 · release',
    );
  });

  it('marks a dev build as such, so a field report says which it was', () => {
    expect(describeBuild(info({ isDev: true }))).toBe('0.1.0 · build 1012 · dev');
  });

  it('omits the build number when the platform has none', () => {
    expect(describeBuild(info({ buildNumber: null }))).toBe('0.1.0 · release');
  });

  it('points at the releases page rather than a guessed-at version', () => {
    expect(RELEASES_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/binocular\/releases$/);
  });

  it('does not use /releases/latest, which 404s while only pre-releases exist', () => {
    // Ad-hoc `Run workflow` builds publish as pre-releases, and /latest
    // resolves only to the newest non-pre-release. Verified against the live
    // repository: with build-8 published, /releases/latest returned 404.
    expect(RELEASES_URL).not.toContain('/latest');
  });
});
