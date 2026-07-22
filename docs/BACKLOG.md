# Backlog — parked ideas (post-v1)

Ideas that came up but are deliberately **not** in v1 scope (see blueprint
§1 non-goals). New ideas land here instead of expanding a stage mid-build.

- **Self-consistency voting** — run the same photo through the model twice
  and flag items appearing in only one response; revisit only if the
  confidence rubric proves unreliable in real use (blueprint §6.3).
- **Hybrid on-device recognition** — ML Kit / TF Lite pass for instant
  offline results on common items, cloud call for the hard stuff.
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
