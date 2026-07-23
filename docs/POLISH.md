# Polish plan — post-stage passes (living doc)

The staged roadmap (blueprint §10) is built through Stage 6; this doc tracks
the *polish* passes agreed after that. It is subordinate to the blueprint:
anything here that changes scope graduates via a `blueprint:` commit first
(D15 did). Reorder/edit freely as priorities shift — this is a working list,
not law.

## Pass order

- [x] **0. Cost & image estimation (D15 — shipped)** — measured token
  usage + dollar cost per scan (migration 003), pre-scan estimate on the
  capture overlay + Settings, Cloud-spend totals in Settings, explicit
  OpenAI `detail: high` cap. See §Cost notes below.
- [ ] **1. Flush & validation pass** — walk every screen/flow on the fixture
  engine in the emulator; punch-list every rough edge; fix; backfill tests
  where gaps appear.
  - Round 1 (2026-07-22) done: trust-boundary fuzz (FTS operators, CSV
    formula injection → fixed, QR garbage → parser now trims, import
    manifest → now fully zod-validated per D9, negative quantity → clamped)
    plus live walk (search fuzz, spend UI, local-engine e2e, migration 003
    upgrade on a real db, garbage deep links). Fixed: unhandled promise
    rejection when the haptics native module is absent (`src/lib/haptics.ts`
    best-effort wrappers). Open punch list: search doesn't match bin
    codes/names (items only) — worth adding (shipped, see round 2); camera
    preview renders black in emulator screenshots (verify on hardware); dev
    client predates expo-haptics — next `expo run:android` picks it up.
  - Round 2 (2026-07-22): emulator's back camera captures pure black frames
    on this host in BOTH `emulated` and `virtualscene` modes (config.ini +
    `-camera-back virtualscene` both tried; Apple-Silicon GL quirk) — this
    explains every generic Sky/Monochrome ML Kit label to date.
    `scripts/devtest/inject-camera-image.sh` swaps ground-truth photos onto
    the virtual-scene wall and will work on a host with a functioning
    virtual scene; until then, real-image capture testing needs hardware.
  - Round 3 (2026-07-22): chaos/torture. Finding — a Metro-connected DEV
    CLIENT can't be tested for kill-while-offline: airplane mode drops the
    Metro socket and the bundle can't reload. That path needs a standalone
    build. Automatable core moved into `src/queue/__tests__/chaos.test.ts`
    (flapping connectivity never loses/double-processes; kill+reboot
    recovery; settled scans never reprocessed). `scripts/devtest/chaos.sh`
    keeps the on-device confirmation, now asserting against the app's own
    SQLite (ground truth) instead of screen-scraping.
  - Round 4 (2026-07-22): adb monkey. Touch-only run (8,000 events, no
    keycodes) survived clean — app stayed resumed, and random taps that
    reached the delete-bin flow were correctly blocked by the "Bin not
    empty — inventory is never deleted" guard (the §11 no-silent-deletion
    invariant, verified under chaos). The ONLY crash was a monkey run that
    included hardware keycodes: `NullPointerException` in
    `com.facebook.react.ReactActivityDelegate.onKeyDown` while the dev
    launcher (not our bundle) was foreground — RN framework code, our app
    has no custom key handling, and it needs a hardware keyboard during the
    launcher window. Not an app bug; recorded for completeness. Monkey the
    app touch-only (`--pct-anyevent 0 --pct-syskeys 0`).
- [~] **2. UI/UX quality pass** — empty/loading states, keyboard behavior,
  truncation, contrast, a11y labels, animation polish.
  - Accessibility sweep (2026-07-22): audited every Pressable. Icon-only
    controls already labeled (settings gear, browse edit/print/delete,
    capture shutter, search clear). Added `accessibilityRole="button"` +
    composed `accessibilityLabel`s to the navigation rows that previously
    only read their text: Home bin cards, search result rows, checked-out
    / low-stock status rows + their action button, bin-code search hits,
    and the four Scan mode cards. Amber-on-graphite already clears WCAG AA.
- [ ] **3. Visual identity** — Binocular icon + splash candidates, user
  picks, wire in (replaces Expo template art).
- [ ] **4. Capture upgrades** — torch toggle, tap-to-focus, pinch-zoom in
  `app/capture.tsx`.
- [ ] **5. Recognition-quality groundwork** — ground-truth eval harness
  (labeled photo set, mechanical precision/recall scoring), prototype
  self-consistency voting. No API key needed to build it.
- [ ] **6. Key day** — user types their OpenAI key into Settings (emulator
  window, never through the agent); run the eval; compare `gpt-5.6` tiers
  (Sol/Terra/Luna) on accuracy-per-dollar; iterate prompt against measured
  scores; record real per-scan costs. **Resolution A/B:** same labeled bins
  at 1568px / 2048px / full-res (`original` detail, OpenAI only — Claude
  resizes server-side past 1568) scoring `label_text` recall per dollar;
  compare against the close-up-photo pattern before adding a res tier.

## Cost notes (researched July 2026 — re-verify on key day)

- **OpenAI image tokens** = `ceil(w/32) × ceil(h/32)` patches. On `gpt-5.6`,
  `detail: auto` behaves like `original`: *no automatic downscaling*. Our
  1568×~1176 upload ≈ 1.8k tokens; a raw 20MP phone photo ≈ 19.5k tokens
  (~10×). `detail: low` = fixed 512px thumbnail (cheap pre-pass option).
- **Claude image tokens** ≈ `(w × h) / 750`; images over 1568px long edge
  are auto-resized server-side. 1568px upload ≈ 2.5k tokens.
- **Prices per 1M input/output tokens (July 2026):** OpenAI gpt-5.6 Sol
  $5/$30, Terra $2.50/$15, Luna $1/$6; gpt-5.5 $5/$30. Anthropic Opus 4.8
  $5/$25; Sonnet 5 intro $2/$10 (→ $3/$15 after 2026-09-01).
- **Typical full-scan cost** (1568px photo + prompt + JSON reply ≈ 2.3–3k in,
  ~0.7k out): roughly 3.3¢ Sol / 1.6¢ Terra / 0.7¢ Luna / 3.2¢ Opus 4.8.
- Estimates are estimates; the `usage` field on each API response is the
  source of truth and is what the app records (D15/D5 honesty rule).

## Image resource-saving ideas (brainstormed, not yet scoped)

- **Quality tiers in Settings** — Fine (1568px) / Standard (1024px) /
  Saver (768px) upload cap; show the cost estimate next to each choice.
- **Per-mode resolution** — `find_it` needs less detail than `bin_audit`
  (which must read tiny label text); could default lower.
- **`detail: low` pre-pass** — cheap 512px first look; only escalate to full
  resolution when the cheap pass finds packaged goods/text worth reading.
- **WebP uploads** — both APIs accept WebP; ~30% smaller payloads at equal
  quality (bandwidth win; token cost is resolution-driven, unchanged).
- **Skip re-encode when already small** — camera captures below the cap
  shouldn't pay a decode/encode round-trip.
- **EXIF strip** — privacy + payload; verify expo-image-manipulator output.
- **Wi-Fi-aware uploads** — queue full-res on cellular, or drop a tier.
- **Model-tier auto-pick** — Luna for find_it, Terra/Sol for audits of
  label-dense bins (decide with eval data, not vibes).

## Parked context

- Video scans: no native video input on OpenAI/Anthropic APIs (July 2026);
  Gemini has it natively. Honest path when unparked: frame sampling into the
  existing `photosBase64` array (D11) — no new engine required.
- Verbalized model confidence (e.g. "0.72") is confabulated per calibration
  research — the D5/§6.3 enum stands. Real accuracy comes from the eval
  harness (pass 5); real per-scan spend from `usage` (D15).

## Eval corpus (pass 5 groundwork — 2026-07-22)

`eval/corpus/` holds 22 CC-licensed workshop photos harvested from Wikimedia
Commons and curated in three passes: (1) generator-query harvest of 111
candidates across 14 categories; (2) automated cull — PIL perceptual-hash
dedup + blur/brightness scoring dropped 18 unusable/duplicate frames and
balanced by scenario; (3) human visual review down to 22 across six buckets
(mixed-bin, small-parts, single-item, tool-set, paint, dim). `corpus.json`
carries per-image scenario, content hint, and CC attribution;
`LICENSES.md` is the credit list. Next: hand-write ground-truth item lists
into `labels.json` so `npm run eval` scores real recall/precision per engine.

## Image bank (2026-07-22)

`eval/bank/` is a growing, deduplicated bank of **213 CC-licensed workshop
images** (Wikimedia Commons, 3 harvests, ~40 categories), for testing and as
the seed dataset for a future custom local detector (see BACKLOG). Perceptual-
hash dedup runs across every harvest so it grows without dupes; scenarios:
single-tool 90, mixed-bin 45, dense-small-parts 42, sets-accessories 20,
consumables 16. `bank.json` records per-image scenario, category, CC license,
attribution, source URL, hash, and quality scores; `LICENSES.md` credits each.
The images themselves are **gitignored** (30 MB doesn't belong in git);
`scripts/devtest/fetch-bank.sh` rebuilds them from the manifest after a clone.
To grow it: re-run the harvest scripts → `bank.py` → commit the updated
manifest. Distinct from `eval/corpus/` (the small hand-labeled eval set).
