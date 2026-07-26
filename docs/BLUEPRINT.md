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
| D16 | Diagnostics | A local, always-on but **bounded** event log (`events` table, 5,000 entries / 30 days) records app lifecycle, scan timings, queue retries, search, visual-memory recalls, and crashes; a global error handler captures otherwise-invisible crashes. Export is **user-initiated only** — no network telemetry, no third-party crash SDK. Disable-able in Settings | Field testing happens on a standalone build with no Metro console, so `__DEV__`-gated logging would record nothing exactly when it is needed. Bounded + local + opt-out keeps it honest with offline-first (I4) and the privacy stance: the workshop photos and usage history never leave the device unless the user shares them |
| D17 | Deleted items | Deleting an item moves a full snapshot into a `deleted_items` table (migration 005): instantly undoable via snackbar, restorable for 30 days from a Recently-deleted screen, purged on boot after that. Live-item queries and the FTS index are untouched because deletion really deletes from `items` — the snapshot is a copy | Field testing showed early mis-tagged items need cleanup, but §11 forbids silent inventory loss. A copy-table beats a `deleted_at` flag: no query in the app needs a new WHERE clause, and search can never surface a ghost item |
| D20 | Visual memory | Every confirmed item photo is encoded to a vector (`item_embeddings`, migration 009); a new photo is matched by cosine similarity against them. It is a **memory, not a classifier** — it says "resembles your 10 mm socket", never "this is a socket", and it is *not* a `VisionProvider` (§5). The encoder is **downloaded on first use, never bundled**: the app is fully functional without it and the feature simply reports itself unavailable. Similarity is **never shown as a number** — results are an order, mapped to the §6.3 enum if a strength must be shown at all. That rule governs every surface that describes inventory (review, find-it, bins); the **diagnostics log and screen are exempt** (D16), because they exist to make the system's own behaviour legible and already show raw JSON and millisecond timings that appear nowhere else. Suggestions still pass through the review screen (D6) | The workshop is the training set the cloud does not have: the same bins, the same items, photographed by the same person. Nearest-neighbour over the user's own corrections needs no training, improves with use, and works in airplane mode — which is the only way §8.3's photo path can satisfy I4. Bundling the encoder would roughly double a 67 MB APK for a feature that is useless until items have been catalogued, so it is opt-in. The no-number rule is D5 applied to a new source: a cosine of 0.83 is exactly the kind of false precision the confidence enum exists to prevent. The diagnostics exemption is what makes the similarity threshold tunable at all — without the score of the *best rejected* candidate in the log, a shared bundle cannot distinguish "missed by a hair" from "nothing was close" from "no encoder loaded", and those need opposite fixes |
| D21 | Workshop map | A **schematic** map screen drawn from the hierarchy that already exists — a location's shelves are rows, its bins are the cells — and (amended 2026-07-25) an **organizing surface** as well: bins carry a stored order within their shelf (`bins.sort_order`), moving a bin on the map is a *real filing change* (the same `shelf_id` update as move mode §8.5, confirmed whenever it crosses shelves), and a shelf may declare an optional `capacity` so free slots draw as visible gaps a lifted bin can drop into. Searching or opening a bin highlights its cell — every matching cell at once when a search spans bins — cells can be tinted by item count or time-since-scan, and shelves are editable in place (add, rename, capacity, new bin). Bins with no shelf are drawn in an explicit "unshelved" row rather than hidden | The paper map a field tester was already keeping — a photo of the Packout stack, boxes lettered a–h, contents indexed beside it — is the artefact this replaces, and it says plainly that a list of names is not how anyone finds a box. Deriving the grid rather than storing coordinates means every existing workshop has a map the moment the screen ships, with no setup: the shelf *is* the row, which is already true in the data and usually true on the wall. The derived version proved the screen is worth opening, and the first thing real use asked for was the other half: the wall changes, and rearranging it on the picture is the natural gesture. The map still stores no second truth — moving a bin edits the same `shelf_id` every breadcrumb reads, and order and capacity are the only new facts. Map-only cosmetic coordinates were considered and rejected: a map that can drift from the filing answers "where is my X" with a lie. The longer-term idea — photograph the wall and overlay bins onto the image — stays out |
| D19 | Item tags | The tag vocabulary is **user-managed** (`tags` table, migration 008), not a fixed enum: add, rename and delete from a Settings screen. Items keep storing the tag as **text**, so search, CSV, backup and every existing query are untouched; a rename is one `UPDATE` inside the same transaction, and a delete reassigns its items to `other` rather than orphaning them. `other` cannot be deleted — it is the fallback the AI boundary and every failed lookup resolve to. The vision prompt and the OpenAI response schema are built from the live list | A fixed enum meant "electrical" was as far as the app could describe a bin of wire nuts, and a workshop's real categories are personal — a boat person needs `marine`, nobody else does. Storing text rather than a foreign key is what keeps the change cheap: the FTS index (migration 006), CSV export and the backup format all already carry `category` as a string and need no migration. The cost is accepted deliberately: the model can no longer be held to a closed list, which §6.1 resolves by validating slug *shape* strictly and mapping unknown *vocabulary* to `other` |
| D18 | Deferred review ("shoot and walk") | Capture may **enqueue** a scan and return straight to the camera instead of blocking on recognition; the scan lands in the normal `queued` → `review` pipeline and is reviewed later from the queue. Chosen per capture mode: `bin_audit` and `check_in` offer it, `find_it` never (its whole point is an answer now). The blocking path stays the default so a single scan still ends on the review screen | The §9 queue already does exactly this when offline, and the field test showed the online case has the same shape: walking a shelf means photographing six bins in a row, and standing still for each cloud round trip breaks the rhythm. Deferring is a *routing* change, not a new pipeline — every §11 invariant is untouched, D6 most of all: queued scans still reach inventory only through the review screen |
| D15 | Cost transparency | Cloud scans record measured token usage (each API's `usage` field) plus a computed dollar cost per scan; the app shows a pre-scan estimate and cumulative spend in Settings. Estimates use documented tokenizer math (OpenAI 32px patches, Claude ≈px²/750) with a bundled price table; uploads stay capped at 1568px and the OpenAI request pins an explicit `detail` level as a cost ceiling | Same honesty rule as D5: usage is measured, never guessed. On `gpt-5.6`, `detail: auto` means *no auto-downscaling* — a 20MP original would cost ~10× the 1568px upload — so image sizing is a cost policy, not just bandwidth |

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
  created_at TEXT NOT NULL,
  capacity INTEGER               -- D21: optional slot count; NULL = unsized
);

CREATE TABLE bins (
  id TEXT PRIMARY KEY,
  shelf_id TEXT REFERENCES shelves(id),   -- nullable: bins can be unassigned
  short_code TEXT NOT NULL UNIQUE,        -- "B-012", printed on the label
  name TEXT NOT NULL,                     -- "Electrical connectors"
  cover_photo_uri TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0   -- D21: position within its shelf
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
  resolved_at TEXT,
  engine TEXT,                            -- D15: which engine ran this scan
  input_tokens INTEGER,                   -- D15: measured usage, never estimated
  output_tokens INTEGER,
  cost_usd REAL
);

-- D16: local diagnostics. Bounded (5,000 rows / 30 days) and pruned on boot.
-- No FK on scan_id: events must outlive the scans they describe.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- 'app' | 'screen' | 'scan' | 'queue'
                                          -- | 'search' | 'net' | 'crash' | 'settings'
                                          -- | 'memory' (D20 visual memory)
  name TEXT NOT NULL,                     -- e.g. 'scan_settled'
  detail TEXT,                            -- JSON blob; never API keys
  duration_ms INTEGER,
  scan_id TEXT,                           -- correlation only, not a foreign key
  created_at TEXT NOT NULL
);

-- D17: recently-deleted safety net. Deleting an item snapshots the full row
-- here (a copy, so every live-item query and the FTS index stay untouched),
-- restorable from a Recently-deleted screen; purged after 30 days on boot.
-- Extends the §11 no-silent-deletion invariant beyond the undo snackbar.
CREATE TABLE deleted_items (
  id TEXT PRIMARY KEY,                    -- the item's original id
  bin_id TEXT,                           -- original bin (may since be gone)
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  label_text TEXT,
  photo_uri TEXT,
  notes TEXT,
  low_stock_threshold INTEGER,
  source_scan_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);

-- D19: the user-managed tag vocabulary. Items reference a tag by its slug
-- (items.category), not by id, so renaming rewrites those rows in the same
-- transaction and nothing else in the schema has to know about tags.
-- D20 visual memory: one fingerprint per item photo, so a new photo can be
-- matched against what this workshop already contains. Derived data — an
-- item is never harmed by losing its row, and a changed model invalidates
-- rows by `model` rather than needing a migration.
CREATE TABLE item_embeddings (
  item_id TEXT PRIMARY KEY REFERENCES items(id),
  vector BLOB NOT NULL,                   -- Float32Array bytes, little-endian
  dims INTEGER NOT NULL,
  model TEXT NOT NULL,                    -- which encoder produced it
  created_at TEXT NOT NULL
);

CREATE TABLE tags (
  slug TEXT PRIMARY KEY,                  -- 'electrical'; matches §6.1 shape
  label TEXT NOT NULL,                    -- 'Electrical', shown in the UI
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE item_search USING fts5(
  name, brand, label_text, notes, category, content='items',
  content_rowid='rowid'                   -- category added by migration 006
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

/** Token usage measured by the API's `usage` field — never estimated (D15). */
export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;            // model ID that produced the measurement
}

export interface RecognitionOutcome {
  result: RecognitionResult;
  usage?: VisionUsage;       // absent on free engines (fixture, local)
}

export interface VisionProvider {
  /**
   * Resolves with a validated RecognitionResult (plus measured usage for
   * cloud engines, D15) or throws VisionError. v1 always sends exactly one
   * photo (D11); the array type keeps multi-photo/video additive later.
   */
  recognize(photosBase64: string[], ctx: ScanContext): Promise<RecognitionOutcome>;
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

**Visual memory is deliberately NOT a provider (D20).** It answers a
different question — "which of *my* items does this resemble?" rather than
"what is this?" — so it is retrieval over the user's own confirmed items, not
recognition, and it never implements `VisionProvider`. It has no vocabulary,
cannot name a thing it has not been shown, and produces *suggestions* that
sit beside a recognition result rather than replacing one. Keeping it outside
the provider abstraction is what stops the §6.1 contract from having to
describe something that is not a model output.

**What it encodes.** An item's own photo where it has one — but §8.1 stamps
a capture onto the *bin* cover and leaves detected items with `photo_uri`
NULL, so a workshop catalogued by scanning has none. The photo an item was
recognised *from* (`items.source_scan_id`) is therefore the fallback, which
also means the memory fills in retroactively rather than needing every item
re-shot. That image is used for encoding only and never written back to
`items.photo_uri`: a shot of a whole bin is not a photo *of* the socket, and
recording it as one would put a bin picture on the item row.

Its encoder is a CLIP image model (int8, ExecuTorch) confined to
`src/vision/executorchEmbedder.ts` — the same import boundary the providers
obey. Everything else in the app talks to the `Embedder` interface, which is
why the feature is fully testable with a fake and why the app is complete
without it. The weights are **downloaded from Settings, never bundled and
never fetched by a launch**: app start may only re-activate weights that are
already on the device, so a cold start in a workshop with no signal behaves
exactly as it did before the feature existed (I4).

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
  // A tag *slug*, not a fixed enum (D19). Shape is validated strictly here;
  // the value is then resolved against the user's tag vocabulary, and
  // anything unrecognised becomes 'other'.
  category: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
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

**Tag resolution (D19).** `category` is the one field whose valid values the
*user* controls, so the boundary splits in two: **shape** is validated by zod
above and a malformed slug still fails the whole response, but **vocabulary**
is resolved afterwards against the `tags` table, with an unknown tag mapped
to `other`. Rejecting an otherwise-good scan of forty items because the model
named a tag the user deleted last week would be the wrong trade — and unlike
the shape rule, the vocabulary is not a contract the model can be held to,
because it changes underneath it. The resolution is not silent: the review
screen shows the tag it landed on, and the user can change it before saving,
so D6 still decides what reaches inventory.

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
- category: exactly one of: {the current tag vocabulary, listed from the
  tags table at prompt-build time — D19}. The list always contains `other`,
  which is the fallback when nothing fits.
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
4. **The table above is per-chip; a scan is also judged as a whole.** When a
   scan returns **no `high`-confidence item at all**, the engine did not
   really identify anything, and the review screen must not present a list of
   accepted items: nothing is pre-selected, and the manual editor opens
   straight away with the photo attached. The per-chip mapping still governs
   every scan that identified *something*.

   This exists because the on-device engine is capped at `medium` by the §5
   capability note, so without it every generic label it produces — "Drill",
   "Metal", "Tool" — arrives pre-selected and has to be individually undone.
   Field testing found that the common local-engine outcome was therefore a
   list of plausible-looking junk presented as a decision already made, which
   is the opposite of what D6 is for.

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
   (`processing`), then review screen opens (`review`). Per D18 the capture
   screen may instead **stay on the camera** and let the scan drain through
   the queue, for photographing a run of bins in one pass; the review screen
   is then reached from the queue rather than automatically.
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
- [ ] Deferred review (D18): several bins photographed back-to-back all
      arrive in the queue, each reviewable in turn, and none reaches
      inventory without its own review-screen save.

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
   notes/**category** (the UI calls it Tag, so it must be searchable),
   results show item -> bin -> shelf -> location breadcrumb + bin cover
   photo. A query that matches nothing is retried once against the closest
   spellings **already in the index** (`fts5vocab`), and the UI says which
   spelling it fell back to — never a silent substitution, and never a
   bundled dictionary.
2. **Photo path:** photograph the item; recognition returns its best
   identification; app runs that name/label through the same search and shows
   matching bins. **Offline (D20):** where a recognition result is
   unavailable, visual memory ranks the user's own items by resemblance
   instead, so the photo path degrades to "which of mine looks like this?"
   rather than to nothing.

**AC**
- [ ] Text search returns in <100ms on 1,000 items, fully offline.
- [ ] Fuzzy-ish behavior: prefix matching ("scre" finds screwdrivers) via FTS5
      prefix queries.
- [ ] A misspelling ("screwdrver") still finds the item, with the substituted
      spelling shown; a word the workshop genuinely lacks still reports
      nothing rather than inventing a match.
- [ ] The near-miss pass runs only after an exact search returns nothing, so
      the <100ms AC above is unaffected.
- [ ] Photo path degrades gracefully offline: with visual memory available it
      returns resembling items from this workshop; without it (no model
      downloaded, or nothing catalogued yet) it says so and points at text
      search — never a blank screen.
- [ ] Visual memory never names an item it has not been shown. An object with
      no resembling catalogued item returns no suggestions rather than the
      least-bad one.

### 8.4 Checkout / return (stage 6)

Long-press an item -> "Check out to…" (free-text name). Item shows a badge
and surfaces in a "Checked out" list. Return = one tap.

### 8.5 Move mode ("this bin lives there now")

1. Scan the bin's QR (or open bin detail) -> **Move**.
2. Scan the destination shelf's QR (or pick a shelf from the browse list —
   QR is never the only path).
3. Confirm -> bin's `shelf_id` updates; breadcrumbs everywhere reflect it.

The workshop map (D21) is another front door to the same operation: lift a
bin on the map, drop it on another shelf, confirm — the identical `shelf_id`
update, no separate pipeline.

**AC**
- [ ] Two scans + one confirm, start to finish.
- [ ] Fully offline (no recognition involved).
- [ ] Scanning a *location* QR in step 2 prompts to pick a shelf within it.
- [ ] Dropping a bin on another shelf on the map runs the same confirm and
      the same `shelf_id` update as the QR path.

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
   mapping. Grep for `%` near confidence code if unsure. The sole exemption
   is the diagnostics log and screen (D16/D20), where a raw similarity may be
   recorded and shown; it must never reach a screen that describes inventory.
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
