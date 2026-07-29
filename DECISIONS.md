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

## 9. Tags: app-side, keyed by trained_chara_id, fixed mark-icon ids

- **Requirements:** organize veterans with user-defined tags (the in-game
  tag/favorite marks don't appear anywhere in the extractor dump — every
  candidate field is either constant or something else, e.g. `is_locked` is
  just the 0/1 padlock); tags must survive imports; the roster-grid redesign
  wants tags as at-a-glance badges on cards, mirroring the game's own
  favorite-mark UI.
- **Choice:** a `veteran_tags` table — unique on `trained_chara_id` (**one
  mark per veteran**), edited in the web UI. Keyed by the game's
  `trained_chara_id` rather than the local `veterans.id` FK precisely so
  full-replace imports (#3) can't touch them. Tags whose veteran is absent
  from the current snapshot simply don't display; they're not pruned, so a
  re-import that brings the uma back (e.g. re-uploading an older file)
  restores its tags. Tag values are a **fixed set of ids**
  (`mark_01`–`mark_15`, the game's 15 favorite marks; committed as
  `app/data/tag_icons.json`, validated in `add_tag`, art extracted locally
  per #10) — amended 2026-07-29 from the original free-text tags, which
  shipped first but read poorly as card badges and duplicated what the game
  already has a familiar visual language for. The free-text rows that
  existed were throwaway and were purged by a data migration rather than
  mapped. The one-mark limit (amended same day, before any real multi-mark
  use) mirrors the game — a trained uma has a single favorite mark — and
  keeps the roster-grid card to one clean badge; `add_tag` has replace
  semantics, so picking a new mark displaces the old in one call. The API
  still returns `tags` as a list, so widening back to multiple would be an
  app-level change, not an API break.
- **Rejected:** mirroring the in-game tag *assignments* — not exported, so
  there's nothing to mirror (the icons are extractable; which uma carries
  which mark is not); surfacing `is_locked` instead — it's a different,
  single-bit concept and wasn't what the organizational need was; keeping
  free text alongside the icons — two tag vocabularies to filter and render
  for one organizational need; multiple marks per veteran — built first,
  but the PR 3 card badge would need stacking or a "+n" overflow, and the
  game's own model (one mark) is the mental model users already have.
- **Would change my mind:** a future extractor version exporting the game's
  tag assignments — then an import-time sync (game tags → app tags) becomes
  the obvious bridge; an organizational need the 15 marks can't express —
  free text returns as a second, non-badge field rather than widening this
  one; needing orthogonal labels (e.g. "front-runner project" and "keeper")
  — the table still supports multiples, so only the constraint and replace
  semantics would need relaxing.

## 10. Game image assets: fetched locally, never committed

- **Requirements:** the roster grid needs the in-game character icons (and
  later the favorite-mark icons); the repo is public; game art is Cygames'
  copyrighted property; icon hosting must not depend on a third party at
  page-load time.
- **Choice:** scripts fetch/extract images into `frontend/public/icons/`,
  which is gitignored — the repo stays a *client* of the art, never a
  redistribution point. Character icons come from uma.moe's frontend assets
  (`chara_stand_{card_id}.webp`, the exact 128×128 in-game icon) with
  GameTora's thumbnails as fallback; an uncommitted `index.json` maps
  card_id → filename. The index is gitignored with the art (it's derived
  from whatever landed on disk), which sets the frontend contract: a fresh
  clone has neither icons nor index, so the UI must always tolerate a
  missing index or missing keys and fall back to a placeholder. The
  favorite-mark icons exist only inside the client's UI asset bundles — on
  no CDN or fan site — so `scripts/extract_fav_icons.py` pulls them from
  your own installed Global client (meta-DB and bundle decryption adapted
  from Vali-98/umamusu-utils, MIT; credited in README) into
  `icons/marks/`, same posture: read-only against the game, local only.
  A fresh clone runs the scripts once (documented in README/CLAUDE.md).
- **Rejected:** hotlinking uma.moe/GameTora — their asset paths are
  deploy artifacts that can move silently, uma.moe sends no CORS header,
  and it spends their bandwidth per page load; committing the images —
  440 KB is trivial but publishing game art in the repo is exactly the
  posture to avoid; umapyoi's images — official-site promo art keyed by
  character, not the per-card in-game icons.
- **Would change my mind:** the app being hosted for others (icons must
  then live on the deployment, still not in git), or a source with clearly
  licensed art appearing.

## 11. Roster as an icon grid + detail modal, icon-only cards

- **Requirements:** the table crammed ten columns into every row and had
  grown too dense to scan; the roster is browsed visually ("where is my
  Kitasan parent") far more often than compared numerically; tags are now
  at-a-glance badges (#9) that want to sit on something card-shaped; the
  eventual daily driver is a phone over the tunnel.
- **Choice:** a responsive card grid (`auto-fill, minmax(120px, 1fr)`) —
  the in-game character icon, the score beneath it (today `rank_score`;
  the slot is generic and swaps to the hunted-spark score in the scoring
  milestone), one mark badge overlaid. Cards are **icon-only** — no name;
  a tooltip and the modal header carry it, same as the game's own veteran
  list. Everything else (stats, aptitudes, mark editing, sparks, lineage)
  moved into a click-open modal that reuses the table era's detail
  components unchanged. Column-header sorting went with the columns;
  sorting is a single always-descending select — best-first for numbers,
  newest-first for the trained date. Missing art (fresh clone before
  `fetch_icons.py`, or a card newer than the local index — the #10
  contract) renders an initial-letter tile, no asset needed.
- **Rejected:** name captions under cards — they repeat what the icon
  already says, force two-line cards, and were explicitly not wanted;
  keeping the table behind a view toggle — two roster UIs to maintain
  before any real design pass; ascending sort directions — scanning a
  grid wants best/newest first, and a direction toggle earns another
  control for a case with no use; virtualizing the grid — ~100 cards
  (#7's scale) render fine.
- **Would change my mind:** icon-only becoming ambiguous (many trained
  copies of the same card differing only in sparks) — then a caption or
  per-card stat strip returns; roster scale breaking the whole-roster
  render (#7 falls first).
