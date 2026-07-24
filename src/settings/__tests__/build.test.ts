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
    expect(RELEASES_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/binocular\/releases/);
  });
});
