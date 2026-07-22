# Binocular 🔭🗄️

**Point your camera at a bin and know what's inside.**

Binocular is a mobile app for home workshops: photograph a bin (or items on
your bench) and AI vision identifies the contents, files them under the right
bin → shelf → location, and later answers *"where is my 10mm socket?"* in two
taps.

- **React Native + Expo** (TypeScript, Android-first, iOS-ready)
- **AI vision, cloud or on-device** — Anthropic Claude for the hard stuff,
  a local engine for offline scans, selectable behind one provider
  abstraction
- **QR-labeled bins** (and optionally shelves) — print sticker sheets from
  the app; QR plus human-readable text on every label
- **Offline-first** — SQLite + FTS5 search; photos queue for recognition when
  connectivity returns
- **CSV export** — the whole inventory, one row per item, ready for
  Excel/Sheets

## Status

Planning — no code yet. The build is staged and spec-driven.

## Documentation

| Doc | Role |
|---|---|
| [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) | **Source of truth.** Vision, decision log, data model, AI vision contract, workflows with acceptance criteria, Stage 0–7 roadmap, invariants |
| [`docs/PLAN.md`](docs/PLAN.md) | Execution plan: file-level task checklists per stage, exit criteria, dependencies, testing strategy, risk register |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Parked post-v1 ideas |
| [`CLAUDE.md`](CLAUDE.md) | Standing orders for AI coding agents: blueprint is law, work in plan order |

## Development

Not yet scaffolded. Stage 0 (Expo skeleton) is the first milestone — see the
blueprint's roadmap section.
