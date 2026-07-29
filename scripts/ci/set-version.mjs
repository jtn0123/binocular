#!/usr/bin/env node
/**
 * Writes a newly decided version everywhere the repository records it.
 *
 * python-semantic-release owns the number — it reads the conventional-commit
 * subjects since the last tag and works out the bump — but it only knows how
 * to rewrite its own config. This is its `build_command`, run with the new
 * version in `NEW_VERSION`, and it keeps the two files that would otherwise
 * drift in step with it:
 *
 *   - `VERSION`   — plain text, so anything can read the version without
 *                   parsing TOML or JSON
 *   - `app.json`  — `expo.version`, which is the base the release build stamps
 *                   into the APK and the diagnostics screen reads back
 *
 * Deliberately not the `versionCode`: that is per *build*, not per version
 * (scripts/ci/stamp-app-version.mjs), and two builds of one version must still
 * be installable over each other.
 *
 * Usage: NEW_VERSION=0.2.0 node scripts/ci/set-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.env.NEW_VERSION?.trim();

if (!version) {
  console.error('NEW_VERSION is required.');
  process.exit(1);
}
// Semver as python-semantic-release emits it. Checked rather than trusted
// because this value is written straight into the APK's versionName, and a
// malformed one fails much later, inside Gradle, saying something else.
//
// The pre-release and build parts are two separate optional groups rather than
// one repeated `(?:[-+]…)*`. The repeated form is ambiguous — `-` is in the
// character class as well as in the group's first position, so `-a-a-a-a…` can
// be split more ways the longer it gets, and a near-miss takes exponential
// time to reject: 157ms at 22 parts, doubling with each one after. This form
// gives each part exactly one place to match, so it is linear.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`NEW_VERSION is not a version: ${version}`);
  process.exit(1);
}

const root = new URL('../../', import.meta.url);

writeFileSync(new URL('VERSION', root), `${version}\n`);

const configPath = new URL('app.json', root);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.expo.version = version;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Version set to ${version} in VERSION and app.json.`);
