# Releases — updating the field-test phone from anywhere

Field testing happens away from the laptop, so a new build has to reach the
phone without a cable, without Metro, and **without wiping the inventory that
the field test has been accumulating**. That is what
`.github/workflows/android-apk` does: build a standalone release APK on
GitHub's runners and attach it to a GitHub Release the phone can download.

## Cutting a build

Two ways, both drivable from a phone browser:

| | How | Produces |
|---|---|---|
| **Ad-hoc build** | Actions → **Android APK** → *Run workflow* (pick the branch) | Release `build-<n>`, marked pre-release, version `0.1.0+ci.<n>` |
| **Named version** | Push a tag: `git tag v0.2.0 && git push origin v0.2.0` | Release `v0.2.0`, version `0.2.0` |

Both run `typecheck` + the Jest suite first — a release APK never ships from
red code — then `expo prebuild` → `assembleRelease`, and publish the APK with
install instructions and the commit list since the previous release.

Default build is **arm64-v8a only** (~60 MB instead of the ~181 MB four-ABI
APK — it matters when the download happens on workshop Wi-Fi). Any phone from
the last decade is arm64; the *Run workflow* dialog offers the wider ABI sets
if a build ever has to run on something older or on an x86 emulator.

## Installing on the phone

1. Open the Release page on the phone, tap the `.apk` asset.
2. Chrome will ask for permission to install unknown apps the first time —
   grant it (Settings → Apps → Chrome → Install unknown apps).
3. Tap the downloaded file → **Update** → **Open**.

**Never uninstall first.** Uninstalling deletes the app's private storage,
which is where everything lives.

## Why your data survives an update

Android keeps an app's private storage across an update as long as three
things hold. All three are deliberate here:

- **Same package** — `com.anonymous.binocular`, set in `app.json`.
- **Same signing key** — `expo prebuild` writes the React Native template
  debug keystore to `android/app/debug.keystore`, and the generated
  `build.gradle` signs the *release* build type with it. That is the same key
  your local `npx expo run:android --variant release` build used, so a
  CI-built APK is a legitimate update to the app already on the phone rather
  than a stranger Android refuses to trust.
- **versionCode never goes backwards** — CI stamps `1000 + <run number>`
  (`scripts/ci/stamp-app-version.mjs`), so every build is newer than the last
  and comfortably newer than a local build (which is always `1`).

Everything the app owns is in that private storage and is untouched by an
in-place update: the SQLite database (bins, items, scans, the FTS index, the
diagnostics event log), the photo store under `Documents/photos/`, and the
API keys in `expo-secure-store`. Migrations run on boot as usual, so a build
carrying a new migration upgrades the existing database in place — the same
path already exercised for migrations 003–005.

### Belt and braces

Before installing a build that carries a schema migration, take 20 seconds:
**Settings → Export backup** and save the zip off the phone. Restore is
`Import backup` on a fresh install (Stage 6 AC: export → wipe → import
restores an identical database). It has never been needed, and it is much
easier to have than to wish for.

## When Android refuses the install

| Symptom | Cause | Fix |
|---|---|---|
| *"App not installed"* / signature mismatch | The installed app was signed with a different key (e.g. a build from an EAS-managed keystore) | Export a backup, uninstall, install the new APK, import the backup |
| *"A newer version is already installed"* | Downgrade — an older `versionCode` | Build again (run number always climbs), or `adb install -d` to force |
| Local `run:android --variant release` now refuses to install | Local builds are `versionCode 1`, CI builds are `1000+` | `adb install -d -r android/app/build/outputs/apk/release/app-release.apk` |
| Play Protect warns about an unknown developer | Sideloaded APK, no Play Store record | Expected; *Install anyway* |

## The signing-key trade-off

The template debug keystore is **public** — it ships with React Native and is
identical in every project that uses it. For a personal app sideloaded onto
one phone that is an acceptable trade, and it is what makes today's update
seamless. What it costs: this APK can never go to the Play Store, and anyone
with physical access to the phone could install a build that impersonates it.

Graduating to a private release key is a real change, not a config tweak: a
different key means Android treats the new APK as a different app, so it
requires the export → uninstall → install → import migration above, once.
Worth doing before the app goes to any phone but your own — which is also
when blueprint Q1 (the API-key proxy) has to be answered. Not before.

## Scope note

This is build-and-deliver plumbing only. It adds no runtime behaviour, no new
dependency, and touches no blueprint decision — the roadmap (§10) and
invariants (§11) are unaffected. `app.json` is stamped in the CI checkout
only; the committed version stays whatever the repo says.
