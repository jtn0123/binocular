# Backlog — parked ideas (post-v1)

Ideas that came up but are deliberately **not** in v1 scope (see blueprint
§1 non-goals). New ideas land here instead of expanding a stage mid-build.

> On-device recognition was promoted from this list into v1 scope
> (blueprint D10, roadmap Stage 5).

- **Self-consistency voting** — run the same photo through the model twice
  and flag items appearing in only one response; revisit only if the
  confidence rubric proves unreliable in real use (blueprint §6.3).
- **Multi-user / household sync** — schema is sync-ready (uuids, ISO
  timestamps); needs a backend + auth story.
- **API key proxy server** — required before distributing the app to anyone
  else (blueprint Q1).
- **Fine-tuning dataset** — user corrections on the review screen are
  already stored (raw_response vs confirmed items); export pipeline for
  training a custom model someday.
- **Shopping-list integration** — low-stock items → grocery/hardware list.
- **Voice search** — "where are my zip ties" hands-free in the shop.
- **Web viewer** — read-only browse/search from a desktop browser.

## Long-term — only after v1 is fully polished

Explicitly deferred until every roadmap stage has shipped **and** been
polished in daily use. Do not pull these forward.

- **Multi-photo / short-video scans** — deep bins need a second angle. The
  provider interface already takes a photo array (blueprint D11), so this
  is additive: schema gains a scan-photos table via a new migration, the
  capture UI gains a shutter loop.
- **Receipt intake** — photograph a hardware-store receipt as a check-in
  source (a new recognition mode).
- **Item value / insurance export** — optional value field on items plus a
  formatted insurance report export.
- **Bin fullness estimate** — structured "how full is this bin" signal for
  "where do I have space?"; extends the vision contract.
- **Stale-bin nudges** — Home surfaces bins not audited in N months
  (`last_scanned_at` already exists).

## Image-processing ideas (classical CV / OCR — surfaced 2026-07-22)

Not vision *recognition* (that stays with the LLM/ML Kit engines) but
pre/post-processing around it:

- **Capture quality gate** — a blur/darkness check (Laplacian variance) on
  the shot BEFORE a paid cloud call: "too blurry — retake" saves the API
  spend on an unreadable photo. Cheap, classical, high-value. Doable with a
  light native shader or `expo-image-manipulator`; full OpenCV is overkill.
- **Pre-processing for accuracy + cost** — auto-crop to the bin, deskew,
  contrast-boost dim garage shots. Better recall and smaller uploads. Next
  tier above the current resize/compress pipeline.
- **On-device OCR for the local engine** — ML Kit Text Recognition would let
  `localProvider` read `label_text` (it currently returns generic names with
  brand/label null, D10). Closes the biggest local-engine capability gap
  without a cloud call. Different from OpenCV; same "optical" neighborhood.
- **Do NOT bundle full OpenCV into the RN app** — heavy native dependency;
  the basics are already covered by `expo-image-manipulator`.
