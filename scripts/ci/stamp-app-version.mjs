#!/usr/bin/env node
/**
 * Stamps a build's identity into app.json immediately before `expo prebuild`.
 *
 * `android/` is generated and gitignored, so the version has to be set in the
 * Expo config rather than in build.gradle. Writing it here (in the CI checkout
 * only, never committed) keeps three things in agreement:
 *
 *   - `versionName`  — what the diagnostics screen shows, via
 *                      `Constants.expoConfig.version` (src/diagnostics/context.ts)
 *   - `versionCode`  — what Android compares when installing over an existing
 *                      app; it must never go backwards or the update is refused
 *   - the APK filename the release job publishes
 *
 * Usage: VERSION_NAME=0.1.0+ci.7 VERSION_CODE=1007 node scripts/ci/stamp-app-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const versionName = process.env.VERSION_NAME;
const versionCode = Number(process.env.VERSION_CODE);

if (!versionName) {
  console.error('VERSION_NAME is required.');
  process.exit(1);
}
if (!Number.isInteger(versionCode) || versionCode < 1) {
  console.error(`VERSION_CODE must be a positive integer, got: ${process.env.VERSION_CODE}`);
  process.exit(1);
}

const configPath = new URL('../../app.json', import.meta.url);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

config.expo.version = versionName;
config.expo.android = { ...config.expo.android, versionCode };

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`app.json stamped: version ${versionName}, android.versionCode ${versionCode}`);
