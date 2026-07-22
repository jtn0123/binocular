# Binocular 🔭🗄️

**Point your camera at a bin and know what's inside.**

Binocular is a mobile app for home workshops: photograph a bin (or items on
your bench) and AI vision identifies the contents, files them under the right
bin → shelf → location, and later answers *"where is my 10mm socket?"* in two
taps.

- **React Native + Expo** (TypeScript, Android-first, iOS-ready)
- **Cloud AI vision** (Anthropic Claude) behind a swappable provider abstraction
- **QR-labeled bins** — print sticker sheets from the app
- **Offline-first** — SQLite + FTS5 search; photos queue for recognition when
  connectivity returns

## Status

Planning. The build is staged and spec-driven — see
[`docs/BLUEPRINT.md`](docs/BLUEPRINT.md), the source-of-truth document that
all work is validated against: data model, AI vision contract, workflows with
acceptance criteria, and the Stage 0–6 roadmap.

## Development

Not yet scaffolded. Stage 0 (Expo skeleton) is the first milestone — see the
blueprint's roadmap section.
