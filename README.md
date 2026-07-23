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

## Status

Stages 0–6 of the roadmap are built, tested (118 Jest tests), and
emulator-verified. Stage 7 (iOS pass) remains, plus the physical-world exit
criteria: a real-bin recognition audit with a cloud API key and a
print-then-scan label round-trip.

## Development

```bash
npm install
npm run start        # Metro; press `a` for Android
npm test             # Jest (jest-expo; better-sqlite3 backs the db tests)
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # expo lint
npm run seed         # writes an inspectable dev.db via better-sqlite3
```

Everything except the on-device engine runs in **Expo Go**. The local ML Kit
engine needs the dev build:

```bash
npx expo run:android   # builds + installs the dev client (JDK 17+)
npx expo run:ios       # needs an iOS simulator runtime downloaded in Xcode
```

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
| [`CLAUDE.md`](CLAUDE.md) | Standing orders for AI coding agents: blueprint is law, work in plan order |
