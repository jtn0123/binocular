# Binocular 🔭🗄️

**Point your camera at a bin and know what's inside.**

Binocular is a mobile app for home workshops: photograph a bin (or items on
your bench) and AI vision identifies the contents, files them under the right
bin → shelf → location, and later answers *"where is my 10mm socket?"* in two
taps.

- **React Native + Expo** (TypeScript strict, Android-first, iOS-ready)
- **Four recognition engines** behind one provider abstraction: fixture
  (offline demo), on-device ML Kit (dev build), Anthropic Claude, OpenAI —
  pick per-device in Settings, each cloud engine with its own API key in the
  secure store
- **QR-labeled bins and shelves** — print Avery 5163 sticker sheets from the
  app; scan to jump to a bin or re-home one (move mode)
- **Offline-first** — SQLite + FTS5 search; photos queue with capped backoff
  and auto-drain on reconnect
- **Daily driver** — check-out/return, low-stock alerts, audit photo history,
  full zip backup/restore, CSV export
- **Cost transparency** — every cloud scan records *measured* token usage and
  dollar cost from the API's own `usage` field; pre-scan estimates on the
  capture screen, cumulative spend in Settings (never a guessed number)

## Status

Stages 0–6 of the roadmap are built, tested (**259 Jest tests**), and
emulator-verified, plus hardening passes: trust-boundary fuzzing,
property-based tests, 1,000-item perf assertions, queue chaos coverage, an
8,000-event monkey run, and an accessibility sweep. The **standalone release
build** has been validated end-to-end on the emulator (no Metro): first-run
flow, scan → review → save, search, diagnostics screen and share-zip export,
and cold-restart persistence — see `docs/POLISH.md` §Field-test readiness.

Still open: the Stage 7 iOS pass, and the physical-world exit criteria that
need real hardware — a real-bin recognition audit with a cloud API key and a
print-then-scan label round-trip. (This machine's emulator captures black
camera stills, so real-image recognition testing needs a physical device —
see `docs/POLISH.md`.)

## Development

```bash
npm install
npm run start        # Metro; press `a` for Android
npm test             # Jest (jest-expo; better-sqlite3 backs the db tests)
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # expo lint
npm run seed         # writes an inspectable dev.db via better-sqlite3
npm run eval         # score an engine against the labeled eval set
```

### Recognition eval

`npm run eval` measures recall/precision against hand-labeled photos —
accuracy is *measured*, never self-reported by a model:

```bash
npm run eval                      # fixture engine (free; proves the harness)
OPENAI_API_KEY=… npm run eval -- --engine openai
ANTHROPIC_API_KEY=… npm run eval -- --engine claude
```

Keys are read from your shell at run time — never stored or committed.
Cloud runs also print measured token usage and cost.

### Test images

- `eval/corpus/` — the small hand-labeled eval set used by `npm run eval`.
- `eval/pool/` — 213 CC-licensed workshop images harvested from Wikimedia
  Commons and deduplicated by perceptual hash. Each carries a `status` in
  `pool.json`: **banked** (68, human-confirmed useful — the working test set
  and seed for a future custom detector), **rejected** (145, archived not
  deleted). Credits in `LICENSES.md` / `BANK.md`.
- Image files are **gitignored**; `scripts/devtest/fetch-pool.sh` rebuilds
  them from the manifest after a clone.

### Diagnostics (field testing)

The app keeps a **local, bounded event log** (blueprint D16) so a problem in
the workshop can be diagnosed afterwards — app lifecycle, screen
breadcrumbs, scan timings with the engine used, queue retries, searches, and
**crashes** (a global handler captures what would otherwise vanish when the
process exits).

- **Settings → Open diagnostics** shows crash/event counts, build + network
  context, recent events with durations, and a recording toggle.
- **Share diagnostics** zips the event log, the full DB dump, device context
  and photos to the share sheet.
- Always on (including release builds — a standalone walk-around APK has no
  Metro console), capped at **5,000 events / 30 days**, pruned on boot.
- **Nothing is ever uploaded.** No telemetry, no third-party crash SDK, and
  API keys are never logged or exported — only whether a key exists.

### Device test scripts

```bash
./scripts/devtest/chaos.sh              # offline/kill chaos vs the app's own SQLite
./scripts/devtest/inject-camera-image.sh # put a known photo on the emulator camera
```

Everything except the on-device engine runs in **Expo Go**. The local ML Kit
engine needs the dev build:

```bash
npx expo run:android   # builds + installs the dev client
npx expo run:ios       # needs an iOS simulator runtime downloaded in Xcode
```

> **Java:** the build is pinned to a **JDK 21** Gradle daemon by the
> `plugins/withGradleDaemonJvm.js` config plugin (it writes
> `android/gradle/gradle-daemon-jvm.properties` on every prebuild, since
> `android/` is generated and gitignored). Your shell's default `java`
> doesn't matter — you just need a JDK 17–21 installed for Gradle to
> discover. (JDK 24+ breaks AGP's native configure step with a cryptic
> "restricted method in java.lang.System" error; the pin makes that
> impossible to hit.)

For a **standalone field-test build** (no Metro tether — install, unplug,
walk around; release is pre-wired to the debug keystore):

```bash
npx expo run:android --variant release --device
```

Away from the laptop, the same build comes from CI instead: Actions →
**Android APK** → *Run workflow* (or push a `v*` tag) publishes a signed APK
as a GitHub Release the phone can download and install **over** the existing
app, keeping its bins, items and photos — see [`docs/RELEASES.md`](docs/RELEASES.md).

Recognition engines are chosen in **Settings**, where each cloud engine's API
key is stored in `expo-secure-store` (never in the repo or bundle). The
whole app is demo-able on the fixture engine with seeded data and bundled
demo photos (`assets/demo/`, dev only).

## Documentation

| Doc | Role |
|---|---|
| [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) | **Source of truth.** Vision, decision log, data model, AI vision contract, workflows with acceptance criteria, Stage 0–7 roadmap, invariants |
| [`docs/PLAN.md`](docs/PLAN.md) | Execution plan: file-level task checklists per stage, exit criteria, dependencies, testing strategy, risk register |
| [`docs/POLISH.md`](docs/POLISH.md) | Living post-stage polish plan: pass order, cost/tokenizer notes, image resource ideas |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Parked post-v1 ideas and the long-term list |
| [`docs/RELEASES.md`](docs/RELEASES.md) | Shipping a build to the field-test phone: CI release APKs, install rules, why an update keeps your data |
| [`CLAUDE.md`](CLAUDE.md) | Standing orders for AI coding agents: blueprint is law, work in plan order |
