# Decisions

Format for every entry: **Requirements → Choice → Alternatives rejected → What would change my mind.**
Keep adding entries as the build evolves. This file is the interview.

## 1. Scaffold inherited from HabitPool

- **Requirements:** second personal app on the same planned Raspberry Pi +
  Cloudflare platform; one developer; the first repo already litigated the
  stack choices.
- **Choice:** adopt HabitPool's decisions wholesale by reference — monorepo
  (`backend/` + `frontend/`), FastAPI + async SQLAlchemy + a Postgres database
  per app, Vite + React + TS PWA, pyright strict + invariant-mapped ruff +
  ESLint flat config, Cloudflare Access later (no cloud config until that work
  starts). See HabitPool's DECISIONS.md #1–4, #9–10, #12–13; this repo is
  app #2 of #12's multi-app plan.
- **Rejected:** re-deriving each choice here — the trade-offs are unchanged;
  restating them would just drift from the originals.
- **Would change my mind:** a requirement HabitPool never had (heavy client
  compute, real-time features) that breaks one of the inherited choices —
  that specific decision then gets its own entry here.

## 2. Extractor-file import over manual entry or live game integration

- **Requirements:** a veteran carries ~10–70 factors across 7 lineage members;
  the roster is ~100 and grows every career; data entry must be effortless or
  the tracker dies (the predecessor tkinter app's manual checkbox pickers were
  the bottleneck).
- **Choice:** import the `data.json` produced by UmaExtractor (community
  memory-reader run manually on the game's Veteran List screen). The app never
  touches the game; the user uploads a file.
- **Rejected:** manual entry — proven too slow for anything beyond a handful
  of hunted skills; live game-memory integration in the app itself — fragile,
  platform-bound, and a much worse ToS posture than consuming a file the user
  produced.
- **Would change my mind:** the extractor breaking permanently with no
  community fix — manual entry would need to return as a fallback path.

## 3. Full-replace import semantics

- **Requirements:** an extractor dump is the entire veteran list at a point in
  time; in-game deletions must be reflected; re-importing the same file must
  be safe.
- **Choice:** each import deletes all veterans and bulk-inserts the new
  snapshot in one transaction, recording an `imports` row (timestamp, count,
  filename) as history.
- **Rejected:** upsert by `trained_chara_id` — would silently keep veterans
  deleted in-game since the last dump; storing every import's veterans —
  history of full snapshots with no planned consumer, at 1–2 MB each.
- **Would change my mind:** a feature that needs roster history (e.g. "when
  did I retire this parent") — then imports stop deleting and rows gain a
  validity range.

## 4. Decode factors at import time, store decoded

- **Requirements:** factor ids are opaque ints; every read path (browse now,
  scoring later) wants names/kinds/stars; the scoring milestone runs in
  Python; reference data changes only when the game updates.
- **Choice:** decode `factor_id → {kind, key, star, name}` in a pure backend
  module (`app/ingest.py`, no I/O, no ORM — this repo's analog of HabitPool's
  `rewards.py`) at import time and store the decoded JSON. The raw
  `factor_id` is kept in every decoded entry; a re-import re-decodes, so
  refreshed reference data propagates by re-uploading.
- **Rejected:** decode at read time — recomputes a static answer per request;
  decode in the frontend — ships ~1,150-entry reference files to the client
  and splits decode logic across two languages right before the scoring
  milestone needs it in Python.
- **Would change my mind:** reference data becoming per-user or fast-moving —
  then stored decodes go stale faster than re-imports happen.

## 5. Hybrid schema: scalar columns + JSONB for sparks and lineage

- **Requirements:** browse/filter/sort on name, stats, aptitudes, rank score;
  sparks and the 6-slot lineage are tree-shaped and only ever consumed
  per-veteran; single user, roster ≤ ~500.
- **Choice:** normalized scalar columns for everything sortable, JSONB
  columns for decoded `factors`, raw `skills`, and decoded `lineage`.
- **Rejected:** fully normalized factor/lineage tables — 2–3 extra tables and
  joins for a SQL-over-factors query that is never planned (later scoring
  loads the roster into Python anyway); a single raw-JSON blob per veteran —
  gives up cheap sorting on the columns the table actually sorts by.
- **Would change my mind:** a real query need across factors (e.g. "all
  veterans whose lineage carries skill X" at a scale where Python-side
  filtering hurts).

## 6. Bundled, committed reference data over runtime fetching

- **Requirements:** card names and factor names change only when the game
  updates; the app should work offline and deterministically; uma.moe access
  needs an API key that must stay out of the repo.
- **Choice:** `backend/app/data/cards.json` (card_id → character name +
  outfit) and `factors.json` (factor key → name + type, from the game's own
  factor table — see #8) are generated by
  `backend/scripts/build_reference_data.py` from uma.moe's resources
  endpoints (Global `master.mdb`-sourced) and committed. Regeneration is a
  manual, deliberate act on game updates. The API key lives in the
  gitignored `backend/.env` (`UMA_MOE_API_KEY`; `--api-key-file` and the
  env var also work), and `uma_api_key.txt` is gitignored as a guard. (v1 briefly bundled a `factor_names.json` copied from the
  predecessor project; superseded the same day by the generated
  `factors.json`.)
- **Rejected:** fetching reference data at app startup or request time — a
  runtime dependency on a third party (plus key management on the server) for
  data that changes monthly; vendoring alpha123/uma-tools' `umas.json` —
  GPL-3.0, and uma.moe is fresher (it lags banners by days, not weeks).
- **Would change my mind:** uma.moe closing the resources endpoint — fall back
  to generating from alpha123/uma-tools at build time (fetch-and-derive, not
  vendor) or GameTora's per-card JSON as a last resort.

## 7. Whole-roster API, client-side sort and filter

- **Requirements:** single user; ≤ ~500 veterans (~1–2 MB per 100 as JSON);
  the table should re-sort instantly.
- **Choice:** `GET /api/veterans` returns everything (decoded factors and
  lineage included); the frontend sorts and filters in memory.
- **Rejected:** server-side pagination/filter params — API surface and
  round-trips that earn nothing at this size.
- **Would change my mind:** the payload noticeably lagging on the phone over
  the tunnel — then the list endpoint slims down and a detail endpoint
  appears.

## 8. Factor names and kinds from the game's own factor table

- **Requirements:** every decoded factor needs a name and a kind
  (blue/pink/white/…); labels shouldn't be guesses presented as facts; the
  key-range heuristic can't distinguish white skill factors from race and
  scenario factors (all mid-range keys).
- **Choice:** uma.moe's `factors.json` — generated from the Global
  `master.mdb`'s `text_data` category 147, i.e. the game's own factor
  names — bundled as `app/data/factors.json` (`key → {name, type}`, where
  key = uma.moe id ÷ 10 = a record's `factor_id ÷ 100`). Its `type` field
  classifies factors authoritatively: blue, pink, race (G1 wins), white
  skill, scenario, unique. Keys absent from the file fall back to the
  key-range heuristic with degraded labels (`Blue 9`, `Unknown (21021)`).
- **Rejected:** the v1 approach — a white-names-only file from the
  predecessor project plus hand-written blue/pink tables (pink verified
  empirically 99/99 via the "pink only on A+ aptitude" rule, blue
  TODO-flagged). It shipped first but had three unnamed white keys, no
  race/scenario awareness, and one wrong pink label (31 is "Sprint", not
  "Short"). The empirical verification was sound as far as it went — the
  official table confirmed all of it except that label.
- **Would change my mind:** uma.moe dropping the artifact — the empirical
  approach returns as the fallback, now checkable against this table's
  snapshot.

## 9. Tags: app-side, keyed by trained_chara_id

- **Requirements:** organize veterans with user-defined tags (the in-game
  tag/favorite marks don't appear anywhere in the extractor dump — every
  candidate field is either constant or something else, e.g. `is_locked` is
  just the 0/1 padlock); tags must survive imports.
- **Choice:** a `veteran_tags` table — `(trained_chara_id, tag)` unique,
  free-text tag names, edited in the web UI. Keyed by the game's
  `trained_chara_id` rather than the local `veterans.id` FK precisely so
  full-replace imports (#3) can't touch them. Tags whose veteran is absent
  from the current snapshot simply don't display; they're not pruned, so a
  re-import that brings the uma back (e.g. re-uploading an older file)
  restores its tags.
- **Rejected:** mirroring the in-game tags — not exported, so there's nothing
  to mirror; surfacing `is_locked` instead — it's a different, single-bit
  concept and wasn't what the organizational need was; tag colors/ordering —
  free-text names cover the need until proven otherwise.
- **Would change my mind:** a future extractor version exporting the game's
  tag assignments — then an import-time sync (game tags → app tags) becomes
  the obvious bridge.
