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
- [x] `src/queue/scanQueue.ts` per blueprint §9: single drain loop triggered
      on app foreground + NetInfo connectivity change; oldest-first;
      backoff 30s → 2m → 10m → manual retry button.
- [x] Error taxonomy handling: `network`/`rate_limit` → back to `queued`;
      `invalid_response`/`auth` → `failed` with surfaced error and (for
      auth) a deep link to Settings.
- [x] Queue UI: badge on Scan tab; queue screen listing pending/failed
      scans with retry/discard.
- [x] Photo pruning job: `discarded`/`failed` scans older than 30 days.
- [x] Kill-test instrumentation: app killed mid-`processing` → scan found
      and resumed as `queued` on next launch.

### Exit criteria
- [x] Blueprint §10 Stage-4 AC: 5 scans queued in airplane mode all resolve
      after reconnect, in order, no duplicates (unit test) + single-scan
      airplane cycle verified live in the emulator.
- [x] Every screen except live recognition passes an airplane-mode sweep
      (invariant 4) — browse/search/labels are pure SQLite, verified
      during the offline session.

---

## Stage 5 — Local recognition engine

**Goal:** recognition that works in a no-signal garage, selectable next to
the cloud engine.

### Tasks
- [x] Decide blueprint Q4 (ML Kit image labeling vs bundled TF Lite);
      record the decision as a `blueprint:` commit.
- [x] Switch to an EAS dev build (`expo-dev-client`) — the ML module is
      native; document the new run workflow in the README.
- [x] `src/vision/localProvider.ts`: map on-device labels →
      `RecognitionResult` (generic names; `brand`/`label_text` always null;
      confidence per the §6.3 rubric — in practice medium/low). On-device
      ML imports live only in this file (blueprint §3).
- [x] Settings: engine picker becomes fixture / local / claude; switching
      requires no restart; capability messaging ("local can't read labels —
      use cloud for packaged goods").
- [x] Contract tests: localProvider output passes the same zod schema and
      review-screen component tests as the fixture provider.

### Exit criteria
- [x] Blueprint §10 Stage-5 AC: bin audit end-to-end on the local engine
      verified in the dev build (ML Kit bundled model, zero network);
      review behavior identical across providers. Engine switch is a
      Settings tap, no restart.

---

## Stage 6 — Daily-driver extras

### Tasks
- [x] Checkout/return (blueprint §8.4): long-press → check out to free-text
      name; badge on item; "Checked out" list on Home; one-tap return.
- [x] Low-stock: `low_stock_threshold` editing on consumables; Home surfaces
      a "Running low" section. *(Blueprint Q2 default: coarse counts.)*
- [x] Bin photo history: every `confirmed` audit's photo browsable as a
      timeline on bin detail. *(Blueprint Q3 default: store 1080p
      re-encodes, not originals.)*
- [x] Export/import: zip of JSON dump + photos via share sheet; import
      restores into an empty database (refuse non-empty).
- [x] CSV export (blueprint D12): all items, one row per item with
      location/shelf/bin breadcrumb columns, via share sheet; hand-rolled
      escaping. Unit test: commas, quotes, and newlines in item names
      round-trip correctly.

### Exit criteria
- [x] Blueprint §10 Stage-6 AC: export → wipe → import → identical database
      (dump/restore round-trip asserted equal in tests, photo uri rewrite
      covered).
- [x] CSV opens cleanly in Excel/Google Sheets with correct columns
      (escaping unit tests for commas/quotes/newlines; CRLF line ends).

---

## Stage 7 — iOS pass & polish

### Tasks
- [ ] Run every prior stage's manual test script on iOS; log and fix
      platform issues (camera permissions flow, safe areas, share sheet).
- [x] Haptics on capture/save/discard; empty states exist for every list;
      icon + splash still the template set (custom art parked).
- [x] README update: real setup instructions replacing the "not yet
      scaffolded" note.

### Exit criteria
- [ ] Full manual suite green on both platforms.

---

## Map customization (blueprint D21, amended 2026-07-25)

Post-roadmap work: the derived map proved worth opening, so the deferred half
of D21 — arranging the wall on the picture of it — was built.

### Tasks
- [x] Migration 010: `bins.sort_order`, `shelves.capacity`. Existing rows land
      at 0 and every bin query breaks ties by `short_code`, so a pre-migration
      workshop keeps exactly the order it had.
- [x] `src/db/mapView.ts`: `planDrop` (insert-before arithmetic, no-op
      detection, cross-shelf flagging), `locateMany`, `rowGaps`, `heatTier` —
      pure, so the arrangement rules are testable away from a screen.
- [x] `placeBin` applies a plan in one transaction; `moveBinToShelf` appends
      to the destination's order. Backups round-trip both columns and pre-D21
      backups import with clean defaults.
- [x] `app/map.tsx`: lift-and-place moving (cross-shelf drops confirm, per
      §8.5), capacity gaps, item-count / staleness tints, multi-bin highlight
      with a stepper, shelf add/rename/resize and new-bin in place.
- [x] Home: a search matching ≥2 bins offers "show all N on the map".
- [x] Screen-level tests that press the controls, plus the map button's route.

### Withdrawn, then rebuilt in a different shape
- [x] ~~Finger-following drag~~ — built, shipped to the field phone, and
      withdrawn in the same day. Wrapping every cell in a gesture-handler
      detector driving reanimated worklets killed the process natively; the
      event log showed an `app_start` seconds after every `screen//map` with
      no `app_background` between. Tap-to-place covers the same ground. Do not
      retry without testing on a device first.
- [x] Retried, deliberately, with the per-cell detector as the suspect:
      **one** `Gesture.Pan` for the whole map and **one** animated node (the
      ghost). Which bin was grabbed is a hit-test against measured frames, so
      a wall of 40 bins costs one detector rather than 40. The pan activates
      only after a 400 ms hold, so it never competes with the vertical map
      scroll or a shelf's own sideways scroll.
- [x] The drag rides *on top of* lift-and-place rather than replacing it: a
      hold that never moves is exactly today's lift, and every tap path is
      untouched. `Settings › Map › Drag bins to rearrange` switches the
      gesture layer off and leaves the screen fully usable — which is also
      the answer if the crash ever returns in the field.
- [x] `src/map/dragGeometry.ts`: frozen-at-lift-off measurement and slot
      hit-testing, pure and unit-tested. Two bugs the prototype found are
      asserted there — the landing slot must not feed its own displacement
      back into the index, and the lifted bin must be excluded from the
      snapshot rather than counted.
- [x] The gesture's live target lives on a ref, not React state: a pan can
      finalize in the same task as its last update, and reading state there
      commits the previous slot — which is what made an earlier version land
      one slot short, but only sometimes.

### Map as a tab, and the shelf-board redesign
- [x] `app/map.tsx` → `app/(tabs)/map.tsx`. `/map?highlight=…` is unchanged
      for every caller, because a route group is not part of the path.
- [x] Shelves drawn as boards: bins standing in a strip on a plank, recessed
      label holders, slot ticks, uprights, capacity gaps, unshelved tray with
      no plank. Uniform card width is load-bearing, not cosmetic — it is what
      makes the slot arithmetic in `dragGeometry` possible.
- [x] Whole-wall strip (grid toggle): every shelf shrunk to a row of cells;
      tap to jump, or drag a bin onto it to send it to that shelf without
      scrolling. Drawn from the same derived data — no second truth (D21).
- [x] Search on the map itself, over bin name and short code, sharing the
      banner and stepper with Home's `highlight` hand-off.
- [x] Shelf sheet replacing three icon buttons and their prompts: rename,
      slot stepper, add bin, delete. Deleting a shelf moves its bins to the
      unshelved tray and never destroys inventory (§11).
- [x] Cross-shelf drops confirm in a sheet rather than an `Alert`, showing
      where from, which slot, an over-capacity warning, and the fact that the
      printed label does not follow the bin.

### Exit criteria
- [x] Arrangement survives a reopen (asserted against the database, not the
      render tree).
- [x] Blueprint §11 invariants: no AI writes, no percentages, providers
      untouched, offline-only, zod at the backup and preference boundaries,
      migrations append-only.
- [ ] Confirmed on the field-test phone that the map opens and stays open.
- [ ] **Confirmed on the field-test phone that the drag does not kill the
      process.** Until this is ticked the feature is unproven, not fixed: the
      single-detector rewrite is a reasoned hypothesis about the 2026-07-25
      crash, not a diagnosis of it. If it recurs, turn the switch off and the
      screen keeps working.
- [ ] Confirmed on the field-test phone that a 400 ms hold and the drag that
      follows it are usable with gloves on.

## The v3 wall (design import: `Binocular v3.dc.html`)

The map stopped being a scrolling list of locations and became the wall you
walk along: a location is a **rack**, one rack fills the screen, and the
strip along the bottom is the whole run of shelving.

### Tasks
- [x] Migration 011: `locations.sort_order`, `shelves.sort_order`, both
      backfilled in the order those rows sort today, so an existing workshop
      opens looking exactly as it did. Alphabetical was fine for a list and
      wrong for a picture — "Top, Upper, Lower, Bottom" sorts to a rack drawn
      upside down. Backups round-trip both; pre-v3 backups import at 0.
- [x] `mapView.ts` rack helpers, all pure: the `"R1 · Door"` name convention
      (`rackCodeOf` / `rackLabelOf` / `composeRackName` / `nextRackCode`),
      `areaFill`, `rackRoom`, `openRowOf`, `overflowTarget`, `planMultiDrop`,
      and `withTray` — the tray is fixed chrome now, so it has to exist as a
      real row even when empty or it is drawn but cannot be dropped into.
- [x] `app/(tabs)/map.tsx` rebuilt: rack header with in-place rename (the
      *label* only — the code is on a printed sticker), lens chips, find,
      edit mode with COLUMNS/ROWS steppers, hits bar naming the racks the
      other matches are on, side rails that page at rest and SEND with a bin
      in hand, unshelved tray drawer, rack scrubber, whole-wall sheet with
      rack reorder/rename/remove/add.
- [x] Multi-select: hold a bin › *Select more* › pick › *Move them* — one
      transaction, one undo. Carrying them one at a time is the thing that
      makes re-shelving take all afternoon.
- [x] Rack picker for an ambiguous SEND: one rack that way just goes (the
      re-home confirm still asks), two or more and it asks rather than
      guessing, naming the shelf and slot each would land on. Choosing there
      *is* the confirm, so it does not ask twice.
- [x] Over-capacity shelves offer `move 1 → <shelf>` instead of only
      complaining; the tray is the fallback only when the rack is packed.
- [x] `mapViewState.ts`: rack, lens and tray state survive leaving the
      screen. Stored by rack *index*, not id — an id strands the view on a
      rack that has since come off the wall.
- [x] Map settings (drag, slot ticks) reachable from the map itself, not
      only from Settings: the moment you need the drag switch is the moment
      the map is misbehaving under your thumb.
- [x] The drag is scoped to the rack on screen plus the tray. Board frames
      live in refs keyed by shelf id and outlive the rack that reported them,
      so measuring every area let a drop on rack 2 land against rack 1's last
      known layout. The tray registers a window frame, so it takes a drag as
      well as a tap.
- [x] Removing a rack or deleting a shelf opens the tray its bins fell into —
      safe in the database and nowhere on the screen is the one impression
      §11 must never give.
- [x] Browse redrawn to match: filter, rack › shelf (fill, over) › bin rows
      carrying item count and time since the last scan. Shelf editing shares
      the map's `ShelfSheet`, with bulk-create and poster printing passed in
      as extras.
- [x] Bin detail: a place row that shows the bin on the map, *Add item* and
      *Audit* as the two jobs that stay on screen, everything else one tap
      deeper in an overflow sheet, and Select on the item list's own header.

### Not carried over from the mock, deliberately
- **The "MAP EDIT STILL ON" bar on other tabs.** Edit mode is local to the
  map screen here rather than global state, and the edit header — with its
  Done button — is the first thing you see on coming back.

### Exit criteria
- [x] Arrangement, rack order and rack shape survive a reopen (asserted
      against the database, not the render tree).
- [x] Blueprint §11 invariants: no AI writes, no percentages, providers
      untouched, offline-only, zod at the backup and preference boundaries,
      migrations append-only.
- [x] Verified live on the Android emulator: edit mode and both steppers,
      add-rack (pages to it), rail paging, drag reorder (persisted, undone),
      drag-to-rail SEND with the §8.5 confirm, resting on a rail paging the
      wall mid-drag, the whole-wall sheet, Browse and bin detail. Two bugs
      only a device could show were found and fixed here: paging mid-drag
      left the frozen drop geometry describing the previous rack (now
      re-frozen after the page), and an unmounted rail's window frame kept
      catching drops (now forgotten on unmount).
- [x] Driven end to end on the emulator as a UX pass, which found six things
      no test could see. The load-bearing one: **a hold that never moved put
      the bin straight back down.** The pan activates on the hold itself, the
      edge auto-scroll had already resolved the slot under the motionless
      finger, and `planDrop` correctly answered "this changes nothing" — so
      lift-and-place, the path that must always work and the only one a
      screen reader drives, did nothing whenever the drag was on. A hold that
      never travels is now a lift, guarded before every other branch.
      Also fixed: the hits bar claimed all the leftover height (a horizontal
      ScrollView in a flex column), the undo snackbar covered the tray and
      the rack scrubber for six seconds after every move, the whole-wall
      thumbnails stacked one per row on a 360 dp phone, the rack picker never
      said which racks it was offering, `summarize` said "2 shelfves", and
      the root stack still declared a `map` route that moved into `(tabs)`.
- [x] A second pass on the two the first one left. **Bins kept a dotted
      outline after being dragged**: on Android a view that has rendered
      `borderStyle: 'dashed'` keeps it when the next style merely omits the
      key, so the diff has nothing to send. The style object was right and
      only the device was wrong, which is why it survived a snapshot. Every
      base style a dashed variant sits on now restates `solid` — the bin
      card, the rack rail, the banner, and the wall-sheet cells, all four of
      which toggle. **"+ RACK" scrolled off the wall**: it was the last
      segment of a strip that already overflows at three racks, so the only
      way to add a rack left the screen exactly when you had enough racks to
      want another. Pinning it outside the scroller kept it reachable but
      sheared the last rack in half behind it; see the rebuilt strip below for
      what the design actually does.
- [x] **The rack panel rebuilt to the design, having first shipped a version
      that only matched it from a distance.** Everything around the panel was
      right and the panel itself — the hero of the screen — was the previous
      version's: fixed 118pt cards in a sideways-scrolling strip on a flat
      ground. Five structural corrections: the well is pegboard (a tiled dot
      grid; RN has no CSS gradients, so it ships as a 14pt image), shelves
      spread down the panel instead of stacking at the top, cells *share* the
      row (`flex: 1 1 0` capped at 76pt, centred, no sideways scroll), the
      card puts its code holder on top with the name and count under it and
      carries no photo, and the plank is a 4pt ticked bar rather than a
      chunky ledge. The panel is also its own scroller, as in the design, so
      a tall rack scrolls inside its recess while the rails, tray and
      scrubber stay put. `slotMidlines` takes a row width now instead of a
      card constant, so the drag follows the flexible slots.
- [x] **The chrome, which was still the navigator's.** Every tab was wearing
      a stock header — the same title slab with the same settings gear —
      where the design gives each tab a 54pt bar of its own with its *own*
      right-hand action: Home says "Binocular" and offers Settings, Browse
      offers a new bin in amber, Scan offers nothing, and the map has no
      title bar at all. That last one is not cosmetic: the map is a picture
      of a wall, and the header was costing it half a shelf. `ScreenHeader`
      draws the bar and pads the status-bar inset itself, so 54pt stays 54pt
      on every device. The tab bar is the design's too — 56pt, 21pt icons
      over 10pt labels, Home's magnifier filling in when you stand on it —
      plus the bottom inset, which a flat 56 was clipping the labels with.
      Bin detail draws its own too — the design's 54pt bar with a back
      chevron and a 17pt title, where the navigator was spending 90pt on a
      24pt one that truncated the bin's name. The screens the design does not
      draw keep the stack header, brought to the same 17pt so they do not
      read as a different app.
- [x] **A line-by-line pass over the map against the design source**, which
      turned up three more:
      **There is no idle banner.** `idleTitle` is computed in the mock and
      never rendered — at rest the design shows toolbar, panel, tray,
      scrubber and nothing else. A standing line saying "3 racks · 10
      shelves / drag a bin to rearrange" was costing the wall a whole shelf
      to explain that the wall is a wall.
      **The carrying bars float.** Drag, held and pick are
      `position: absolute; top: 58` in the design; only find, no-hits and
      missing are in the flow. Mine pushed the panel down, so picking a bin
      up moved the row you were aiming at. `MapBanner` is now two components
      — `MapCarryBar` over the panel, `MapFindBar` in the flow — and the
      drag variant is `pointerEvents="none"`, since a bar that swallowed the
      finger would cancel the move it describes.
      **A rack code was being invented outside the map.** The design splits
      `"R1 · Door"` into code and label only where it needs the halves apart
      — the edit header, the scrubber, the wall's edit mode. Everywhere else
      it prints `locations.name` as stored. Browse and the wall's plain mode
      were synthesising `"R1 · GARAGE"` for a rack the user had simply called
      "Garage", putting a code on the screen that is nowhere in the data.
      The toolbar went back to the design's metrics at the same time; the
      "Lens" caption is dropped, and only that, because at 360pt the caption
      plus three labels plus Find plus Edit do not fit and it is the one
      element whose loss costs neither a control nor a legible word.
- [x] Tests for all of it, each checked against the bug it exists for by
      reverting the fix and watching it fail: the dashed-border restatements,
      the sharing scrubber, the hits bar's height, the picker's subtitle, the
      plural of "shelf", and a structural test that no `<Stack.Screen>` names
      a route the filesystem does not have.
- [x] **Swipe to page between racks**, having first left it out over the
      crash. The thing that killed the process on the field phone was a
      detector *per cell* — forty of them, each driving its own worklets. This
      is one, raced against the drag's one, and the count does not grow with
      the wall. The race has a clear winner rather than being a coin toss
      because the two are recognised by different evidence: the drag wants a
      400 ms hold that has not moved, the swipe wants 24pt of travel that has
      not waited. It is also unambiguous inside the panel in a way it would
      not have been before v3 — shelves no longer scroll sideways, so
      horizontal travel over the wall means exactly one thing, and
      `failOffsetY` hands anything steeper to the panel's own scroll. The
      panel follows the finger at 0.55x to 90pt, commits at 60pt or a flick,
      and barely gives at the ends of the wall so it answers "nothing that
      way" instead of promising a rack. Thresholds live in `rackSwipe.ts` as
      plain worklets so they are testable without a device; the hook is the
      gesture and nothing else.
- [x] **The scrubber rebuilt to share its width instead of queueing for it.**
      The design's strip is a flex row — `flex:1 1 0; min-width:40px` per
      rack, `flex:2 1 auto; min-width:132px` for the one you are on,
      `flex:none` for "+ RACK" — so the whole wall is on screen at a glance,
      which is the only reason to draw a wall-length strip. Mine gave every
      segment its natural width in a scroller, which is what made the wall run
      off the end at three racks and forced "+ RACK" outside it. The button is
      back inline where the design has it, and the strip scrolls only as the
      escape hatch `overflow-x:auto` is there: `flexGrow` on the content
      container lets it stretch to the strip when it fits. On a long wall it
      keeps the rack you are on in view, and while editing it keeps the button
      with it, so adding a rack never leaves you looking at the rack you just
      made and no way back to make another.
- [x] Verified live again for both: swipe pages the wall in each direction,
      refuses at both ends with the damped give, ignores a 33pt nudge and a
      vertical drag, and — the regression that mattered — a 400 ms hold still
      lifts a bin, arms the shelves and lands the §8.5 confirm, so racing the
      two gestures did not cost the drag. "+ RACK" adds a rack, pages to it,
      and stays on screen while it does.
- [x] **A coverage audit before merge**, rather than a count of tests. Four
      things this branch introduced were carrying real risk and no assertions,
      and each is now covered and mutation-checked:
      **`useMapDrag` (21% → 85%, 2% → 70% of branches).** The file the
      lift-and-place regression lived in. Its gesture callbacks are now played
      directly against measurements the screen would have reported — finger
      down, moved or not, finger up — so "a hold that never travelled is a
      lift" is asserted rather than remembered. Deleting that guard turns two
      tests red; so does setting the slop to zero, and so does letting a
      dismounted rail keep its frame.
      **`useRackEdit` (55% → 95%).** Taking a rack off the wall is the one
      operation here that deletes a row someone's inventory is filed against,
      it sits behind a native `Alert` the screen test cannot reach, and it had
      no test at all. Both confirm branches are now driven, including the §11
      guarantee that the bins land in the tray and the tray opens to show them.
      **Migration 011's backfill.** An existing workshop has no wall order to
      preserve, so the backfill has to reproduce the alphabetical one it was
      already being drawn in — otherwise someone who has walked the same wall
      for months opens the app after an update and finds it rearranged, with
      no undo and no record of the old order. Backfilling by insertion order
      instead, or numbering shelves across the wall rather than within a rack,
      now fails.
      **The slot geometry and `scannedAgo` (both 0% → 100%).** `slotMidlines`
      is what the drag hit-tests against: drawing cards centred while
      computing midlines flush left would land every drop one slot off and
      look perfectly correct in a snapshot.
- [ ] Confirmed on the field-test phone that paging, the rails, the swipe and
      the tray behave with gloves on. The swipe is the new unknown here: it is
      the first thing on this screen a mitten can trigger by accident.
- [ ] **Blueprint §4 needs `locations.sort_order` and `shelves.sort_order`
      added to the schema listing, and D21 needs a line about racks.** Both
      are `blueprint:` commits and are deliberately not made here.

## Diagnostics gaps found while field-testing the map

### Tasks
- [x] `Copy log`: the diagnostics zip needs a share target willing to take a
      100 MB file, so it fails exactly when it is needed. Text to the
      clipboard always works. Carries build, counts, memory, every crash and
      the event tail — never the inventory, never photos.
- [x] Export fix: `File.bytes()` returns a promise and JSZip accepts one, so
      photos were read at `generateAsync` time, after the native handle was
      released. `bytesSync` reads them there and then.
- [x] `detectAbnormalExit`: a native crash never reaches the JS error handler,
      so Diagnostics reported "0 crashes" throughout a crash loop. A session
      whose last event was not `app_background` did not exit, it died — and is
      recorded as a crash naming the last screen.

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
