# Binocular — Implementation Plan

> Companion to [`BLUEPRINT.md`](BLUEPRINT.md). The blueprint is the contract
> (what and why); this plan is the execution order (how, step by step).
> If this plan ever contradicts the blueprint, **the blueprint wins** — fix
> the plan via a `blueprint:` commit.
>
> Working agreement: check boxes off as tasks complete (commit the checkbox
> edits with the work). A stage is closed by a commit tagged
> `stage-N-complete` only after its Exit criteria all pass.

---

## Dependency shortlist

Install per stage as noted; versions pinned by `npx expo install` so they
match the Expo SDK.

| Package | Purpose | First needed |
|---|---|---|
| `expo`, `expo-router`, `react-native` | app skeleton | Stage 0 |
| `expo-sqlite` | database | Stage 0 |
| `zod` | boundary validation | Stage 0 |
| `expo-camera` | capture + QR scanning | Stage 1 |
| `expo-image-manipulator` | resize/compress before upload | Stage 1 |
| `@anthropic-ai/sdk` | Claude vision provider only | Stage 1 |
| OpenAI Responses API via raw fetch — no SDK dependency | second cloud engine (D14) | Stage 1 |
| `expo-secure-store` | API key storage | Stage 1 |
| `expo-file-system` | photo storage, export | Stage 1 |
| `qrcode-generator` (pure JS, unit-testable) | QR rendering for labels | Stage 2 |
| `expo-print` | PDF label sheets | Stage 2 |
| `@react-native-community/netinfo` | connectivity for queue drain | Stage 4 |
| `expo-dev-client` | EAS dev build (native ML module) | Stage 5 |
| `@react-native-ml-kit/image-labeling` (or equiv. per blueprint Q4) | local recognition engine | Stage 5 |
| `expo-sharing` | export zip / CSV via share sheet | Stage 6 |
| Dev: `jest-expo`, `@testing-library/react-native`, `eslint`, `prettier` | tests & lint | Stage 0 |

CSV export needs no dependency — escaping is hand-rolled (and unit-tested).

---

## Stage 0 — Skeleton

**Goal:** boring, boot-able foundation. Everything after this is features.

### Tasks
- [x] `npx create-expo-app` with the TypeScript template; enable `strict`
      in `tsconfig.json`; add ESLint + Prettier configs and npm scripts
      (`lint`, `typecheck`, `test`).
- [x] expo-router scaffold matching blueprint §3: `(tabs)/index` (Home),
      `(tabs)/scan`, `(tabs)/browse`, plus empty `bin/[id]` and
      `review/[scanId]` routes with placeholder screens.
- [x] `src/db/schema.ts`: migration runner (ordered array of SQL strings,
      `PRAGMA user_version` bookkeeping) + migration 001 containing the full
      schema from blueprint §4 including the FTS5 table.
- [x] `src/db/queries.ts`: typed helpers — `createBin`, `getBin`,
      `listBins`, `itemsForBin`, `insertScan`, `updateScanStatus`. No raw
      SQL outside `src/db/` from day one.
- [x] `src/vision/types.ts`: zod schemas verbatim from blueprint §6.1.
- [x] `src/vision/provider.ts` + `src/vision/fixtureProvider.ts` with two
      fixtures (a bin-audit response, a check-in response) and a ~1.5s
      artificial delay.
- [x] Seed script (`npm run seed`): 1 location, 2 shelves, 4 bins, ~12 items.
- [x] Jest: unit tests for the migration runner (fresh DB → all tables
      exist) and zod schema (valid fixture parses; malformed JSON rejects).
- [x] GitHub Actions: `lint` + `typecheck` + `test` on push/PR.

### Exit criteria
- [x] App boots on an Android emulator; three tabs render; Browse shows
      seeded bins.
- [x] CI green.
- [x] Blueprint §11 invariants 3, 6, 7 spot-checked.

---

## Stage 1 — Bin-audit vertical slice

**Goal:** the magic moment works end to end: photo → recognized list →
review chips → saved bin contents.

### Tasks
- [x] **Capture flow** (`app/(tabs)/scan.tsx` → camera screen): mode picker
      (only "Audit bin" enabled), manual bin picker (QR comes in Stage 2),
      capture with "fill the frame with the open bin" hint overlay.
- [x] **Photo pipeline**: save original to app storage; make an upload
      variant via `expo-image-manipulator` (max 1568px long edge, JPEG q80).
- [x] **Scan lifecycle**: `insertScan(status='queued')` in the same
      transaction as photo bookkeeping → set `processing` → call provider →
      store `raw_response` → set `review` (or `failed`). Simple inline
      await for now; the real queue with backoff is Stage 4 — but statuses
      and the transaction shape must match blueprint §9 from the start.
- [x] **Prompt builder** `src/vision/prompt.ts`: template from blueprint
      §6.2 with `binName` / `existingItems` interpolation. Unit-test the
      interpolation.
- [x] **`claudeProvider.ts`**: per blueprint §6.4 — safeParse, one repair
      retry with validation errors appended, `VisionError` taxonomy
      (`network`/`auth`/`invalid_response`/`rate_limit`). Selected only when
      `EXPO_PUBLIC_VISION_PROVIDER=claude`.
- [x] **Settings screen**: API key entry stored in `expo-secure-store`;
      provider picker (fixture/claude — local joins in Stage 5); "test
      connection" button.
      *(Resolves blueprint Q1 with its default: on-device key, personal use.)*
- [x] **Review screen** (`review/[scanId]`): editable chips with the exact
      confidence mapping from blueprint §6.3 (high = pre-selected;
      medium = pre-selected + amber dot; low = de-selected until tapped).
      Inline edit of name/quantity/category; delete; add-manually;
      `scene_notes` banner when present.
- [x] **Merge diff grouping**: auditing a non-empty bin in Merge mode groups
      chips into new / still here / not seen in this photo; "not seen"
      defaults to *keep* — removal requires an explicit tap (blueprint §8.1
      step 6).
- [x] **Save action**: Replace vs Merge choice (default per blueprint §8.1);
      writes items with `source_scan_id`, sets scan `confirmed`, updates
      bin `last_scanned_at` + cover photo. Discard path sets `discarded`.
- [x] **Bin detail** (`bin/[id]`): cover photo, item list, last-scanned.
- [x] **`openaiProvider.ts`** (D14): same contract via the OpenAI Responses
      API — raw fetch, strict structured outputs, same VisionError taxonomy
      and repair retry; engine picker becomes fixture/claude/openai with a
      separate OpenAI key in `expo-secure-store`.
- [x] Component test: review screen renders a fixture response; a `low`
      item is not selected by default; save persists exactly the selected
      chips; in a merge audit a "not seen" existing item survives save
      unless explicitly tapped for removal.

### Exit criteria
- [ ] All blueprint §8.1 acceptance boxes pass **on both providers**
      (airplane-mode box may defer the auto-drain part to Stage 4; queued
      persistence must work now).
- [ ] Blueprint §10 Stage-1 manual test script passes on a real bin.
- [ ] Invariants 1, 2, 3, 5 verified.

---

## Stage 2 — Locations, shelves, QR labels

**Goal:** physical organization + instant bin identity.

### Tasks
- [x] Browse tree CRUD: locations → shelves → bins (create/rename/delete
      with orphan handling: deleting a shelf unassigns its bins, never
      deletes them).
- [x] `src/qr/payload.ts`: encode/parse typed payloads
      `binoc:v1:<type>:<uuid>` (bin | shelf | location, blueprint D13) with
      zod; friendly error toast on foreign QR codes.
- [x] Scanner integration: Scan tab auto-detects a QR in frame → bin QR
      opens that bin's detail (or starts an audit, one tap either way);
      shelf/location QR opens its browse node.
- [x] Bulk creation: "Create N bins" → sequential `short_code`s (B-001…).
- [x] `src/qr/labels.ts`: PDF sheet via `expo-print` — 2"×4" labels, 10/page
      (Avery 5163 geometry), QR left, short code + bin name right; optional
      shelf/location labels through the same flow (QR + name, no short
      code).
- [x] Move mode (blueprint §8.5): bin detail → Move → scan shelf QR or pick
      from list → confirm; location QR at the destination step prompts for
      a shelf within it.
- [x] Unit tests: payload round-trip for all three types; short-code
      sequencing; foreign-QR rejection.

### Exit criteria
- [ ] Blueprint §10 Stage-2 AC: print → stick → cold start → scan → bin
      detail in <2s.
- [ ] Blueprint §8.5 AC: bin re-homed with two scans + one confirm, offline.
- [ ] Manual-pick path still fully usable with zero QR labels printed.

---

## Stage 3 — Search & check-in

**Goal:** the daily-driver features.

### Tasks
- [x] FTS sync: SQLite triggers keeping `item_search` in step with `items`
      (insert/update/delete) — added as a new migration.
- [x] `src/search/fts.ts`: prefix-query helper (`scre*`), result ranking
      (name hits above label_text hits).
- [x] Home screen: search box → results as item cards with
      location → shelf → bin breadcrumb + bin cover thumbnail.
- [x] Check-in flow (blueprint §8.2): capture → same review screen →
      destination picker (QR or list, recent bins first) → append items.
- [x] Find-it photo path (blueprint §8.3): single-item scan → provider →
      feed best identification into text search → show matching bins;
      offline shows the graceful "needs a connection" message.
- [x] Perf test: seed 1,000 items, assert search <100ms.

### Exit criteria
- [x] All blueprint §8.2 and §8.3 acceptance boxes pass (photo-path offline
      message + multi-scan queueing re-verified end-to-end in Stage 4's
      airplane sweep).

---

## Stage 4 — Offline hardening

**Goal:** the garage-with-no-Wi-Fi reality.

### Tasks
- [ ] `src/queue/scanQueue.ts` per blueprint §9: single drain loop triggered
      on app foreground + NetInfo connectivity change; oldest-first;
      backoff 30s → 2m → 10m → manual retry button.
- [ ] Error taxonomy handling: `network`/`rate_limit` → back to `queued`;
      `invalid_response`/`auth` → `failed` with surfaced error and (for
      auth) a deep link to Settings.
- [ ] Queue UI: badge on Scan tab; queue screen listing pending/failed
      scans with retry/discard.
- [ ] Photo pruning job: `discarded`/`failed` scans older than 30 days.
- [ ] Kill-test instrumentation: app killed mid-`processing` → scan found
      and resumed as `queued` on next launch.

### Exit criteria
- [ ] Blueprint §10 Stage-4 AC: 5 scans queued in airplane mode all resolve
      after reconnect, in order, no duplicates.
- [ ] Every screen except live recognition passes an airplane-mode sweep
      (invariant 4).

---

## Stage 5 — Local recognition engine

**Goal:** recognition that works in a no-signal garage, selectable next to
the cloud engine.

### Tasks
- [ ] Decide blueprint Q4 (ML Kit image labeling vs bundled TF Lite);
      record the decision as a `blueprint:` commit.
- [ ] Switch to an EAS dev build (`expo-dev-client`) — the ML module is
      native; document the new run workflow in the README.
- [ ] `src/vision/localProvider.ts`: map on-device labels →
      `RecognitionResult` (generic names; `brand`/`label_text` always null;
      confidence per the §6.3 rubric — in practice medium/low). On-device
      ML imports live only in this file (blueprint §3).
- [ ] Settings: engine picker becomes fixture / local / claude; switching
      requires no restart; capability messaging ("local can't read labels —
      use cloud for packaged goods").
- [ ] Contract tests: localProvider output passes the same zod schema and
      review-screen component tests as the fixture provider.

### Exit criteria
- [ ] Blueprint §10 Stage-5 AC: airplane-mode bin audit end-to-end on the
      local engine; identical review behavior across all three providers.

---

## Stage 6 — Daily-driver extras

### Tasks
- [ ] Checkout/return (blueprint §8.4): long-press → check out to free-text
      name; badge on item; "Checked out" list on Home; one-tap return.
- [ ] Low-stock: `low_stock_threshold` editing on consumables; Home surfaces
      a "Running low" section. *(Blueprint Q2 default: coarse counts.)*
- [ ] Bin photo history: every `confirmed` audit's photo browsable as a
      timeline on bin detail. *(Blueprint Q3 default: store 1080p
      re-encodes, not originals.)*
- [ ] Export/import: zip of JSON dump + photos via share sheet; import
      restores into an empty database (refuse non-empty).
- [ ] CSV export (blueprint D12): all items, one row per item with
      location/shelf/bin breadcrumb columns, via share sheet; hand-rolled
      escaping. Unit test: commas, quotes, and newlines in item names
      round-trip correctly.

### Exit criteria
- [ ] Blueprint §10 Stage-6 AC: export → wipe → import → identical database
      (verified by row counts + spot checks).
- [ ] CSV opens cleanly in Excel/Google Sheets with correct columns.

---

## Stage 7 — iOS pass & polish

### Tasks
- [ ] Run every prior stage's manual test script on iOS; log and fix
      platform issues (camera permissions flow, safe areas, share sheet).
- [ ] Haptics on capture/save; empty states for every list; app icon +
      splash.
- [ ] README update: real setup instructions replacing the "not yet
      scaffolded" note.

### Exit criteria
- [ ] Full manual suite green on both platforms.

---

## Testing strategy (cross-stage)

- **Unit (Jest):** migrations, zod schemas, prompt builder, QR payload
  (all three types), short-code sequencing, CSV escaping, queue state
  transitions (with a mocked provider).
- **Component (Testing Library):** review-chips behavior — this is where the
  confidence-mapping and no-silent-writes invariants are enforceable in
  code, so it gets the densest coverage.
- **Fixture-first:** automated tests never call the real API; the fixture
  provider is the test double *and* the demo mode. Every provider
  (fixture, local, claude-mocked) must pass the same contract tests —
  the review screen cannot tell them apart.
- **Manual scripts:** each stage's script lives in the blueprint §10 and is
  run on-device before `stage-N-complete`.

## Risk register

| Risk | Mitigation |
|---|---|
| Recognition quality disappoints on cluttered bins | The Stage-1 manual test sets an explicit ≥70% bar; capture hints (framing, bench layout for check-in); prompt iteration is cheap and isolated in `prompt.ts` |
| API cost creep | One call per scan by design; image downscaled before upload; per-scan cost logged in Settings later if needed |
| Expo module churn between SDK versions | Pin via `npx expo install`; upgrade SDK only between stages, never mid-stage |
| Local-engine labels too generic to be useful | localProvider maps honestly to medium/low confidence; UI messaging steers packaged goods to the cloud engine; blueprint Q4 revisits the model choice against the same ≥70% bar |
| SQLite FTS5 availability differences on iOS | Verified in Stage 0 tests on both platforms (jest-expo runs both configs); fallback is a LIKE-based search behind the same `fts.ts` interface |
| Scope creep past v1 | Blueprint non-goals list + this plan's stage gates; new ideas get parked in a `docs/BACKLOG.md`, not built |
