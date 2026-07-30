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
  outfit), `factors.json` (factor key → name + type, from the game's own
  factor table — see #8), and `skills.json` (skill_id → name/rarity/unique
  — see #12) are generated by
  `backend/scripts/build_reference_data.py` from uma.moe's resources
  endpoints (Global `master.mdb`-sourced) and committed. One field comes
  from elsewhere: card **titles** (the bracketed epithets, `[Special
  Dreamer]`) exist on no fan API, so the script reads them from the local
  Global client's own `master.mdb` (plain SQLite, `text_data` category 5)
  when the game is installed, and otherwise carries them over from the
  committed file — a gameless regeneration never wipes them. Regeneration
  is a manual, deliberate act on game updates. The API key lives in the
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
  no CDN or fan site — so an extraction tool pulls them from your own
  installed Global client (meta-DB and bundle decryption adapted from
  Vali-98/umamusu-utils, MIT; credited in README) into `icons/marks/`,
  same posture: read-only against the game, local only. That tool is kept
  **outside the repo**: it embeds the client's decryption keys, and
  publishing those in a public repo is a bigger exposure than the art this
  entry already refuses to commit. It was briefly committed as
  `backend/scripts/extract_fav_icons.py`; removed and scrubbed from history
  2026-07-29. A fresh clone runs the icon scripts once (documented in
  README/CLAUDE.md).
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
  milestone), the mark badge top-left and a rank-tier badge top-right,
  mirroring the game's own veteran list (tier derived from `rank_score`
  via the community-documented breakpoints — G 0 … SS+ 19,200 …
  US 63,400 — since the dump's `rank` field is a raw id, not the
  displayed tier). Under the **Sparks sort**, the score line swaps to
  the game-style own-spark strip: labeled star triplets for the blue,
  pink, and (when present) unique spark — e.g. `WIT · MED · UNIQ`.
  Cards are **icon-only** — no name;
  a tooltip and the modal header carry it, same as the game's own veteran
  list. Everything else (stats, aptitudes, mark editing, sparks, lineage)
  moved into a click-open modal that reuses the table era's detail
  components unchanged. Column-header sorting went with the columns;
  sorting is a select over four keys — Rating (`rank_score`), Sparks
  (the veteran's **own blue spark**, ordered stat-then-star: 1★ Speed →
  3★ Wit), Date Acquired (the default, newest first), Name — plus an
  ▲/▼ direction toggle; picking a key resets direction to that key's
  natural start. The sort preference persists in `localStorage`
  (single-user, per-device; no API surface or migration for one
  preference — a DB settings table would subsume it if cross-device
  sync ever matters). Missing art (fresh clone before `fetch_icons.py`,
  or a card newer than the local index — the #10 contract) renders an
  initial-letter tile, no asset needed.
- **Rejected:** name captions under cards — they repeat what the icon
  already says, force two-line cards, and were explicitly not wanted;
  keeping the table behind a view toggle — two roster UIs to maintain
  before any real design pass; per-stat sort keys (Speed/Stamina/…,
  the table's columns) — shipped briefly on this branch, but scanning
  a grid never asked "sort by Guts", and the four kept keys are the
  questions actually asked of a roster; sorting Sparks across the
  whole lineage — the hunted-skill scoring milestone is the real
  answer to "which card breeds best", and a star-total here would
  pre-empt it with a worse number; virtualizing the grid — ~100 cards
  (#7's scale) render fine.
- **Would change my mind:** icon-only becoming ambiguous (many trained
  copies of the same card differing only in sparks) — then a caption or
  per-card stat strip returns; roster scale breaking the whole-roster
  render (#7 falls first).

## 12. Skill names: bundled reference, decorated at read time

- **Requirements:** the dump's `skill_array` is raw `{skill_id, level}`;
  the modal wants human-readable names; stored skills stay raw (#5); the
  scoring milestone will read skill data in Python; new skills arrive
  with game updates.
- **Choice:** `app/data/skills.json` (`skill_id → {name, rarity, unique}`)
  generated by `build_reference_data.py` from uma.moe's skills artifact,
  gap-patched because that artifact has holes real dumps hit (verified:
  28 of a 99-veteran roster's 249 distinct ids). Holes are filled from
  the local client's `master.mdb` (`skill_data` joined to `text_data`
  category 47 — the game's own names and rarities), with the same
  when-installed/carry-over pattern as card titles (#6). Fallback passes
  for a gameless regeneration cover base uniques via the id relation
  between type-5 factor keys (`chara_id*100+1`) and unique skill ids
  (`100001+(chara_id-1000)*10`), inherited uniques (`9XXXXX` = copy of
  `1XXXXX`), and ◎/○ white families (factor key = `skill_id // 10`,
  x1 = ◎ / x2 = ○ — but only when the factor name ends in ○: other
  families pair a white with a differently-named gold in no fixed
  suffix order, and some suffix ids don't exist at all, so their holes
  are never guessed). uma.moe's `unique` flag ships inconsistent (42 of
  137 inherited rows, 4 rarity-5 bases), so it is normalized locally:
  unique ⇔ rarity ≥ 3 or a `9XXXXX` id — the rule every correct row of
  the full table already satisfies.
  The API decorates `SkillOut` with name/rarity/unique **at read time**
  from the bundled table — unlike factors (#4), skills are not decoded
  at import: storage stays raw per #5, names are pure presentation, and
  a reference refresh shows up without re-importing. Unknown ids
  serialize `name: null`; the UI falls back to `Skill {id}`.
- **Rejected:** decoding at import like factors — changes #5's raw
  storage for no consumer (scoring reads `skills.json` directly in
  Python) and makes every reference refresh wait for a re-import;
  frontend-side decode — ships a 1,176-entry table to the client and
  splits reference handling across two languages (#4's argument);
  hand-maintaining a name table — the game adds skills monthly.
- **Would change my mind:** scoring wanting decoded skills persisted
  per veteran — import-time decode returns per #4's pattern; uma.moe
  closing the artifact's gaps — the patch passes become dead code to
  delete.

## 13. Roster filtering: OR within a category, AND across categories

- **Requirements:** find breeding candidates by what they carry — blue
  (attribute) sparks, pink (aptitude) sparks, unique-spark stars, the
  favorite mark, and the specific card — without a query language; the
  daily driver is a phone; filters must survive a reload like the sort
  does.
- **Choice:** a Filters pill docked beside the sort pill (bottom-right)
  opening a bottom-sheet panel with five sections, Umas first.
  Selections OR within a section and AND across sections — each section
  you touch narrows the grid, untouched sections don't filter. Umas
  opens a search popout (name/outfit substring) over an icon grid of
  the exact cards in the roster (base and alt outfits filter
  separately); picks show as removable chips in the panel. The two
  spark sections carry a star-level mode (All / 2★+ / 3★) and a
  per-section **Legacy sparks** toggle that widens matching from own
  sparks to the whole 6-slot lineage; aptitude chips group as
  Track/Distance/Style like the modal. The unique section selects by
  star level (1★/2★/3★ chips, own unique by default, same legacy
  toggle); favorites are the 15 mark icons plus a **no-favorite** chip
  (matches unmarked veterans; ORs with marks like any other chip). A
  sixth section, **Common Sparks** (after Unique), filters by white-,
  race-, or scenario-spark name through the same search-popout pattern
  as Umas (vocabulary = the ~170 such sparks actually present in the
  roster, not the full game table) — each selected spark carries its **own**
  star mode and legacy toggle, with a per-section reset beside the
  chooser. Unlike every other section, selected common sparks **AND**
  together: a breeding shortlist wants veterans carrying every hunted
  spark, and OR across specific skills answers no real question. The
  panel header shows a live "N of M match" count and a Reset-Filters
  button so filters can be tuned without closing the panel. State persists in `localStorage` (`umalab.filters`), applied
  client-side per #7. Persisted state is validated field-by-field on
  load (a half-shaped section falls back to defaults rather than
  misreading as "3★ only"), and every roster load reconciles filters
  against what actually exists — a mark, card, or spark selection whose
  last carrier left the roster is **cleared, not masked**, so a stale
  persisted filter can never hide the whole grid with nothing in the
  panel to explain why.
- **Rejected:** OR across everything — a grid that only grows as you
  select more answers no real roster question; filtering by specific
  unique-skill name — ~90 chips of UI for a question ("who has a 3★
  unique") the star chips answer; character-level uma filtering —
  outfits differ exactly where breeding cares (sparks roll per card);
  server-side filter params — #7's whole-roster API makes client
  filtering free.
- **Would change my mind:** the hunted-skill scoring milestone needing
  white-spark filters — the panel gains a section backed by the same
  factor pool; roster scale breaking client-side filtering (#7 falls
  first).

## 14. Affinity reference data from the local client, committed

- **Requirements:** the blueprint designer needs the succession affinity
  tables — relation groups, their points, and the △/○/◎ rank bands —
  plus the win-saddle → G1-race mapping for the shared-win bonus; no fan
  API publishes either (uma.moe's resources cover cards, factors, and
  skills only); the app must stay offline-deterministic per #6.
- **Choice:** `backend/app/data/relations.json` and `races.json`,
  generated by the same `build_reference_data.py` run from the local
  Global client's `master.mdb` (`succession_relation`,
  `succession_relation_member`, `succession_relation_rank`;
  `single_mode_wins_saddle` expanded through `race_instance` to `race`,
  keeping grade-100 components only; names from `text_data` categories
  111 and 32). Same carry-over posture as card titles (#6): without the
  game installed the committed files are kept, never wiped. The rank
  bands ship as data (they are literal game rows), not constants in
  code.
- **Rejected:** vendoring hakuraku's `umdb.json` — compiled protobuf,
  someone else's refresh cadence, and our mdb is the same source one hop
  shorter; scraping GameTora/umaishow — derived data with no license.
- **Would change my mind:** the mdb schema changing (the build script
  fails loudly and the entry gets revisited); hosting for others making
  "run against your own client" too narrow a regeneration path.

## 15. Affinity math models the new Global win-saddle system

- **Requirements:** compatibility symbols must match what the Global
  client shows today; Global replaced its affinity system on 2026-06-24
  (+3 points per shared won G1 on parent↔parent and
  parent↔own-grandparent links; G2/G3 wins and win titles no longer
  count; base relation values rebalanced in the same patch).
- **Choice:** `app/affinity.py` implements the new system:
  relation-group sums (pair + parent-triple links) from #14's tables —
  which, coming from the live client, already carry the rebalanced
  values — plus `WIN_POINTS_PER_SHARED_G1 = 3` on the five win links,
  shared races counted once via saddle→G1-set expansion, and one
  non-obvious exclusion: **a grandparent slot whose chara repeats the
  trainee's (or its own parent's) contributes zero to its relation
  triple** — win overlaps stay chara-blind. The formula was verified
  against the live Global client through three rounds of in-game
  parent-select symbol checks (ten observations, 2026-07-30), after
  the first round contradicted the community-documented formula; the
  exclusion rule was located in GameTora's per-server calculator
  implementation and then confirmed to fit all ten observations
  exactly. The algorithm skeleton came from hakuraku's
  `VeteransHelper.ts` (MIT, credited in README); its legacy
  +1-per-shared-win constants are deliberately not ported. Same-name
  G1s at different venues (Kyoto-renovation reroutes, rotating JBC
  hosts) DO cross-match — two dedicated in-game checks both scored
  the cross-venue bonus (2026-07-30), overturning the JP-documented
  old-system behavior — so races.json canonicalizes every variant
  group to one id at build time.
  Whether the parent↔parent win overlap also feeds each parent's
  *individual* affinity is still unverified — it is excluded there for
  now and the per-link breakdown keeps that a one-line change; it
  affects only the scoring milestone's per-parent rates, not totals.
- **Rejected:** porting hakuraku's constants as-is — they predate the
  system change; hardcoding relation points or thresholds — they are
  game data and live in #14's files.
- **Would change my mind:** in-game anchor symbols disagreeing with
  computed totals — the win-link set or constant is wrong and this entry
  gets amended with what the anchors prove.

## 16. Blueprints persisted server-side, roster slots by trained_chara_id

- **Requirements:** saved inheritance designs must survive roster
  re-imports — which are full-replace snapshots (#3) that delete every
  `veterans` row — and be reachable from any device the app serves; no
  design-sharing requirement in v1.
- **Choice:** a `blueprints` table (name, nullable trainee_chara_id,
  JSONB `slots` keyed p1/p2/g11/g12/g21/g22). Roster and lineage slots
  reference their backing veteran by **trained_chara_id** — the same
  import-stable key veteran_tags uses (#9) — and every slot additionally
  snapshots `chara_id`/`card_id` and the pick's won-saddle ids, so a
  slot whose veteran left the current snapshot still renders and scores
  — win bonus included — degraded to a catalog-theoretical pick with a
  "not in current roster" badge. Slots
  are never pruned to match the roster. Saves are validated against the
  game's slot rules (parent ≠ trainee's chara, p1 ≠ p2, grandparent ≠
  its own parent or its sibling slot) so a stored design is always one
  the parent-select screen would accept; a grandparent repeating the
  *trainee's* chara is legal in-game and deliberately allowed.
- **Rejected:** localStorage — single-browser, wiped with site data,
  and invisible to the eventual Pi deployment's other clients;
  URL-encoded designs — sharing is out of v1 and a lineage doesn't fit
  a readable URL; referencing `veterans.id` — dies on every re-import;
  pruning/cascading slots on import — silently destroys designs.
- **Would change my mind:** the platform gaining a second user
  (blueprints then need an owner column and Access-identity scoping);
  real demand for sharing (an export codec becomes an addition, not a
  replacement for persistence).

## 17. Affinity scoring over the wire, stateless

- **Requirements:** the designer needs live scores while slots are
  filled and refilled; the formula in `app/affinity.py` was verified
  against the live client (#15) and the spark-scoring milestone will
  consume the same per-parent affinities in Python; scoring costs
  microseconds.
- **Choice:** `POST /api/affinity`, stateless: the client sends each
  filled slot as `{chara_id, win_saddle_ids}` (it already holds veterans'
  raw saddle ids from `GET /api/veterans`), the server expands saddles to
  G1 sets and scores against a module-level relation table built once at
  startup. No DB reads, nothing precomputed or persisted — same
  stale-reference reasoning as read-time skill decoration (#12). A future
  parent-ranking endpoint is the same request body plus an open-slot
  marker, looping `score_blueprint`.
- **Rejected:** porting the math to TypeScript for client-side scoring —
  splits a freshly-verified formula across two languages just before the
  scoring milestone needs it in Python (#4's rationale); precomputing
  pair scores into Postgres — goes stale on every reference regen for no
  measurable win at 24 µs/score; GET with query params — seven slots of
  id arrays don't belong in a URL.
- **Would change my mind:** an interactive optimizer needing thousands
  of scores per keystroke — then the relation table ships to the client
  (or the ranker endpoint batches server-side) and this entry gets
  revisited.

## 18. react-router once the second view exists

- **Requirements:** the blueprint designer is a full second page beside
  the roster, sharing the app chrome (import flow, error toast, icon
  index); the two views should be separately addressable/bookmarkable,
  and deep links like `/designer/:id` must stay possible later even
  though they're out of v1.
- **Choice:** react-router in **library mode** — `<BrowserRouter>` in
  main.tsx, `<Routes>` plus `<NavLink>` nav in App.tsx, nothing from
  framework mode. Pinned to **v7**: v8 requires React ≥19 and the app
  is on 18; the library-mode API is identical, so the eventual React
  upgrade makes this a version bump. App.tsx is now the shell (shared
  fetch/import/toast state) and the roster body lives in
  `pages/RosterPage.tsx`, its sort/filter state and localStorage keys
  moving with it verbatim. Shared state reaches pages by prop drilling
  — one shell passing to two pages doesn't earn a context.
- **Rejected:** wouter or hand-rolled `location.pathname` matching —
  saves ~30 kB now, then reimplements nested routes and path params the
  moment the designer grows deep links; tab state in `useState` — no
  URLs, so no bookmarks, dead back button, and PR 4's designer becomes
  unlinkable; react-router framework mode (loaders/actions) — the data
  flow already exists and works, and rewriting it isn't this refactor's
  job.
- **Would change my mind:** on server-side data needs (loaders), a
  framework-mode migration; if v1's two flat routes are still all there
  is when the router next causes friction, wouter's argument improves.
