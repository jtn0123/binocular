# Binocular — agent guidelines

## The blueprint is law

`docs/BLUEPRINT.md` is the source of truth for this project — the gold
standard every change is validated against. Before starting ANY task:

1. Read `docs/BLUEPRINT.md` (or the sections relevant to your task: decision
   log §2, architecture §3, data model §4, AI vision contract §6, workflows
   §8, roadmap §10, invariants §11).
2. If the requested change conflicts with the blueprint, STOP and surface the
   conflict to the user — do not silently diverge and do not silently "fix"
   the blueprint to match.
3. Before declaring a task done, run the invariants checklist in blueprint
   §11 and the acceptance criteria for the current stage in §10.

`docs/PLAN.md` is the execution companion: file-level tasks per stage with
checkboxes. Work in plan order, check off tasks in the same commit as the
work, and close a stage with a `stage-N-complete` tag only when its Exit
criteria pass. If plan and blueprint disagree, the blueprint wins.

## Changing the blueprint

The blueprint may only change by deliberate, standalone commits prefixed
`blueprint:` that the user has explicitly agreed to. Never mix blueprint
edits into feature commits.

## Project facts

- App: **Binocular** — AI-vision workshop inventory (photograph bins/tools,
  auto-catalog contents, search "where is my X?").
- Stack: React Native + Expo (managed), TypeScript strict, expo-router,
  expo-sqlite (FTS5), zod at all trust boundaries.
- Vision: cloud (Anthropic Claude) and on-device engines behind
  `src/vision/provider.ts`; the Anthropic SDK may only be imported in
  `src/vision/claudeProvider.ts`, on-device ML only in
  `src/vision/localProvider.ts`. The app must be fully demo-able on
  `fixtureProvider`.
- Confidence is the enum `high | medium | low` per the rubric in blueprint
  §6.3 — never numeric percentages, anywhere.
- AI output never writes to inventory tables without user confirmation.
- Offline-first: every screen except live recognition works in airplane mode.
- Build order follows the staged roadmap (blueprint §10); do not skip ahead —
  a stage is done only when its acceptance criteria pass.
