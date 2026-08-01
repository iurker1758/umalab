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
  Vali-98/umamusu-utils, MIT) into `icons/marks/`,
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
  **RESOLVED 2026-07-31 — the parent↔parent link DOES feed each
  parent's individual affinity, relation points and win bonus alike,
  and it feeds BOTH of them.** Left open at first (excluded from both
  parents pending evidence), then settled by **Polaris's**
  compatibility-0 study (`@BourBon_Polaris`, Aug 2025 — linked in
  RESOURCES.md): a JP dataset of 1000 inheritances at known
  compatibility, cross-checked against the in-app 相性値の内訳 panel:
  「各親・祖の相性ボーナス(親7・祖2・祖2) / 親① (青1+青4+青5)+緑3 /
  祖① 青4 / 祖② 青5 / ※両親の相性値とG1ボーナス(緑3)は重複します」.
  The numerals index the seven breakdown rows, so a **parent** takes its
  trainee-pair link, both of its triples *and* the p1-p2 row, while a
  **grandparent** takes only its own triple — and the p1-p2 row is
  explicitly 重複 (duplicated) across the two parents. Verified against
  their own lineage (rows 9/9/10/0/0/0/0 → each parent 19pt → ×1.19,
  every grandparent 0pt → ×1.00) and against the measured rates in the
  same post. `node_affinity` implements exactly this, so the six
  attributions deliberately do NOT sum to the total. Consequence: the
  attributions changed, the total did not — this was never a totals
  question.
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
  `pages/RosterPage.tsx`; sort state and the localStorage keys move with
  it unchanged. **Filter state stays in the shell**: reconciliation
  (clearing filters whose targets left the roster) must run once per
  fetched roster, and a page owning that state re-runs it on every
  Roster remount — wiping selections that currently match nothing, like
  a favorite mark no veteran carries yet. A `loaded` flag distinguishes
  "fetch hasn't succeeded" from a truly empty roster so the "No roster
  yet" onboarding text can't flash during the initial request. Shared
  state reaches pages by prop drilling — one shell passing to two pages
  doesn't earn a context. `UmaCardChip` moves out of FilterPanel into
  its own file ahead of its second consumer, the designer's SlotPicker.
- **Rejected:** wouter or hand-rolled `location.pathname` matching —
  saves ~30 kB now, then reimplements nested routes and path params the
  moment the designer grows deep links; tab state in `useState` — no
  URLs, so no bookmarks, dead back button, and PR 4's designer becomes
  unlinkable; react-router framework mode (loaders/actions) — the data
  flow already exists and works, and rewriting it isn't this refactor's
  job; page-local filter state with a mount-scoped reconcile marker —
  the remount-wipe above, caught in review.
- **Would change my mind:** on server-side data needs (loaders), a
  framework-mode migration; if v1's two flat routes are still all there
  is when the router next causes friction, wouter's argument improves.
- **Deploy note:** real URLs mean the eventual static host must serve
  `index.html` for unknown paths (SPA history fallback). The dev/preview
  servers and the planned Cloudflare Pages target (no `404.html` → auto
  fallback) all do; revisit when deployment work starts — no host config
  in the repo until then.

## 19. Designer scores server-side, saves explicitly

- **Requirements:** the `/designer` page needs live affinity feedback
  while slots change, spark star totals across the designed lineage,
  and durable saved designs -- with the scoring milestone (hunted-skill
  spark math) landing next in Python.
- **Choice:** every score comes from the stateless `POST /api/affinity`
  (DECISIONS.md #17), debounced ~250 ms behind slot edits with an
  `AbortController` guarding out-of-order responses; below the scoring
  threshold (trainee + at least one parent) the page just hides the last
  result rather than clearing state in an effect, and a failed request
  clears the result and reports inline in the panel (a toast per edit
  would spam while the backend is down, and stale numbers must not pose
  as current). Designs persist only through the explicit Save button
  (POST new / PUT full-replace), with a small unsaved-changes dot -- no
  autosave; the working design lives in the App shell (like filters,
  #18) so a route change can't silently discard unsaved work. The
  picker mirrors the server's game rules client-side (`slotConflicts`
  in `blueprint.ts`) purely to grey out dead picks; the server stays
  the authority and a 422 on save still surfaces in the toast. Parent
  picks own their grandparent slots: a roster parent auto-fills both
  from its lineage positions 10/20, clearing a parent clears them, and
  a catalog re-pick drops auto-filled lineage grandparents while
  keeping manual ones. A parent pick that would repeat a filled
  grandparent is greyed out like any other illegal pick (review
  reversal -- the earlier "parent wins, dependent slots yield" rule
  silently emptied a slot the user had filled).
- **Rejected:** client-side affinity math -- forking the verified
  formula (#14) across two languages right before the scoring milestone
  needs it in Python, for a saving of one debounced 24 us request;
  autosave and localStorage drafts -- Postgres is the single store by
  scope decision, and autosaving partially-edited designs turns every
  misclick into a persisted state (reversed in #26, which went further
  still — every design is a row from the moment it exists: losing a
  plan to a closed tab proved worse than persisting a misclick, which
  the map makes visible and one click undoes); letting a parent pick
  displace a
  conflicting filled grandparent -- silent deletion of work, and
  greying out is consistent with every other illegal pick.
- **Would change my mind:** an offline/PWA designer story would revive
  client-side scoring (as a port kept in lockstep by shared test
  vectors); multi-device editing would earn drafts a home.

## 20. Bulk mark assignment gets its own endpoint

- **Requirements:** the roster page's selection mode marks or clears
  dozens of veterans in one gesture; the result must be all-or-nothing
  (a half-marked selection after a failure is worse than a clean retry)
  and cheap enough to run against a Raspberry Pi backend.
- **Choice:** `POST /api/veterans/tags/bulk` taking
  `{trained_chara_ids, tag}` where `tag: null` means clear. `tag` is
  required with no default: clears are destructive and marks aren't in
  the extractor dump, so only an explicit null selects that branch — a
  body that omits or misspells the key 422s (review finding). One
  transaction: a multi-row upsert on the existing one-mark-per-veteran
  constraint (#9), or a single `DELETE ... IN` for clears; `updated`
  reports rows actually touched, not the request size. Any id missing
  from the current roster 404s the whole request — the client refreshes
  and retries against fresh state, mirroring the single-tag endpoint's
  contract.
- **Rejected:** looping the per-veteran `POST /tags` from the client —
  N round-trips with no atomicity, partial failure leaves the roster
  half-marked with no honest way to report it, and each response would
  race the final refresh; ignore-missing semantics (apply to the
  intersection) — silently marking fewer veterans than selected is the
  same dishonesty in miniature, and the stale-selection case it would
  paper over (a re-import between fetch and apply) is exactly when the
  user should be looking at fresh data.
- **Would change my mind:** free-text tags or multi-tag veterans (#9
  reversal) — the body shape and upsert both assume one fixed mark id
  per veteran.

## 21. Batch favorite runs target-first, in its own dock

- **Requirements:** bulk marking should feel like the game's own batch
  screen (Jason's call after using the select-first version); the
  destructive cases — overwriting hand-assigned marks, clearing en
  masse — need visibility before the write; the controls must not
  crowd the Filters/sort dock.
- **Choice:** the game's order — Batch Favorite opens the 16-tile
  picker first (✕ = clear mode), then a selection pass over the grid,
  then Confirm. The effective selection is `picked ∩ current filter ∩
  eligible`, where eligible means the confirm would change the row
  (doesn't carry the target; in clear mode, carries anything);
  ineligible cards dim and ignore taps. The dock's count pill doubles
  as the safety readout — "replaces N" when picks carry other marks,
  and a plain-language line when nothing is eligible (an all-dimmed
  grid otherwise reads as a broken page). The target chip re-opens the
  picker with the selection kept, so a wrong target never costs a
  hand-built selection. The controls live in a sticky top-right row
  (pointer-events pass-through outside the pills) apart from the
  Filters/sort dock, which stays usable mid-selection but freezes with
  everything else during the in-flight confirm.
- **Rejected:** select-first with the mark chosen at confirm time —
  built, then replaced for game parity; a blocking confirm dialog —
  the readout puts the same information in view without a modal in a
  single-user tool; letting ineligible cards toggle anyway — a pick
  that provably changes nothing only pads the payload.
- **Would change my mind:** an undo/history feature would soften the
  destructive-overwrite concern enough to drop the replaces readout;
  multi-mark veterans (#9 reversal) would invalidate the eligibility
  rule outright.

## 22. Original committed SVGs for favorite marks

- **Requirements:** mark icons render in badges, pickers, chips and the
  modal; the eventual deployment serves the frontend publicly from
  Cloudflare; fresh clones should work without an extraction step.
- **Choice:** committed SVGs under `frontend/src/assets/marks/`,
  bundled by Vite via the `MARK_ART` map: 13 derived from Twemoji
  (CC-BY 4.0 — attribution in each file and the README) recolored to
  the game's mark palette (blue spade/club, five shoe colorways, blue
  rice bowl), plus two hand-drawn originals where Twemoji has no
  matching subject (the juice glass and the chocolate cake). Same
  visual vocabulary as the game's set, audited tile-by-tile against
  design.u-ma.org's badges. This partially reverses #10 for marks
  only: committable art means the extraction tool, the per-id 404
  tracking, and the fresh-clone fallback path all go away — `MarkIcon`
  keeps just the numbered chip for ids outside the committed set.
  Character portraits stay on #10's fetch-per-clone model; they are
  the game's art and never committable.
- **Rejected:** keeping the extracted PNGs — serving the game's
  copyrighted sprites from a public deployment is a worse legal
  posture than fan-tool local use, and the gitignored art made every
  clone start with numbered placeholders; a fully hand-drawn set —
  built first, but the organic glyphs (sneakers, clasped hands) kept
  reading as blobs at badge size next to professionally drawn art;
  AI-generating the set — output is raster or needs vector tracing,
  with no quality or license guarantee over an established CC-BY set;
  an icon font / sprite sheet — 15 tiny files bundled by Vite need no
  packing infrastructure.
- **Would change my mind:** the game exposing officially licensed
  assets for fan tools — parity with in-game art beats our
  approximations; dozens more marks would revisit per-file imports.

## 23. Base aptitudes as a per-card master.mdb artifact

- **Requirements:** the deep-tree designer shows each lineage node's
  career-start aptitude letters and how inherited pink sparks raise them,
  so the backend needs every playable card's ten base aptitudes
  (turf/dirt, sprint/mile/medium/long, front/pace/late/end); regeneration
  must follow the game's patches without a uma.moe key; committed data
  stays deterministic offline (#6).
- **Choice:** `app/data/aptitudes.json`, `card_id -> ten letters`, built
  from the local client's `card_rarity_data` on the keyless `--mdb-only`
  path (same posture as relations/races: gameless or empty reads keep the
  committed file). Keyed per **card**, not per chara — Haru Urara's New
  Year outfit runs Mile A against her base card's B, the one variance in
  the current table but proof the model must be card-level. Letters are
  stored (not the 1–8 scale) so the file is self-describing; the builder
  refuses to regenerate on an unknown numeric value or on a card whose
  rarity rows disagree, both of which mean the scale or the
  one-entry-per-card model changed.
- **Rejected:** extending cards.json — it's built on the network path
  from uma.moe artifacts that don't carry aptitudes, and merging
  mdb-sourced fields into it would give one file two regeneration
  stories; chara-keyed storage — provably wrong (above); numeric values
  with a frontend letter map — two places to keep the scale.
- **Would change my mind:** aptitudes appearing in a uma.moe artifact
  (fold into the cards build); a card whose rarity rows legitimately
  differ (re-key on card_id + rarity).

## 24. Repo private while it carries game-derived data

- **Requirements:** the committed reference data (relations, races,
  aptitudes, factor/skill names) is extracted from the game client and
  redistributing it is a plain-reading breach of Cygames' EULA
  (Art. 5(3) "may not copy … distribute … the Content", Art. 11(2)(14)
  on disassembly) — a contract exposure, not a copyright one; the
  deployment milestone only requires the *frontend* to be public.
- **Choice:** repo visibility flipped to private (2026-07-30). The data
  stays committed — the offline/deterministic invariant (#6) and CI are
  untouched; the change removes the public-redistribution posture while
  the fan-tool ecosystem norm (uma.moe, GameTora, hakuraku all publish
  the same data openly) remains merely tolerated, not permitted.
- **Rejected:** keeping the repo public — no upside today; per-machine
  regeneration of all game data (icons model) — breaks CI and the
  committed-data tests for a risk the private flip already covers.
- **Would change my mind:** wanting to open-source the tool — revisit
  by splitting data out or accepting the ecosystem-norm posture;
  Cygames publishing fan-tool guidelines that bless static data use.

## 25. Blueprint document v2: 31-node tree, anonymous deep sparks

- **Requirements:** the deep-tree designer (V1 aptitude calculator)
  needs four ancestor generations, because a trained node's career-start
  bracket math sums the pink sparks of the two generations below it —
  gen-1/2 letters need input from gens 2–4; the game stores only two
  generations per veteran, so gens 3–4 can never reliably carry an
  identity; base letters are per-card (#23), so the trainee needs a
  card_id; designs stay persisted in Postgres (#16).
- **Choice:** the `slots` document becomes the 31-node breadth-first
  tree (node *i*'s kids at *2i+1*/*2i+2*): `named`, exactly 7 entries
  ([0] trainee, [1–2] parents, [3–6] grandparents), each the full #16
  slot snapshot plus one typed pink spark; `sparks`, exactly 24 entries
  (tree indices 7–30), bare `{aptitude, stars}` with no uma identity —
  they exist only to feed the brackets above. A spark is single, never
  a list: every lineage member carries exactly one pink (verified
  against a real dump — 159/159 veterans, 954/954 lineage members).
  The trainee moves into named[0] and the `trainee_chara_id` column is
  dropped; a trainee spark is rejected (nothing is bred from it). Array
  lengths are exact-or-422 — the document is positional, and a short
  array would silently shift every slot below the gap. The old 6-slot
  blueprints are **wiped** by the migration (v1 rows only — the DELETE
  keys on the missing `named` field, so v2 documents written against a
  not-yet-migrated database survive it, and downgrade keeps them too).
  The catalog serves `cards` (`{card_id, outfit, aptitudes}`) instead
  of bare card ids, and drops the two 7-digit NPC/tutorial copies —
  they duplicate a real card's chara and outfit label with no aptitude
  rows, an indistinguishable letter-less pick (review-driven; aptitudes
  stay nullable against a cards.json regen outrunning aptitudes.json).
- **Rejected:** migrating 6-slot docs into the new shape — they carry
  no typed sparks, so the copies would be empty shells in a calculator
  whose whole point is spark math, saving a handful of one user's
  drafts; named identity in gens 3–4 — the game can't supply it and the
  UI treats those nodes as spark bundles by design; spark lists per
  slot — the one-pink fact makes lists pure ceremony; extending the
  keyed p1/g11-style map with 24 more names — index arithmetic
  generalizes the validators and the frontend math, names don't.
- **Would change my mind:** the game exposing deeper lineage (named
  deep slots become possible and the anonymous tier shrinks); a
  feature needing non-pink sparks in the document (the editors are
  pink-only by ruling — the spark shape gains a kind field then).

## 26. Designer v1: client-side bracket math, map + focus panel

- **Requirements:** show every named node's computed career-start
  letters over the 31-node document (#25) using the verified bracket
  table (total matching ★ over a node's two generations below:
  1★/4★/7★/10★ → +1/+2/+3/+4 letters, cap A, deterministic); 31 nodes
  can't all show full detail at once, but configuration problems must
  surface without clicking through them; v2 of the designer (roster
  fills, run affinity, inspiration estimates) must layer on without
  rework.
- **Choice:** replace `/designer` wholesale with the Option-C layout
  from the mockup pass: a vertical 16-column pedigree map (a node spans
  its children's columns; named chips on gens 0–2 carry the full
  ten-letter grid, gens 3–4 the single spark) beside a docked
  focus panel that reads and edits the selected node; ≤860px the map
  collapses to a horizontal strip above the panel (the run-navigator
  degradation). The map **fills its column** rather than sizing to its
  content: between the phone breakpoint and ~1150px its intrinsic width
  (735px, set by the sixteen gen-4 tracks) exceeds the column
  (544–688px), and compressing the tracks beats pushing a whole
  grandparent off the edge behind a scrollbar — on an overview surface,
  structure is the payload. The compression lands almost entirely on
  the empty slot's "Aptitude" placeholder, which carries no
  information; real spark labels ("Mile", "Medium") still fit at the
  41px columns a 1024px window gives. Abbreviating the gen-4 labels
  instead — what an earlier laptop-width pass did — is not a fix:
  measured per-generation intrinsics are gen-2 57px/column, gen-4 44,
  gen-3 39, so removing gen-4 from the running only moves the map to
  713px before the gen-2 letter grids take over. All bracket math is
  frontend-pure (`aptitude.ts`) —
  deterministic integer arithmetic over data the client already holds
  (catalog per-card letters + the design), so no endpoint and no
  debounce; the backend's job stays document validity and reference
  data. Display rulings (Jason): the letter cell shows the **final**
  letter only, boosted = highlighted, no strikethrough — cause math
  ("7★ → +3") lives in a From column; stacking past the 10★ bracket
  max and bump past the A cap are both un-warned — the From column
  just reports the stars behind a letter and says nothing about the
  excess, because overstacking is deliberate S-fishing (every matching
  spark is an independent inspiration-proc ticket, so it is not a
  mistake to flag). *(v2 note: past-cap originally got a soft "+N past
  A" annotation. It was cut — the row already read "12★ → +4 · +4
  past A", two numbers that cancel, and calling the excess waste
  contradicted the very reason it was left un-warned.)* The one real
  warning is a typed gen-1/2 pink whose own
  aptitude resolves below A = red "undroppable" (the game only
  generates pinks at A) — advisory, not a proof of impossibility,
  since a mid-career inspiration can lift the aptitude to A after
  career start — and not checkable on anonymous slots by design;
  map chips carry that badge; the trainee gets no spark editor
  (nothing is bred from it)
  and editors are pink-only. v1 picks are catalog-only and card-aware
  (outfits differ — #23); the affinity panel is gone until v2 restores
  it (the endpoint stays). `fromApi` parses catalog slots only —
  roster/lineage shapes are future documents this client treats as
  unknown, since the #25 wipe emptied the table and nothing else
  writes them. A re-pick keeps the slot's typed spark: the pink is a
  plan input, not part of the card's identity. Persistence reverses
  #19's explicit-Save ruling outright: **there is no unsaved state**.
  The page opens a blueprint on load — the one it had (a route
  round-trip), the one last open here, the most recently updated, or a
  brand-new row created on the spot if the table is empty — and every
  edit autosaves by debounced PUT (800 ms, so a burst of picks is one
  request). "+ New Blueprint" creates the row immediately, named
  "Untitled Blueprint" for the first (a lone " - 1" is noise when
  there is nothing to be the first of) and "Untitled Blueprint - N"
  after that, numbering from 1 and always taking the lowest free
  number — so deleting "- 1" of three reuses 1 rather than counting
  upward. Deleting the last blueprint creates a fresh blank
  rather than leaving the designer on nothing: it has no empty state
  to fall back to. localStorage holds only the id of the open
  blueprint, not a document — durability is the server's job.
  Removing the Save button removes the user's ability to make saving
  happen, so the autosave carries that guarantee itself, as a write
  queue rather than an effect: pending bodies live in a ref keyed by
  the row they belong to, not in the debounce closure, and every
  identity change (switch, new, duplicate, unmount) flushes them
  first — cancelling a pending write on the way out of a blueprint
  loses exactly the edits the user made most recently. Writes are
  serialized, so a slow PUT can't land after a newer one and restore
  an older document under a "Saved" label; a write that resolves after
  a switch may update the list but never marks the newly opened design
  clean. A design with no row (failed bootstrap, unparseable document,
  failed post-delete create, or a row deleted from another tab — a
  404) is **created** rather than dropped, so "nowhere to save" is
  never a state where later edits vanish. A blank name saves as
  "Untitled Blueprint" instead of suspending the autosave: the server
  rejects an empty name, but not saving is worse than saving under the
  placeholder, and the field is normalized on blur so it agrees with
  what was stored. Failures are visible ("Not saved", with the reason
  on hover) and retried on a widening delay — silent-until-the-next-
  edit was indistinguishable from a healthy save and could cost an
  afternoon, while a toast per attempt would be unusable with the
  backend down. The save bar is one picker plus a
  Saving…/Saved status: no Save button at all, since a button that
  does nothing new invites doubt about whether the work is safe. It's
  an editable text field with a caret, not a `<select>`: the field IS
  the name, so renaming is typing where the name already is, with no
  mode and no Rename button, and the menu lists only the OTHER
  blueprints plus "+ New Blueprint" — the one you're in is already in
  front of you. Duplicate and delete are icon buttons beside the
  status rather than menu rows: they act on the blueprint you're in,
  which is what the bar is about, and the menu stays a list of places
  to go. Duplicating copies the design as it stands on screen (not the
  last autosaved body, so an in-flight edit rides along) into
  "X (copy)", then "X (copy 2)". The picker spans the row — it names
  what you're editing — and the menu matches its width exactly and
  joins it at a squared-off seam, because they are one control:
  focusing the name field opens the list, so reaching for the name and
  reaching for another blueprint start the same way and the caret is a
  shortcut rather than the only door. Both the field and the menu rows
  carry the blueprint's trainee icon (a fixed-size blank holds the
  space when there's no pick yet) — the trainee is what a plan is
  about, and it tells two "Untitled Blueprint - N" apart at a glance.
  The autosave status sits after the icon buttons, not before: it
  changes width as it flips between Saving… and Saved, which between
  the picker and the buttons would shove the buttons sideways. For the same reason a
  named slot's `chara_id`/`card_id` are nullable (a v2-document
  amendment): planning starts from the sparks you're hunting, so a
  parent or grandparent can carry its planned pink before anyone is
  cast in it, and the bracket math — which only reads the pinks below
  a node — works at once. Such a slot must actually carry a spark
  (an untouched node stays a null slot, so the unsaved-changes check
  stays honest), identity is all-or-nothing, and a slot naming no
  character sits out every chara rule on both sides.
- **Rejected:** server-side letter computation — a network round-trip
  and stale-result debouncing for pure local arithmetic;
  popover editors on the map — the panel exists so the chart never
  needs them; strikethrough old→new letters — ruled out in favor of
  final-letter-plus-From; keeping the old run-affinity panel rendered
  beside the calculator while its roster inputs are absent — dead
  weight that v2 restores properly, trainee-only.
- **Would change my mind:** v2's roster fill lands (roster/lineage
  slot parsing and the affinity panel return); letter math turning
  out to vary by card in ways aptitudes.json doesn't capture (would
  force a backend authority); the compressed tracks between 860 and
  ~1150px proving unreadable in use rather than merely tight — the
  next lever is the named chips' letter grid, which is the constraint
  behind the gen-4 tracks, and after that raising the half-tree
  breakpoint so the full tree never renders in that band.

## 27. Designer e2e suite in CI, as-is and dev-served

- **Requirements:** the 94 designer checks — the only thing that
  catches the autosave data-loss class of bug (#26), which last round
  had to be found by reading a diff — must run on every PR instead of
  when someone remembers; the suite must stay safe to run against a
  real local database; a headless-only failure must be diagnosable
  without reproducing it locally.
- **Choice:** move `verify-deep-tree.mjs` from an untracked local
  working directory (unversioned and unshared, so it would die with the
  machine) into tracked `frontend/e2e/`, run by
  `npm run e2e`, plus an `e2e` CI job on a `postgres:16` service.
  **Kept as a plain `.mjs` script rather than converted to
  `@playwright/test`.** The suite is one stateful narrative: a single
  `try` spans ~500 lines, the cast is constraint-solved once against
  `/api/catalog`, and one blueprint is mutated across ~18 sequential
  sections whose later assertions ("reload reopens the same
  blueprint", "duplicate", "route round-trip keeps the working
  design") read state the earlier ones built. Splitting it into
  isolated `test()` blocks means inventing fixtures that reconstruct
  mid-narrative state, and the final "no JS errors or failed requests"
  check has to distinguish the run's two deliberate network breaks
  from real ones — a distinction that only exists inside one
  continuous run. (That filter was originally an `i >= noiseFrom`
  index into the error array, which classified every later HTTP
  failure as expected noise; #28 replaced it with explicitly flagged
  windows.)
  **Served by `npm run dev`, not `build` + `preview`.** The production
  bundle is already covered by the `frontend` job's `npm run build`,
  and serving it here would register the PWA service worker
  (`registerType: "autoUpdate"`, inert in dev): Playwright's
  `page.route` does not intercept requests issued through a service
  worker, and the suite's last two checks deliberately abort
  `**/api/blueprints/**` to assert the "Not saved" → auto-recover
  path. Preview would have quietly stopped testing what those checks
  claim to. So `vite.config.ts` keeps `server.proxy` only — no
  `preview.proxy` was added. What replaces `@playwright/test`'s traces
  is `E2E_ARTIFACT_DIR`: on failure the script screenshots **at the
  moment of the failing check** (the narrative has moved on by
  `finally`), capped at five and serialised through one promise chain,
  and always writes an `e2e-results.json` carrying pass/fail counts,
  each failure, and the raw error log — CI uploads that plus both
  server logs. Verified end-to-end by injecting a forced failure: exit
  1, a full-page screenshot of real app state, and the other 94 checks
  unaffected. The job is **required from day one** — a
  `continue-on-error` job gets ignored within two PRs, and the
  artifacts make the first CI-only failure actionable. Readiness is
  polled (`curl` until-loops on `/api/catalog` and `:5173`, 90s cap,
  dumping the server log on timeout) rather than slept, and the dev
  server takes `--strictPort` so a busy 5173 fails loudly instead of
  drifting to 5174 while the poll waits. The suite's self-restoring
  `finally` is kept even though CI's database is disposable — it is
  what makes `npm run e2e` safe against your own data — but it deletes
  by **ownership, not by list-diff**: a plain "delete everything absent
  from the startup snapshot" also matches a blueprint saved from
  another tab during the ~2-minute run, which is data loss rather than
  restoration. Ours are the `bpName`-prefixed rows (the timestamp makes
  that unambiguous) plus ids claimed at each create; anything else that
  appeared is reported and left alone. The whole loop is wrapped,
  because a throw in `finally` would replace whatever the run was
  actually failing on with a network error.
- **Rejected:** converting to `@playwright/test` — a ~500-line
  restructure of the only regression net for the designer, before it
  has ever run in CI; the middle option of keeping the `.mjs` and
  wrapping it in a `test()` for `webServer` — the runner instruments
  its own browser, not a shelled-out child's `chromium.launch()`, so
  it buys server orchestration but not the traces that were the whole
  point; committing a personal roster dump to unlock the further
  local suites that cover the roster surface and so read
  `/api/veterans` — those need a synthetic fixture built from
  `make_veteran()`/`make_lineage_member()` (`tests/test_ingest.py`),
  deferred as phase 2; a fixed `sleep` before the run.
- **Would change my mind:** CI-only failures that the screenshot and
  results JSON don't explain — the next lever is `@playwright/test`
  for real traces, and the narrative would have to be decomposed
  then; the suite proving flaky in CI despite many stable local runs
  (drop to `continue-on-error` while it is diagnosed rather than
  deleting the job); phase 2 landing, which adds a roster fixture and
  a seeding step and may argue for one shared harness; the PWA
  service worker becoming something worth exercising end-to-end,
  which would mean a separate preview-served job rather than
  switching this one.

## 28. Roster pulls are additive, and overwrite only after asking

- **Requirements:** designer v2 brings back pulling real veterans out
  of your roster, which rewrites a whole branch of the tree from one
  pick — the node itself and everything descended from it. It
  must not take away manual entry, which stays the primary path and
  the only one that works before you have imported anything; it must
  not silently destroy work a pull lands on top of; and the roster
  path has to be covered in CI from the moment it exists, which the
  suite could not do while the database it runs against was empty.
- **Choice:** four rulings, all in one PR because they only make
  sense together.

  **The picker gains a source, it does not change one.** Catalog is
  the default whether or not a roster exists, and the tab strip only
  appears when there is something to pull. A plan that starts from the
  pinks you are hunting has to work against an empty roster, so the
  pull is the shortcut and never the entry point.

  The designer does **not** fetch the roster; it takes the shell's,
  the same list the roster page renders. Fetching its own cost the
  largest response in the app twice and — because the import button is
  in the header on every route — froze it at mount, so a pull after an
  import would snapshot a veteran the full-replace had just deleted.
  The shell already refetches after every import, which is the only
  place that invalidation can correctly live.

  The roster tab is the roster page, not a second implementation of
  it: the same `VeteranCard` (rank badge, favourite mark, rating or
  spark strip), the same sort control, and the same `FilterPanel`
  lifted above the picker. Its sort and filters are the picker's own
  and are not persisted — narrowing the list to find one mare must not
  silently reorder the roster page you go back to. There is no name
  search on that tab; the catalog keeps one, because it is the only
  way to find one of ~95 characters and has no filter panel.

  **A pull replaces a branch; it does not patch one.** Pulling a
  veteran into a node empties that node's entire subtree and then
  populates as much of it as the dump carries. A veteran's dump has
  six succession members: positions 10/20 are its parents, 11/12 and
  21/22 theirs — so a pull reaches two generations, filling the node's
  two kids (from 10/20) and four grandkids (from 11/12/21/22).
  Everything below that is emptied. **Filling only the six slots it
  has data for would be a correctness bug, not just untidiness:** what
  sits under a node IS that node's ancestry, so leaving the previous
  plan's generation-4 sparks in place would feed the *new*
  grandparents' career-start brackets from a pedigree that no longer
  exists — a wrong number rather than a stale one. Same reasoning for
  a dump short of a member: that node is emptied, because the veteran
  genuinely has nobody there and showing the old pick would be a false
  answer rather than a partial one.

  A blueprint grandparent is the parent veteran's *parent*, never its
  grandparent — the classic off-by-one-generation error, and the thing
  `pullTargets` exists to state once.

  **Every node but the trainee takes a pull.** The trainee is the
  horse you are about to train: not in your roster, that being the
  point of it, and a pull there would be the single click that empties
  all 31 nodes. Its picker offers catalog only, with no note
  explaining the absence — nobody expects to find the horse they are
  about to train in a list of ones they already have. Deeper targets
  simply reach less: a pull into a generation-3 slot fills its two
  generation-4 kids, one into generation 4 fills nothing. That falls
  out of the bounds check in `pullTargets` rather than needing a rule.

  **A generation-3/4 slot holds a pink, a character, or both.** It
  used to hold only a pink, which made those nodes anonymous. They now
  keep the member's `card_id` at every depth the dump reaches — the
  identity arrives in the same fetch, so discarding it would mean
  loading real data to throw it away, and it is what puts a portrait
  on a node with no room for a name. A character can also be picked
  there by hand, before its pink is decided, exactly as one can be
  cast into an empty parent.

  The document shape stayed **flat** — `{aptitude?, stars?, card_id?,
  source?}`, aptitude and stars set together — specifically so every
  row written before those fields existed is already this shape and
  parses unchanged: a Pydantic widening, **no migration and no
  compatibility shim**. Nesting the pink under the identity would have
  read cleaner and broken every saved blueprint.

  `sparkAt()` still answers "the pink here" and returns null for a
  face-only slot, which is why the bracket math, the window scan and
  the undroppable check needed no changes at all — "no pink here"
  already meant "contributes nothing".

  **The tree rules reach every node.** No node may repeat the
  character directly above it; two nodes sharing a parent must differ.
  Both used to stop at the grandparents because nothing below named a
  character. They now run over all 31 indices on the server, with the
  picker greying out illegal picks to match. Still allowed, unchanged:
  a grandparent repeating the *trainee* (the game permits it), and
  repeats across branches — only the direct line and the pairing
  matter.

  **A pulled branch is read-only.** Everything under a roster pick is
  that veteran's recorded pedigree, so it has no Replace, no Clear and
  no spark editor — editing it would leave the tree asserting
  something false about a horse you own. Her own pink is fixed for the
  same reason; her *identity* stays replaceable, because swapping
  which veteran sits in a slot is a plan decision. The lock is derived
  by walking up for the nearest roster ancestor, so it survives a
  reload and releases the moment she is cleared or replaced — which is
  the way out. Enforced in the state updaters, not just by hiding
  controls.

  **Clearing or replacing a roster pick takes her branch with it.**
  Those nodes are her ancestry; leaving them would hang a pedigree
  under nobody, and unlocked, since she was the lock. No confirm,
  because nothing hand-authored can be down there — the branch has
  been read-only since the pull.

  **The overwrite confirm is conditional, and native.** Because a pull
  clears a whole branch, the prompt covers that branch and not merely
  the nodes it writes. Empty nodes go silently; nodes an earlier pull
  filled go silently (never hand-authored, so nothing to lose); only
  your own work prompts, in **one** dialog per pull naming all of it.
  A dialog per node would be worse than no protection — people learn
  to dismiss blind, and then the guard is decoration. `window.confirm`,
  matching the designer's existing delete and discard prompts rather
  than inventing a modal.

  Declining leaves the picker **open**, on the list you were already
  looking at. The confirm is raised on the way to a pick, so closing
  first would make Cancel cost the search and filters that found the
  veteran — a decline is a change of mind about one candidate, not
  about picking at all.

  The node you aimed at is excluded when it already holds a roster
  pick: swapping one veteran for another is the action you just took,
  and since the lock guarantees the rest of that branch is the
  previous pull's work, naming it would put a dialog on every re-pull
  reading only "the thing you asked to replace will be replaced". It
  stays in the list when it holds a catalog pick or a typed pink,
  which are work you would lose.

  What marks a node as the pull's rather than yours is an explicit
  `source` on the slot, at every depth. Deep slots first inferred it
  from position — an identified spark sitting under a roster node —
  which held only while a pull was the sole thing that could set an
  identity. Letting you pick a character there by hand broke that, so
  the slot now says so outright; the positional rule survives as a
  fallback for rows written before the field.

  **Three letter modes, one per source.** A node's aptitudes are
  arrived at differently depending on where it came from, and the From
  column says which: a catalog pick **projects** (card base plus the
  brackets its window earns, `6★ → +2`); a roster pick **reports**
  what she actually trained to, read off her own record (`as
  trained`); a pulled lineage member **states her card** and no more
  (`card base`).

  Projecting a roster pick was a real bug, not just noise: her career
  already consumed whatever her parents passed down, so running the
  brackets over the ancestry the pull had just filled counted the same
  inheritance twice — and capped at A a mare who finished at S. Her
  letters are snapshotted onto the slot like her won saddles, so a
  veteran who leaves the roster keeps the numbers she was scored on.

  The mode follows the slot's `source`, never "are the letters
  present" — a roster slot whose snapshot is missing (a pull older
  than the field, or a dump value off the 1..8 scale) falls back to
  `card base`, which understates her, rather than to the projection,
  which is the double-count above wearing a forecast's clothes. The
  snapshot is all ten letters or none, enforced on both sides: the
  client refuses to read a partial map, so a server that accepted one
  would store a blueprint the designer could never open again — and
  the designer is the only way to edit one.

  Lineage members get no projection because there is nothing honest to
  project from: the dump gives them no aptitudes, and their own
  bracket window is missing two thirds of its slots *permanently* —
  the game stores two generations per veteran, so their grandparents
  are not in the data, and the branch is locked so you cannot fill
  them either. The old display ran the brackets anyway and produced a
  floor that rendered identically to a real forecast. The same
  truncation is why the undroppable-pink warning is now **catalog
  only**: a roster or lineage node's pink came out of a dump, so it
  demonstrably dropped, and flagging it against a permanently
  truncated projection fired constantly and was wrong every time.

  **e2e phase 2 ships here, seeded in CI only.** A committed synthetic
  dump (`backend/tests/fixtures/roster.json`, eight veterans with full
  pinked six-slot lineages) is imported by a CI step before the suite.
  **The suite never imports it itself** — an import is a full-replace
  snapshot (#3), so seeding from the suite would destroy a real local
  roster, and "safe against your own database" is the property that
  makes `npm run e2e` worth running locally at all. The suite instead
  derives its roster cast from `/api/veterans` by predicate, exactly
  as it already derives its catalog cast, and skips the roster section
  when nothing usable is there. `E2E_REQUIRE_ROSTER=1` in CI turns
  that skip into a hard failure, so a broken seeding step cannot read
  as a green run. The fixture is data, so `tests/test_fixtures.py` is
  what defends its shape — a reference regen dropping one of its cards
  fails the backend job loudly instead of the e2e job hours later with
  an opaque selector timeout.

  Two review follow-ups from #19 ride along, both in code this PR
  already opened: the deliberate-network-break windows are now flagged
  explicitly instead of by an index into the error array (the old form
  classified a genuine 500 during the persistence section as expected
  noise — a false-*green* risk in the highest-value checks), and the
  three top-level fetches check `res.ok` and report status + URL
  instead of crashing with `SyntaxError: Unexpected token '<'`.
- **Rejected:** filling only the nodes the dump reaches and leaving
  the rest of the branch as it was — the first cut did this, and it
  leaves the new grandparents' brackets fed by the pedigree they
  replaced; replacing the catalog picker with a roster one, or
  defaulting to roster when a roster exists — manual entry is the
  primary path and a mode that changes under you is worse than a tab;
  prompting per node, or prompting on every pull — the first trains
  people to dismiss, the second makes the guard meaningless; an in-app
  modal — more code and a second confirm idiom in a page that already
  has one; deferring generation-3 identity to a later PR — it arrives
  in this fetch, so deferring means discarding it; inferring a deep
  slot's origin from `card_id`'s presence rather than storing it — it
  held only while a pull was the sole way to set one, and stopped the
  moment those slots became hand-pickable; nesting the pink under the
  identity, which reads cleaner and breaks every saved blueprint;
  seeding the fixture from inside the suite so local runs cover the
  roster too — it would wipe a real roster, and no coverage is worth
  that; committing a real dump as the fixture (#24 keeps game data
  out, and it is personal data besides); showing a pulled lineage
  member's projected letters marked `≥` — a true lower bound, but on a
  quantity nothing reads, and ten rows of hedging for information that
  changes no decision; hiding those letters entirely, which discards
  the card base we do know and breaks the map's uniform geometry.
- **Would change my mind:** the one-dialog-per-pull summary proving
  unreadable once pulls routinely hit five or six hand-authored nodes
  (then an in-app modal listing them with their contents earns its
  keep); a lineage member legitimately carrying more than one pink,
  which would make `pinkOf`'s "strongest wins" a real ruling rather
  than a defensive tiebreak; the fixture's eight veterans proving too
  thin for the three roster suites still to be ported (extend it
  rather than importing a real dump); wanting the roster section
  covered on local runs too, which needs a second disposable database
  rather than a seeding step; `card base` reading as too pessimistic
  on a pulled grandparent — the next lever is flooring the row she
  demonstrably dropped a pink in at A, which is derived from a rule we
  already trust rather than projected.

## 29. Affinity attributed per ancestor: two decompositions, one each

- **Requirements:** designer V2 restores the run-affinity readout the
  V1 rewrite dropped, and the inspiration-proc estimates that follow it
  (#26's deferred list) roll a chance *per ancestor* against that
  ancestor's affinity. `app/affinity.py` attributed only whole parent
  sides (`p1_affinity` / `p2_affinity`), which is the wrong grain: a
  grandparent's proc would be rolled against a number four links wide.
- **Choice:** one `node_affinity(node)` helper covering all six slots,
  driven by two constants (`PARENT_GRANDPARENTS`, `GRANDPARENT_PARENT`)
  that describe the tree once. A parent's share is its pair link with
  the trainee plus both of its triples and both of its win links; a
  **grandparent's is the one triple and the one win link it appears
  in** — its own `rel3(T, P, GP)` plus its `P–GP` race overlap. The
  four new `g*_affinity` fields are **additive** on `AffinityOut`, so
  the response only grew. Every rule the totals already encode is
  reused rather than restated: a voided sibling grandparent attributes
  nothing, a grandparent repeating the trainee keeps its wins and loses
  its triple, and a grandparent whose parent slot is empty attributes 0
  — while an *unfilled* slot stays `null`, because "nobody there" and
  "there and worth nothing" are different rows in the panel. **The p1–p2
  link counts into BOTH parents' shares** — relation points and win
  bonus alike, deliberately double-counted; #15 records the measurement
  that settled it.

  **There are two decompositions, and each answers a different
  question. Both are needed; neither is a view of the other.**

  - **Individual affinity (`*_affinity`, the API).** Every link the
    ancestor appears in: a parent gets her pair link, both of her
    triples *and* the p1-p2 link; a grandparent gets the one triple it
    sits in. A grandparent's number is therefore *contained in* its
    parent's, the p1-p2 link lands in both parents, and the six sum to
    the total **plus** that link rather than to the total. This is the
    **proc-roll** quantity: an inspiration is rolled per ancestor, and
    the composition is measured, not chosen (#15).
  - **Owned-link (built, then withdrawn — see below).** Every term
    belongs to its deepest participant: a parent gets only her pair link
    with the trainee, a grandparent its triple. Nothing is counted
    twice, and the six values plus the `p1-p2` link equal the total
    exactly. This is the
    **contribution** quantity — "what does this uma add?"

  **The map shows individual affinity on every named node**, with the
  composition in the focus panel — the number, then the links it is made
  of (a parent's four, a grandparent's one named rather than tabulated).
  The tiles are unsigned, because `+175` invites adding them up and this
  is the one quantity that doesn't support it.

  **Affinity leads the Details tab**, above the ten-letter aptitude table
  (moved there 2026-08-01, Jason's call). It is the node's headline
  number — the trainee's run total, or the share a proc off this ancestor
  rolls against — and the letters are detail you consult rather than the
  first thing you read. The Details/Procs switch above it is the app's
  standard `seg-group` pill, not the bespoke underlined tab bar it
  shipped with: that bar existed nowhere else in the app, and a control
  that looks unique implies it behaves uniquely.

  **Replace and Clear are icon buttons on the name row**, not text
  buttons on a row of their own — they cost a full row of a panel that
  competes with the map for height. They reuse the save bar's own
  `.bar-icon`/`.bar-icon-danger` styles and its inline-SVG icons rather
  than a private copy: the first cut forked both, which left the app
  showing two different reds for "this button destroys something"
  (caught in review). `TrashIcon` is now shared between the two.

  **Clear draws a trash can, not an ✕.** The ✕ is the app's close
  mark — the modal, a spark chip — so putting it top-right of a panel
  made an unconfirmed, un-undoable branch delete wear the shape and the
  position of "dismiss this panel". The trash can is the app's existing
  delete idiom, and moving to `.bar-icon`'s padding also took the target
  from 28px to 32px, with a wider gap from Replace than the save bar
  uses because Clear is the destructive one of an adjacent pair.

  **`aria-label` names the node, `title` doesn't.** "Clear Grandparent
  1-2" as the accessible name, because "Clear" alone is ambiguous on a
  panel you reached by clicking one of 31 tiles; "Clear this node" as
  the tooltip, because an unfamiliar icon is only discoverable on hover.
  They must differ: a `title` matching the accessible name becomes the
  accessible *description*, and screen readers then announce the node
  twice. This is the blueprint bar's convention, arrived at there first.

  Neither button renders where it doesn't apply — no Replace on a node
  with nobody in it. The residual cost stands: Clear is destructive (on
  a pulled veteran it takes her whole branch, autosaved) and an icon
  states that less loudly than a word did.

  **Owned-link was built first, shipped on the map, and then withdrawn —
  it ranks the tree wrong.** `t-p1` and `t-p2` are the only two links in
  the system that can never carry a win bonus (the trainee hasn't raced
  at design time), so attributing each link to its deepest participant
  hands every win point to a grandparent and leaves parents with
  relation points alone. On a real ◎ blueprint with 210 of its 332
  points in wins, the tiles read parents **+18/+24** against
  grandparents **+48/+50/+63/+70** — the parents, who carry 175 and 216
  individually, showing as the weakest nodes in the tree. The better the
  lineage's win overlap, the more wrong it looked; catalog-only designs
  hid it completely because `win_total` was 0.

  That also exposed the flaw in the idea: "deepest participant owns the
  link" is a convention, not a truth. A race that a parent *and* her
  grandparent both won is symmetric between them, and assigning all of
  it to the grandparent is arbitrary — which is exactly what produced
  the misranking. Additive tidiness was the only thing it bought, and
  nobody sums tiles across generations while planning; everybody
  compares slots. Correct ranking wins.

  What survives is the reason the panel exists: individual affinity
  nests (a grandparent's sits inside its parent's) and double-counts
  (the p1-p2 link sits inside both parents'), so the six do not sum to
  the total. The panel is where that is shown rather than left to be
  inferred — by the **composition table**, and only that. The two
  sentences that first sat under it ("what an inspiration proc from this
  member would roll against", and a note that the number covers every
  link she is in) were cut on Jason's call once #30 shipped: the rows
  demonstrate the nesting by listing it, and the proc chances the
  sentence pointed at are now a tab away rather than a promise.
  uma.moe carries both decompositions too —
  `getTreeNodeDirectBaseAffinity` for its tree nodes,
  `getTreeSideTotalAffinity` for its proc table — but its base omits the
  p1-p2 relation points that #15's evidence includes.

  On the map the trainee's tile shows the run total with its band
  symbol; the six ancestors are **plain and bandless** — no `+`, because
  the numbers nest and adding them up is exactly what the sign would
  invite, and no symbol, because the △/○/◎ table grades whole pairings
  and one on a single ancestor would read as a rating for her alone.

  It goes **inside the head row**, not on a row of its own: the head is
  a four-column grid whose left half is the portrait, so the affinity
  takes the right half as a two-wide tile and Turf/Dirt tuck into the
  row beneath it (portrait 2×2, affinity 2×1, each letter 1×1). That
  costs the chips no height — the head was always as tall as the
  portrait, with the track pair floating at its bottom edge. The tile
  holds its footprint with a `-` before there is a score, as empty
  cards hold their letter cells, so the map never reflows when one
  arrives. It stops at the grandparents because the game's affinity
  stops there: generations 3–4 are anonymous spark slots that appear
  in no link.

  The panel returns to the **trainee's focus panel only** (#26's
  ruling): affinity is a property of the run you are about to make, so
  hanging it off a grandparent invites reading it as that
  grandparent's own. It shows **two things and no third**: the total
  with its band symbol, and the seven-link table v1 had — now under
  column headers, because three bare numbers per row ("19 +0 19") say
  nothing about which is relations, which is the win bonus, and which
  is the two added up. Both of the panel's other candidates were built
  and then cut for redundancy (Jason, 2026-07-31): a per-ancestor
  share list, which is only the link rows regrouped, and v1's
  `Relations N + G1 wins N` summary line, which the labelled columns
  now say per link. The `*_affinity` numbers stay in the response
  regardless — 7c reads them — and earn screen space when something
  shows them. The two middle headers are abbreviated (`Rel.` / `Wins`,
  full wording on hover) because spelled out they are wider than a
  docked panel can give them and every link name wraps to two lines.
  Scoring stays the stateless `POST /api/affinity` of #17, debounced
  250 ms and aborted on the next edit, with failures reported inline
  rather than as a toast per keystroke.
- **Rejected:** replacing the two parent fields with one
  `node_affinity` map — tidier on the wire, but it churns the shape
  #15's write-up and the existing tests describe, for no reader that
  benefits; attributing the p1–p2 overlap to both parents so the six
  shares sum to the total — a nicer identity and an unverified claim
  about the game; showing the shares at all, in either of the two forms
  built (a second ~7-row table, then a compact two-column grid under
  its own heading) — a parent's share is its own link rows added up and
  a grandparent's is one of them, so both forms restated the table
  above them; scoring client-side to skip the round trip — #26
  already rejected forking the one in-game-verified implementation of
  this formula; **owned-link on the map tiles — built, shipped, and
  withdrawn the same day** for the misranking described above (its one
  advantage, that the tiles sum to the total, cost the tree its
  ordering); keeping the numbers in the panel only, which is where they
  started — the total sat under ten aptitude rows on the one node
  whose headline number it is, and the shares sat in a list that read
  as the link table regrouped. On the map neither problem exists: each
  number is on the node it describes.

  **Reversed during the build (Jason, 2026-07-31):** an earlier draft
  of this entry rejected per-node readouts on the map outright, on the
  grounds that the 31-node map has no room (#25) and the attribution's
  audience was the proc model. The room objection was wrong — the head
  row's right half was already empty space above the track pair — and
  "audience is the proc model" mistook the first consumer for the only
  one. What survives of it is the floor: no readout on generations 3–4,
  which is not a space decision but a correctness one.
- **Sources checked before settling this (2026-07-31), since 7c
  depends on it:**
  - **The Global client's `master.mdb`** (416 tables) **confirms our
    bracket math outright** — `succession_initial_factor` gives
    1–3★→+1, 4–6→+2, 7–9→+3, 10+→+4, exactly `aptitude.ts`, and
    `succession_relation_rank` gives our bands verbatim. It contains
    **no proc-rate table at all**: the seven `succession_*` tables hold
    factors, effects, brackets and relation points/members/ranks, and
    every probability column in the file belongs to gacha, racing,
    training failure or the crane game. **The affinity→spark-chance
    conversion is server-side and cannot be datamined**, so 7c's "est."
    label is the honest ceiling, not caution.
  - **uma.moe** (`umamoe-frontend/src/app/services/affinity.service.ts`)
    decomposes affinity exactly as `affinity.py` does
    (`pair`/`tripleLeft`/`tripleRight`, `legacy` = rel2(p1,p2)) — an
    independent confirmation — and implements
    `sparkProcChance = min(base × (1 + affinity/100), 100)` with
    `sparkRunChance = 1 − (1 − p)²`. Its planner feeds a parent
    `p1SideTotal` and a grandparent its own node total: **whole-side,
    confirming the split above.**
  - **Crazyfellow's guide** (already in `RESOURCES.md`) corroborates
    whole-side arithmetically: *"The chances are ~ halved compared to
    the main parent if the gene belongs to a grandparent (rough maths,
    **based on how GP compatibility is calculated**)"* — the halving
    falls out of the grandparent's smaller number rather than being a
    separate ×0.5 term, which only works if the parent's figure is the
    much larger one. It also confirms individual over overall
    compatibility (with an honest *"minor empirical concrete
    evidence"*), and that gold inspiration is cosmetic — *"only a
    placebo and it is just an indicator that a 3 star gene procc-ed"* —
    so 7c should not model it.
  - Base rates agree across both: blue 70/80/90, pink 1/3/5, unique
    5/10/15, race 1/2/3, other whites 3/6/9.
- **Both 7c forks CLOSED the same day, by two further sources:**
  - **Individual-affinity composition** — Polaris's compatibility-0
    study (`@BourBon_Polaris`, 1000 inheritances, Aug 2025; both posts
    linked in RESOURCES.md) publishes the rule outright and
    verifies it against the in-app breakdown panel: parent = pair +
    both triples + the p1-p2 link, grandparent = its own triple, p1-p2
    duplicated into both. Full quote and arithmetic in #15, which this
    resolves. The same post's predicted-vs-observed table confirms
    every base rate we had recorded (blue 70/80/90 measured 68.6/–/90.5,
    pink 3/5 measured 3.5/5.0, green 10/15 measured 9.5/16.6, white
    3/6/9, race 1/2/3, scenario 6), and shows inbred grandparents
    running normal base rates at 0pt — the exclusion, confirmed a third
    time and from the rate side rather than the points side.
  - **Events per run = 2.** Three inheritance events occur (career
    start, Classic April, Senior April), but only the second and third
    vary with compatibility — 「二回目、三回目の継承では、継承される因子の
    数やその効果が継承ウマ娘との相性によって異なります」. So `1 − (1−p)²`
    is right, and now for a stated reason rather than an assumption.
- **Would change my mind:** the nesting proving genuinely misleading on
  the map once people use it — the fallback is to reframe the tiles as
  *loss* ("lose 175" is exactly individual affinity, since emptying a
  parent kills her grandparents' triples too), where non-summing is the
  point rather than an awkwardness; a post-2026-06-24 replication — every
  measurement behind #15's composition rule predates Global's affinity
  rework, and while the rule is structural (which links compose a
  node's number) rather than constant-bound, a rework that touched
  attribution would not show up in any of it; the proc model needing a
  *trainee* share too (it has none: the trainee is in every link and a
  slot in none), which would mean the model is really about links
  rather than nodes; reaching Crazyfellow's "bonus chapter" (the
  plain-text export truncates before it) and finding base rates that
  disagree with the three records that now agree.

## 30. Inspiration procs: a Procs tab, and whites in the document

- **Requirements:** designer V2's last piece (#26's deferred list). A
  spark inherits twice over: `aptitude.ts` applies a pink's bracket at
  career start, always, capped at A — and during the run an inspiration
  may fire off one lineage member and pass her spark to the trainee,
  which for a pink is the only route past A to S. The second is
  probabilistic and scales with that member's affinity, so #29's
  per-ancestor numbers are exactly what it reads. **Framed from the
  trainee's side** (Jason's ruling): an ancestor's number is the chance
  the trainee ends up with that spark *because of her*, not the chance
  "she procs". Same quantity, and the framing is what makes it
  comparable across members.
- **Choice:** `procs.ts`, pure, reading nothing but a spark and an
  affinity share. `min(base × (1 + affinity/100), 100)` per event, and
  `1 − (1−p)²` over the run. The share is the **individual** affinity of
  #29, never the map tile: the tiles were owned-link until 7b withdrew
  them, and even now they answer a different question.

  **Non-pink sparks are now part of the blueprint document.** The
  estimates cover every spark a member carries, not just her pink — so
  `BlueprintSlotIn` grows an optional `factors: [{kind, key, stars}]`,
  the additive-only growth #28 allows (JSONB, no migration, absent reads
  as none). Kinds: **white, unique (green), race, scenario**. Roster and
  lineage picks get theirs decoded from the dump, which already carries
  them; catalog picks type them in against a new `GET /api/factors`
  (types 2/3/4/5 of the game's factor table, 432 entries).

  One general list rather than a field per kind: they differ only in
  base rate, and four parallel arrays would put the same three
  validations in four places. `kind` is **stored, not derived** from the
  key — it decides the base rate, and the key ranges separating the
  kinds are an ingest heuristic rather than a guarantee. **Key, not
  name** — names are localized strings we render, the key is the
  identity, and storing both would let a saved design disagree with the
  reference after a regen. Uniqueness is per (kind, key): the kinds
  number their keys independently. Unknown keys are accepted rather than
  rejected: `app/data` is regenerated by hand and can run behind a dump,
  and #28's strict `BlueprintOut` means one unparseable row 500s the
  whole list, so a reference gap must not become a design nobody can
  open.

  **Blue is deliberately not a kind.** Stat sparks are inherited too,
  but nothing in the designer reads them, and at 70/80/90 they would sit
  at the top of every table and never move — the ranking would stop
  telling you anything. Adding one is a line in `SlotFactorKind` and a
  row in `SPARK_BASE`.

  **A Procs tab on each of the seven named panels**, holding what each
  one is for:
  - **an ancestor's** lists her own sparks, each at the chance she is
    the reason the trainee has it, at her individual affinity —
    **ranked by that chance**, like the trainee's and for the same
    reason: which of these actually lands is the question either table
    is asked. The pink is not floated to the top; it earns its place or
    it doesn't;
  - **the trainee's** lists each distinct spark ONCE, at the chance any
    carrier lands it — `1 − ∏(1−p)` over the members holding it. Two
    members carrying the same skill is how you actually hunt one, so
    combining them is the number that decides whether the plan is good
    enough; a per-member list would leave that arithmetic to the reader
    in exactly the case that matters. **No From column** naming the
    carriers (built, then cut on Jason's call): this table answers what
    the trainee comes out with, the breakdown is one click away on each
    member's own tab, and the column cost a third of the width in a
    panel where the spark names are already the tight part.
    **No ★ level either** (cut 2026-08-01, Jason's question — it shipped
    showing the highest level among the carriers). It was the one figure
    on the table answering a different question from the number beside
    it: `chance` is the union across carriers, each computed from its
    OWN level, so a row reading "★★★ 40.6%" invites "40.6% chance of a
    3★" when 40.6% is the chance of the spark at any level and the 3★
    carrier alone is 32.8%. Which level lands is whichever carrier
    procced. The honest alternative — a row per (spark, level) — splits
    the union the table exists to show and inflates a list already
    capped at 12. Ancestor tables keep their ★: there the level is
    unambiguous, it is what that member's chance is computed from, and
    the editor that sets it is directly below.
    **Capped at 12 rows, with a "Show all N" button.** Measured on a
    fully bred tree — two roster veterans in the parents, their real
    parents behind them — the uncapped table ran to **34 rows, a 1120px
    panel against a 900px viewport** (1.2×, and a 2230px page on a
    390px phone). Capped it is 555px, 0.6× the viewport, so the tab
    stays close to Details in height and switching between them doesn't
    reflow the page. The cap is only honest because the table is ranked:
    what's hidden is always the least likely. The count rides in the
    label because "34" says how much tree is below the fold, which
    "Show more" wouldn't. Ancestor tables are never capped — a member
    holds a handful, and hiding rows on the tab where you EDIT them
    would hide what you just typed.

  **The kind is carried by colour, not by a word.** The spark's name
  takes its kind's colour and the bar beside it is filled to match, so a
  spelled-out PINK/GREEN/WHITE/RACE tag stated the same thing a third
  time and cost the names width they need — several run long enough to
  wrap. The tag survives in the hand-entry search, where you are
  choosing BETWEEN kinds rather than reading your own, and where race
  and scenario sparks share wording with skills.

  That search shows 8 matches, **ranked by where the query lands in the
  name** and then alphabetically — deliberately not in the order the
  reference arrives. `GET /api/factors` serves them sorted by (kind,
  name), so capping that order directly returned eight race sparks and
  hid every white match behind them: a systematic bias against the kind
  people search for most (caught in review). A cut list also says how
  many it dropped, so it never reads as an exhausted one — the
  difference between "no such spark" and "not shown".

  Deep gen-3/4 slots get no tab bar: the document gives them a pink and
  nothing else, so there is no spark list to type and no affinity to
  roll it against — attribution stops at the grandparents. Every named
  node has one. The tab choice **persists across node selection**,
  because comparing one view between two ancestors is the common move.
  The non-pink sparks are edited on the Procs tab (they feed nothing
  else); the pink stays on Details, beside the letters it bumps at
  career start. Map chips stay out, as V1 ruled: the 31 nodes have no
  room.

  **The tab is never gated on a score** — corrected after review; the
  first cut showed it only once that node had an affinity. The tab is
  where sparks are *typed*, not only where they are read, so gating it
  put the only editor behind the very thing you hadn't decided yet: a
  grandparent cast before her parent had no way to be given sparks at
  all, and a backend blip made the tab — and with it every spark
  already entered — disappear from the screen with no explanation.
  Display and entry needed different conditions, and one was used for
  both. Unscored chances render "—", the same "no answer is not a zero"
  rule the affinity panels follow. For the same reason the below-A pink
  warning and the lock note now render **outside** the tab switch: they
  are the panel's guardrails, not part of either view, and a persisted
  tab choice meant a warning living on Details would never be seen by
  someone reading procs down the tree.

  **A named slot may carry non-pink sparks with no pink and no
  character.** The server previously required a character-less slot to
  carry a pink ("a sparks-only husk is not a plan") — a rule written
  when the pink was the only spark the document held. With `factors` in
  it, "the parent who carries these two whites" is as real a plan, and
  the old rule had a sharper cost: because a slot carrying neither is
  pruned away, clearing the pink off such a node silently destroyed the
  spark list with it. The trainee still refuses both kinds — nothing is
  bred from her inside the design.

  **The rates, all measured** (Polaris, cross-checked against uma.moe —
  RESOURCES.md): pink 1/3/5, white 3/6/9, green 5/10/15, race 1/2/3,
  scenario 3/6/9 by ★, with blue 70/80/90 recorded for whoever adds it.

  **Every number is per RUN, and the header says so** — "Est. per run".
  The per-event chance is the model's intermediate value and never
  reaches the screen: the difference is a factor of nearly two on every
  row, so a bare percentage that could be read as either is the one
  ambiguity worth spending a column header on. It carries the hedge in
  the same two words: "est." because the rates were never datamined, and
  the tooltip names the two inheritance events behind the "per run". The
  prose caveat the first draft carried was cut on Jason's call — the
  label is load-bearing, the paragraph explaining it was not.

  **The chance is drawn as a bar in the spark's own colour**, the number
  riding on the track. Scaled **0–100 absolutely, not to the table's
  own maximum**: a relative scale ranks the rows more legibly but draws
  a full bar for a 3% spark whenever nothing else beats it, and
  "unlikely" is exactly what this table exists to say. The realistic
  range does use the space — a 3★ green on a well-matched parent runs
  past 80%, a 1★ race sits near 3%. The number sits on the track rather
  than inside the fill because most fills are too short to hold a label,
  and a number that jumps in and out of its bar as the chance changes
  is worse than one that stays put.
- **Alternatives rejected:** *a rate table by kind × ★* (what any 1/2/3★
  spark of each kind would proc at, given this member's affinity) —
  needs no document change and works before anything is cast, but it
  answers a hypothetical; Jason chose the real sparks, which is what
  makes the trainee's combined view possible at all. *Scrolling the
  long table inside a fixed-height box* rather than capping it — it
  would nest a scroll region inside a page that already scrolls, which
  on a phone means trapped touch scrolling and no skimming, and a
  fixed box hides how much is below without saying how much. Ctrl+F
  over the full list goes too. *A field per kind*
  (`whites`, `greens`, `races`) — four arrays, one shape, same three
  validations in four places; the first cut of this shipped as `whites`
  alone and generalizing it was a rename, which is the argument for
  having done it in one field to begin with. *Trainee panel only* (V1's
  ruling, and 7c's plan) — superseded first by 7b putting each
  ancestor's affinity on her own panel, then by the tab, which removes
  the panel-length objection that motivated the restriction.
  *One row per member per spark on the trainee* — see above.
  *Modelling gold inspiration* — cosmetic, an indicator that a 3★
  proc'd, not an outcome (#29). *Adding a unit runner (vitest)* — the
  repo has none, and `aptitude.ts`'s comparably load-bearing arithmetic
  is verified through the e2e suite against the rendered UI; a second
  precedent for one module would leave the older one looking untested.
  The e2e checks here therefore **do** reimplement the formula, which
  the affinity checks deliberately refuse to do — affinity has a tested
  server implementation to compare against, this has neither that nor a
  unit runner, so the suite is the only place the model is verified.
- **What would change my mind:** a post-2026-06-24 replication (every
  base rate behind this predates Global's rework, and unlike #29's
  composition rule these ARE constants, so a retune would invalidate the
  numbers without touching the shape); hand entry proving too tedious to
  bother with, which would push toward pulling a member's sparks from
  the roster by character rather than typing them (the search is
  deliberately minimal — it is an "add one" affordance, not a browser);
  blue sparks turning out to be worth showing after all, which would
  need the ranking to survive five rows that never move; anyone reading
  "est." as a formality, which would mean the hedge needs to be louder
  than one word after all.
