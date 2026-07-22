# Binocular — Workshop Inventory App Blueprint

> **This file is the source of truth.** Any coding agent (or human) working on
> Binocular reads this document before starting a task and validates finished work
> against it. If a requested change conflicts with this blueprint, stop and
> surface the conflict instead of silently diverging. Changes to this file are
> deliberate, reviewed edits — commit them separately with the prefix
> `blueprint:` so the decision history stays visible.

---

## 1. Vision

A phone-first app for a home workshop: point the camera at a bin (or at items
on the bench) and the app figures out what's there, files it under the right
bin/shelf/location, and later answers "where is my 10mm socket?" in two taps.

**The magic moment:** open a cluttered bin, take one photo, and get an
editable, mostly-correct inventory list in under ten seconds.

**The daily-driver feature:** search. Recognition is how data gets *in*;
search is why the app gets *opened*.

### Non-goals (v1)

- No multi-user accounts, sharing, or cloud sync (schema stays sync-ready,
  but v1 is single-user, local-only).
- No custom on-device ML model training.
- No shopping-list / purchasing integration.
- No web app. Mobile only.

---

## 2. Decision log

Decisions already made. Don't re-litigate these mid-task; propose changes as
blueprint edits instead.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Framework | React Native + Expo (managed workflow), TypeScript strict | One codebase, Android-first with a clean iOS port later; Expo covers camera, SQLite, file system, printing |
| D2 | Recognition engine | Cloud vision LLM (Anthropic Claude, vision-capable model) behind a provider abstraction | Far better on cluttered real-world bins than generic on-device models; pennies per scan; abstraction keeps the door open for on-device/hybrid later |
| D3 | Bin identity | Printed QR labels on every bin | Visually distinguishing 20 identical bins is unreliable; a QR scan is instant, offline, and 100% accurate |
| D4 | Storage | SQLite via `expo-sqlite`, offline-first, FTS5 for search | Garages have bad Wi-Fi; browsing/search must never require network |
| D5 | Confidence model | Categorical enum (`high` / `medium` / `low`) with a written rubric — **never numeric percentages** | Cloud LLMs don't produce calibrated probabilities; a fake "87%" is worse than an honest category. See §6.3 |
| D6 | AI output handling | Every recognition result goes through a user review screen before touching inventory tables | Trust is earned; silent AI writes destroy it. Also produces a corrected dataset for future fine-tuning |
| D7 | Barcode/label OCR | On-device via Expo/ML Kit where trivial (QR, barcodes); text-on-labels is read by the vision LLM as part of the scan | Avoid maintaining a second recognition pipeline in v1 |
| D8 | Navigation | `expo-router` (file-based) | Convention over configuration; matches Expo defaults |
| D9 | Validation | `zod` at every trust boundary (AI responses, QR payloads, imports) | Malformed AI JSON must fail loudly at the boundary, not deep in the UI |
| D10 | Local recognition engine | On-device image labeling (ML Kit / TF Lite, see Q4) ships in v1 as `localProvider`, selectable alongside Claude | Offline recognition at zero marginal cost; D2's rationale stands for the hard stuff — local returns generic names only (capability note in §5) |
| D11 | Photos per scan | Exactly one still image in v1; `VisionProvider.recognize` takes a photo *array* so multi-photo/video is additive later | Start small; the array type costs nothing now, while an interface change later would churn every provider |
| D12 | Export | CSV export of all items (Excel-compatible) ships in v1 | The whole inventory belongs in a spreadsheet too; one row per item with location/shelf/bin breadcrumb columns |
| D13 | QR payload | Typed: `binoc:v1:<type>:<uuid>`, type ∈ `bin \| shelf \| location` | Shelf/location labels enable move mode (§8.5); typing the payload costs nothing before any label is printed |
| D14 | Cloud engines | Two cloud engines ship in v1 — Anthropic Claude and OpenAI — behind the same `VisionProvider` contract, each isolated in its own provider file with its own API key in Settings | User choice on cost/quality/account; the §6.1 schema and §6.2 prompt are engine-neutral, so a second cloud engine is pure provider code |

---

## 3. Architecture overview

```
app/                    # expo-router screens
  (tabs)/
    index.tsx           # Home: search bar + recent bins
    scan.tsx            # Camera entry point (mode picker)
    browse.tsx          # Location > Shelf > Bin tree
  bin/[id].tsx          # Bin detail: contents, cover photo, history
  review/[scanId].tsx   # Recognition review (chips UI)
src/
  db/
    schema.ts           # migrations (append-only)
    queries.ts          # typed query helpers
  vision/
    types.ts            # RecognitionResult, zod schemas
    provider.ts         # VisionProvider interface
    claudeProvider.ts   # the ONLY file that imports/knows the Anthropic API
    openaiProvider.ts   # the ONLY file that knows the OpenAI API (raw fetch)
    localProvider.ts    # on-device labeling (ML Kit / TF Lite); offline engine
    fixtureProvider.ts  # returns canned JSON; used in dev & tests
  queue/
    scanQueue.ts        # offline photo queue (backed by the scans table)
  qr/
    payload.ts          # QR encode/parse + zod schema
    labels.ts           # printable PDF label sheet
  search/
    fts.ts              # FTS5 index maintenance + query helpers
```

**Hard boundary rules**

- Nothing outside `src/vision/claudeProvider.ts` may import the Anthropic
  SDK or reference its API shapes. Likewise, the OpenAI API surface lives
  only in `src/vision/openaiProvider.ts` and on-device ML imports only in
  `src/vision/localProvider.ts`.
- Nothing outside `src/db/` writes raw SQL.
- Screens never call the vision provider directly — they enqueue a scan and
  navigate to the review screen when it resolves.

---

## 4. Data model

Hierarchy: **Location → Shelf → Bin → Item.** Scans are first-class records:
they double as the offline queue and the audit trail of what the AI said
versus what the user confirmed.

```sql
CREATE TABLE locations (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT NOT NULL,            -- "Garage"
  created_at TEXT NOT NULL
);

CREATE TABLE shelves (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,            -- "Shelf B"
  created_at TEXT NOT NULL
);

CREATE TABLE bins (
  id TEXT PRIMARY KEY,
  shelf_id TEXT REFERENCES shelves(id),   -- nullable: bins can be unassigned
  short_code TEXT NOT NULL UNIQUE,        -- "B-012", printed on the label
  name TEXT NOT NULL,                     -- "Electrical connectors"
  cover_photo_uri TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  bin_id TEXT NOT NULL REFERENCES bins(id),
  name TEXT NOT NULL,                     -- "Cordless drill"
  brand TEXT,                             -- "DeWalt"
  category TEXT NOT NULL,                 -- controlled list, see §6.2
  quantity INTEGER NOT NULL DEFAULT 1,
  label_text TEXT,                        -- verbatim text read off packaging
  photo_uri TEXT,
  notes TEXT,
  checked_out_to TEXT,                    -- null = in its bin
  low_stock_threshold INTEGER,            -- null = not a consumable
  source_scan_id TEXT REFERENCES scans(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  bin_id TEXT REFERENCES bins(id),        -- null for check-in/find-it scans
  mode TEXT NOT NULL,                     -- 'bin_audit' | 'check_in' | 'find_it'
  photo_uri TEXT NOT NULL,
  status TEXT NOT NULL,                   -- 'queued' | 'processing' | 'review'
                                          -- | 'confirmed' | 'discarded' | 'failed'
  raw_response TEXT,                      -- exact JSON the provider returned
  error TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE VIRTUAL TABLE item_search USING fts5(
  name, brand, label_text, notes, content='items', content_rowid='rowid'
);
```

Migration rules: `schema.ts` holds an ordered array of migration SQL strings;
append-only, never edit a shipped migration. Every table keeps TEXT ISO-8601
timestamps (sync-ready, per non-goals note).

---

## 5. Recognition provider abstraction

```ts
// src/vision/provider.ts
export interface ScanContext {
  mode: 'bin_audit' | 'check_in' | 'find_it';
  binName?: string;          // hint only — the model may use it for context
  existingItems?: string[];  // bin_audit merge mode: names already in the bin
}

export interface VisionProvider {
  /**
   * Resolves with a validated RecognitionResult or throws VisionError.
   * v1 always sends exactly one photo (D11); the array type keeps
   * multi-photo/video additive later.
   */
  recognize(photosBase64: string[], ctx: ScanContext): Promise<RecognitionResult>;
}

export class VisionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'auth' | 'invalid_response' | 'rate_limit',
  ) { super(message); }
}
```

Four implementations ship in v1:

- **`fixtureProvider`** — returns canned fixture JSON keyed by mode, with an
  artificial delay. This is the default in development and the only provider
  used in automated tests. The entire app must be demo-able with it.
- **`localProvider`** — on-device image labeling (ML Kit / TF Lite; decide Q4
  first). Works fully offline at zero marginal cost. **Capability note:** it
  cannot read labels or brands — `brand` and `label_text` are always null,
  names are generic, and confidence follows the same §6.3 rubric (in practice
  `medium`/`low`). Same contract, same review screen, no special-casing.
- **`claudeProvider`** — cloud engine via the Anthropic API. Needs an
  Anthropic API key configured.
- **`openaiProvider`** — cloud engine via the OpenAI Responses API (D14),
  implemented with raw fetch — no SDK dependency. Needs an OpenAI API key
  configured. Same §6.2 prompt, same §6.1 schema enforced via strict
  structured outputs, same parse + one-repair-retry rule.

Engine selection: a Settings picker (fixture / local / claude / openai);
`EXPO_PUBLIC_VISION_PROVIDER` sets the build-time default. Switching engines
must not require an app restart.

---

## 6. AI vision contract

This section is the most load-bearing part of the blueprint. The prompt, the
schema, and the rubric below are the contract; change them only via a
`blueprint:` commit.

### 6.1 Response schema (zod)

```ts
// src/vision/types.ts
import { z } from 'zod';

export const Confidence = z.enum(['high', 'medium', 'low']);

export const DetectedItem = z.object({
  name: z.string().min(1),          // generic name: "Phillips screwdriver"
  brand: z.string().nullable(),     // only if legible in the photo
  category: z.enum([
    'hand_tool', 'power_tool', 'fastener', 'electrical', 'plumbing',
    'adhesive_finish', 'safety', 'measuring', 'bit_blade_accessory',
    'hardware', 'material', 'other',
  ]),
  quantity: z.number().int().min(1),
  label_text: z.string().nullable(), // verbatim text read from packaging
  confidence: Confidence,
});

export const RecognitionResult = z.object({
  items: z.array(DetectedItem),
  scene_notes: z.string().nullable(), // e.g. "bin is very full; items overlap"
});
export type RecognitionResult = z.infer<typeof RecognitionResult>;
```

Parsing rule: `RecognitionResult.safeParse` the model output. On failure,
retry **once** with the validation errors appended to the prompt; if it fails
again, throw `VisionError('invalid_response')` and mark the scan `failed`.
Never "best-effort" a malformed response into the review screen.

### 6.2 The vision prompt (template)

```
You are an inventory assistant for a home workshop. Analyze the photo and
list every distinct item you can identify.

Rules:
- One entry per distinct item type. Identical items get one entry with a
  quantity (e.g. 3 identical screwdrivers -> quantity: 3).
- name: a short generic name a hardware store would use. No brand in name.
- brand: only if the brand is actually legible or unmistakable in the photo.
  Do not guess brands from color schemes. Otherwise null.
- label_text: if the item is packaged (box of screws, tube of adhesive),
  transcribe the key label text verbatim (product name, size, count).
  Otherwise null.
- category: exactly one of: hand_tool, power_tool, fastener, electrical,
  plumbing, adhesive_finish, safety, measuring, bit_blade_accessory,
  hardware, material, other.
- confidence — use exactly this rubric:
    high:   item type AND its identifying details (size/brand/label) are
            clearly visible and unambiguous.
    medium: item type is clear, but details are inferred, partially
            visible, or generic.
    low:    item is partially hidden, blurry, or you are pattern-guessing
            from shape/context.
- Do not invent items to seem thorough. If in doubt, include it at low
  confidence rather than omitting it — the user reviews every entry.
- scene_notes: one sentence of anything that limits accuracy (glare,
  overlap, closed containers), else null.

{{#if binName}}Context: this bin is labeled "{{binName}}".{{/if}}
{{#if existingItems}}Items previously recorded in this bin (the photo may
or may not still contain them): {{existingItems}}.{{/if}}

Respond with ONLY a JSON object matching:
{ "items": [{ "name", "brand", "category", "quantity", "label_text",
  "confidence" }], "scene_notes" }
```

### 6.3 Confidence: how it works and why

You were right to flag this: cloud LLMs do **not** emit calibrated
probabilities, and asking one for "87%" produces confident-sounding noise.
So Binocular never shows a percentage anywhere. Instead:

1. The model self-reports against the **written rubric** above — categorical
   judgments ("can I actually see the label?") are something LLMs do far more
   honestly than numeric estimates.
2. The UI maps the category to behavior, not a number:

   | Confidence | Review screen behavior |
   |------------|------------------------|
   | `high` | Chip pre-selected, plain style |
   | `medium` | Chip pre-selected, amber dot — worth a glance |
   | `low` | Chip **de-selected**; saving it requires an explicit tap |

3. Because the user confirms every scan (D6), confidence only tunes *default
   selection state* — it is never a gate that hides or auto-commits data.

Future option (explicitly out of scope for v1): self-consistency voting —
run the same photo twice and flag items that appear in only one response.
Costs 2x per scan; revisit only if rubric confidence proves unreliable in
real use.

### 6.4 Claude provider sketch

```ts
// src/vision/claudeProvider.ts — sole owner of the Anthropic API surface
import Anthropic from '@anthropic-ai/sdk';
import { RecognitionResult } from './types';
import { buildVisionPrompt } from './prompt';

const client = new Anthropic({ apiKey: getApiKey() });

export async function recognize(photosBase64: string[], ctx: ScanContext) {
  const msg = await client.messages.create({
    model: VISION_MODEL,        // single constant; check docs for the
                                // current recommended vision-capable model
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        ...photosBase64.map((data) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const,
                    data },
        })),
        { type: 'text', text: buildVisionPrompt(ctx) },
      ],
    }],
  });
  return parseAndValidate(msg); // safeParse + one repair retry, per §6.1
}
```

JSON reliability: prefer forcing the response through Claude's tool-use /
structured-output mechanism so the reply is schema-shaped by construction
instead of relying on "respond with ONLY JSON" prose. The §6.2 prompt text
remains the contract either way, and the §6.1 safeParse + one-retry rule
still applies.

Image handling: resize/compress to max 1568px long edge, JPEG ~q80 before
upload (smaller is faster and cheaper; beyond that resolution the model gains
nothing). Use `expo-image-manipulator`.

---

## 7. QR label spec

- Payload: `binoc:v1:<type>:<uuid>` with type ∈ `bin | shelf | location`
  (D13) — versioned, dumb, offline-parseable. Zod-validate on scan; reject
  anything else with a friendly error.
- `short_code` ("B-012") is printed **human-readable** next to the QR so bins
  are findable even without the app. The QR + text combo is deliberate:
  either alone must be enough to identify the bin.
- Label sheet: generate a PDF (via `expo-print`) laid out for Avery 5163-ish
  2"x4" sticker sheets, QR left, short code + bin name right, 10 per page.
- Shelf/location labels are optional and print through the same PDF flow
  (QR left, name right — no short code).
- Bulk flow: "Create N bins" -> auto-assigns short codes -> one PDF.

---

## 8. Core workflows

Each workflow lists steps then **acceptance criteria (AC)**. A workflow is
done only when every AC passes on an Android device/emulator.

### 8.1 Bin audit ("what's in this bin?")

1. From Scan tab, choose **Audit bin** (or just point at a QR — auto-detect).
2. Scan the bin's QR (or pick the bin manually from a list — QR must never be
   the only path).
3. Camera screen with a "fill the frame with the open bin" hint. Capture.
4. Scan row created (`status=queued`), photo saved locally, recognition runs
   (`processing`), then review screen opens (`review`).
5. Review screen: detected items as editable chips per §6.3. User can edit
   name/quantity/category inline, delete, or add-manually.
6. User picks **Replace contents** or **Merge with existing** (default:
   merge if bin has items, replace if empty). In Merge mode on a non-empty
   bin, chips are grouped **new / still here / not seen in this photo**; the
   "not seen" group defaults to *keep* — removing one of those items
   requires an explicit tap. Every audit doubles as a "what wandered off?"
   check without ever deleting silently.
7. Save -> items written, scan `confirmed`, bin's `last_scanned_at` and cover
   photo updated.

**AC**
- [ ] Airplane mode: capture succeeds, scan sits in `queued`, UI says so, and
      it auto-processes when connectivity returns.
- [ ] Killing the app mid-processing leaves a resumable `queued`/`processing`
      scan, not a lost photo.
- [ ] A `low` confidence item saved without user interaction is impossible.
- [ ] Merge on a non-empty bin shows the new / still-here / not-seen
      grouping, and an existing item is never removed without an explicit
      tap — a scan can never silently delete inventory.
- [ ] Discard leaves inventory tables untouched (scan `discarded`).
- [ ] Whole flow ≤ 4 taps between shutter and saved (excluding chip edits).

### 8.2 Check-in ("these go in that bin")

1. Lay items on the bench, photograph them (cleaner background = better
   results — the capture hint says so).
2. Same review-chips screen.
3. Pick destination bin (QR scan or list; recently-used bins first).
4. Save appends items to that bin.

**AC**
- [ ] Destination can be chosen *after* recognition (photo first, decide
      later).
- [ ] Multiple check-in scans can queue offline and be reviewed in sequence.

### 8.3 Find it ("where is my …?")

1. **Text path:** home-screen search box, FTS5 across name/brand/label_text/
   notes, results show item -> bin -> shelf -> location breadcrumb + bin
   cover photo.
2. **Photo path:** photograph the item; recognition returns its best
   identification; app runs that name/label through the same search and shows
   matching bins.

**AC**
- [ ] Text search returns in <100ms on 1,000 items, fully offline.
- [ ] Fuzzy-ish behavior: prefix matching ("scre" finds screwdrivers) via FTS5
      prefix queries.
- [ ] Photo path degrades gracefully offline: "search needs a connection for
      photo lookup — try text search."

### 8.4 Checkout / return (stage 6)

Long-press an item -> "Check out to…" (free-text name). Item shows a badge
and surfaces in a "Checked out" list. Return = one tap.

### 8.5 Move mode ("this bin lives there now")

1. Scan the bin's QR (or open bin detail) -> **Move**.
2. Scan the destination shelf's QR (or pick a shelf from the browse list —
   QR is never the only path).
3. Confirm -> bin's `shelf_id` updates; breadcrumbs everywhere reflect it.

**AC**
- [ ] Two scans + one confirm, start to finish.
- [ ] Fully offline (no recognition involved).
- [ ] Scanning a *location* QR in step 2 prompts to pick a shelf within it.

---

## 9. Offline queue

Backed entirely by the `scans` table — no separate queue store.

```ts
// src/queue/scanQueue.ts
// Invariants:
// 1. enqueue() writes photo to app storage + scans row in one transaction.
// 2. A single drain loop (started on app foreground + connectivity change)
//    picks oldest 'queued' scan, sets 'processing', calls the provider.
// 3. Success -> 'review' + notification-style badge on the Scan tab.
//    VisionError network/rate_limit -> back to 'queued' with capped
//    exponential backoff (30s, 2m, 10m, then manual retry button).
//    invalid_response/auth -> 'failed' with the error surfaced.
// 4. Photos for 'discarded'/'failed' scans older than 30 days are pruned.
```

---

## 10. Staged roadmap

Ship in this order. **Do not start a stage until the previous stage's AC and
manual test script pass.** Each stage ends with a commit tagged
`stage-N-complete`.

### Stage 0 — Skeleton
Expo + TypeScript strict + expo-router scaffold; tabs (Home/Scan/Browse);
SQLite migrations from §4 running on boot; fixture provider wired;
`npm run lint` + `npm test` (Jest) green in CI.
- **AC:** app boots on Android emulator; all tables exist; a seed script
  populates demo data; fixture recognition returns in the review screen.

### Stage 1 — Bin audit vertical slice
Workflow §8.1 end-to-end with the **fixture provider**, then flip on the real
Claude provider behind the env flag. Review-chips screen fully implemented
per §6.3, including the merge diff grouping (§8.1 step 6).
- **AC:** all §8.1 checkboxes, with both providers.
- **Manual test script:** create bin "Test" -> photograph a real bin ->
  verify ≥70% of visible items appear -> edit one chip, delete one, add one
  -> save -> reopen bin, contents match the confirmed list exactly.

### Stage 2 — Locations, shelves, QR labels
Browse tree CRUD; typed QR payloads (§7, all three types) + scanner
integration; bulk bin creation; PDF label sheet including optional
shelf/location labels; move mode (§8.5).
- **AC:** print a sheet, stick a label, cold-start the app, scan the QR ->
  bin detail opens in <2s.
- **AC:** move mode: bin re-homed with two scans + one confirm.

### Stage 3 — Search & check-in
FTS5 indexing (triggers keep `item_search` in sync); home search UI;
workflow §8.2; photo-path find-it (§8.3).
- **AC:** all §8.2 + §8.3 checkboxes.

### Stage 4 — Offline hardening
Queue semantics of §9 fully implemented; airplane-mode test pass across every
workflow; backoff + manual retry UI.
- **AC:** the §8.1 airplane-mode AC plus: 5 scans queued offline all resolve
  correctly after reconnect, in order, no duplicates.

### Stage 5 — Local recognition engine
`localProvider` per D10 (decide Q4 first); Settings engine picker
(fixture / local / claude); capability messaging in the UI ("local can't
read labels — use cloud for packaged goods"). Requires switching to an
`expo-dev-client` / EAS dev build (native ML module — no longer Expo Go).
- **AC:** airplane mode: a full bin audit completes end-to-end on the local
  engine; switching engines requires no restart; review screen behavior is
  identical across all three providers.

### Stage 6 — Daily-driver extras
Checkout/return (§8.4); low-stock flags for consumables; bin photo history
(every confirmed audit keeps its photo, viewable as a timeline); JSON+photos
export/backup to a zip via the share sheet; CSV export of all items (D12 —
one row per item, location/shelf/bin breadcrumb columns, share sheet).
- **AC:** export -> wipe app -> import restores an identical database.
- **AC:** CSV opens cleanly in Excel/Sheets with correct columns despite
  commas/quotes/newlines in item names.

### Stage 7 — iOS pass & polish
Run the full manual test suite on iOS; fix platform issues; haptics; empty
states; app icon.
- **AC:** every prior stage's manual test script passes on both platforms.

---

## 11. Invariants (the agent's checklist)

Before declaring any task done, verify:

1. **No silent AI writes** — inventory tables are only written from the
   review screen's save action or explicit manual CRUD.
2. **No percentages** — confidence appears only as the enum and its UI
   mapping. Grep for `%` near confidence code if unsure.
3. **Provider isolation** — Anthropic imports exist only in
   `claudeProvider.ts`, the OpenAI API surface only in `openaiProvider.ts`,
   on-device ML imports only in `localProvider.ts`; the app runs fully on
   the fixture provider.
4. **Offline-first** — every screen except live recognition works in
   airplane mode.
5. **Boundary validation** — every AI response and QR payload passes through
   zod before use.
6. **Migrations append-only.**
7. **TypeScript strict; no `any` at module boundaries.**
8. The relevant stage's AC checklist actually passes — run it, don't assume.

---

## 12. Open questions (decide before the relevant stage)

- **Q1 (before Stage 1):** API key handling — v1 ships as a personal-use app
  with the key entered in Settings and stored in `expo-secure-store`? Or a
  tiny proxy server so the key never lives on-device? Default assumption:
  Settings + secure-store for personal use; revisit before any distribution.
- **Q2 (before Stage 3):** how serious is quantity tracking for consumables —
  full counts ("23 deck screws left") or coarse ("plenty / low / out")?
  Affects check-in friction. Default assumption: coarse.
- **Q3 (before Stage 6):** photo retention budget — full-res audit history
  can eat storage; keep originals or store 1080p re-encodes? Default
  assumption: re-encodes.
- **Q4 (decided 2026-07-22):** local engine tech — **ML Kit image labeling
  with the bundled base model** (`@react-native-ml-kit/image-labeling`).
  Easiest native integration, works offline with no Play-services model
  download, and the D10 capability note already sets expectations (generic
  names, no brands/labels, confidence capped at `medium`). Revisit a
  bundled TF Lite model only if this fails the ≥70% bar in real use. The
  native module is loaded lazily so Expo Go keeps working for every other
  engine; the local engine activates in the dev build.
