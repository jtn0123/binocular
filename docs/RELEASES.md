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

Ad-hoc builds are published as **pre-releases**, which is why the app's
*Check for updates* opens `/releases` rather than `/releases/latest` — that
URL resolves only to the newest *non*-pre-release and 404s while only ad-hoc
builds exist. Push a `v*` tag when you want a build to be the "latest".

Default build is **arm64-v8a only** — it matters when the download happens on
workshop Wi-Fi. Any phone from the last decade is arm64; the *Run workflow*
dialog offers the wider ABI sets if a build ever has to run on something older
or on an x86 emulator.

The single-ABI APK is currently **~100 MB**, not the ~60 MB this file claimed
until the D20 on-device encoder landed: `react-native-executorch` ships large
native libraries, and they dominate both the download and the ~14 minutes the
Gradle step takes. Worth knowing before blaming the Wi-Fi.

### When the build succeeds but nothing is published

If the `build` job is green and `publish` fails with

```
HTTP 403: Resource not accessible by integration (…/releases)
```

it is **not** a workflow bug, and re-running it will not help. The job already
declares `permissions: contents: write`, but that can only narrow what the
repository grants — it cannot add a permission the repository withholds. Check,
in order:

1. **Settings → Actions → General → Workflow permissions.** If it reads *Read
   repository contents and packages permissions*, switch it to *Read and write
   permissions*. This is the usual cause, and it can change under you: build-35
   published normally and build-38 was refused half an hour later from an
   identical job definition.
2. **Settings → Rules → Rulesets**, for a tag rule matching `build-*` or `v*`.
   `gh release create` creates the tag, so a tag ruleset without an Actions
   bypass refuses with the same message.

The APK itself is unaffected — it is attached to the run as an artifact
(Actions → the run → *Artifacts*), so once the setting is fixed, re-run **just
the `publish` job**. It downloads that artifact; nothing is rebuilt, and the
20 minutes are not paid twice. The workflow prints all of this into the run
summary when the step fails.

Note that a run artifact is *not* a substitute for a Release on the phone:
artifacts download as a `.zip` and require a signed-in session, so the APK
cannot be installed straight from one.

### Getting the APK onto the phone

This repository is **private**, so a release asset is served from a
short-lived signed `release-assets.githubusercontent.com` URL. Two consequences
that have each wasted an afternoon:

- The link **expires**. Copying it out of a chat and opening it later gives an
  error page; open the Release page and tap the asset again.
- It only downloads in a browser **signed in to GitHub**. An in-app browser
  inside a chat client usually is not, and fails silently. Open the release
  page in Chrome itself.

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

## Reporting a problem from the workshop

**Settings → Open diagnostics → Copy log**, then paste it wherever the report
goes. That is the reliable path and it should be the first thing tried.

*Share diagnostics* next to it builds the full zip — the event log plus every
photo — and hands it to the share sheet. It is richer, and it needs a share
target willing to accept a 100 MB file, so it is the one that fails when you
most need it. Copy log carries the build, the counts, the memory report, every
crash in full and the last 120 events, and never the inventory or any photo,
so it goes anywhere text goes.

What the log is good for, from the case that prompted it: a **native** crash
kills the process before any JavaScript runs, so the crash handler cannot see
it and the screen will cheerfully say *0 crashes*. The tell is a fresh
`app_start` with no `app_background` before it — the app restarted without
ever shutting down. The app now recognises that pattern on the next launch and
records it as a crash naming the last screen, but the raw event list shows it
either way. If a screen "won't open", look for a restart a few seconds after
its `screen//` line.

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
