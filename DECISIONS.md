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
  contradicted the very reason it was left un-warned.)* *(#42
  amendment: the From column reports what the ★ **bought**, not what
  the bracket was worth — `4★ → +0 (at cap)` on a base already at A,
  `4★ → +1 (at cap)` on a B, where the bracket pays +2 and the ceiling
  allows one step. The bracket value itself is not displayed. Still
  un-warned: nothing is called waste, and "(at cap)" states the
  ceiling, which is the one fact the letter column cannot show. Would
  change my mind: users reading "+1 (at cap)" as the window's worth
  rather than its yield, which would argue for "+1 of +2".)* The one
  real
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
  first thing you read. The Details/Sparks switch above it is the app's
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

## 30. Inspiration procs: a Sparks tab, and whites in the document

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

  **Blue was deliberately not a kind** — reversed by #40 after #34
  moved the ancestor tables to kind grouping, which is the ranking
  objection's own premise gone. The original reasoning: stat sparks are
  inherited too, but at 70/80/90 they would sit at the top of every
  table and never move — the ranking would stop telling you anything.

  **A Sparks tab on each of the seven named panels** (labelled "Procs"
  until #34 renamed it; the tab id, `procs.ts` and the `.proc-*` styles
  keep the word, because the estimate it carries is still an inspiration
  proc), holding what each one is for:
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
    **Superseded by #34:** the row cap is now a 24rem height clip. Once
    the table can be sorted, no row selection stays honest — capping by
    chance and then grouping makes the button promise an append and
    deliver an interleave — so the fold stopped selecting rows at all.
    Every row renders, in the sort's order, and the panel shows the top
    of it.

  **The kind is carried by colour, not by a word.** The spark's name
  takes its kind's colour and the bar beside it is filled to match, so a
  spelled-out PINK/GREEN/WHITE/RACE tag stated the same thing a third
  time and cost the names width they need — several run long enough to
  wrap. The tag survives in the hand-entry search, where you are
  choosing BETWEEN kinds rather than reading your own, and where race
  and scenario sparks share wording with skills.

  **Superseded by #35:** the search is now a popout that browses all 432,
  favourites first. This entry's "an add-one affordance, not a browser"
  is reversed there, deliberately and in writing — it was the right
  reading of an undifferentiated list under every panel, and the wrong
  one once the list is behind a button and headed by the sparks you use.
  The ranking below survives the move unchanged.

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
  The non-pink sparks are edited on the Sparks tab (they feed nothing
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
  scenario 3/6/9 by ★, with blue 70/80/90 recorded for whoever adds it
  (#40 did).

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
  **— reversed, see the amendment below.**

- **What would change my mind:** a post-2026-06-24 replication (every
  base rate behind this predates Global's rework, and unlike #29's
  composition rule these ARE constants, so a retune would invalidate the
  numbers without touching the shape); hand entry proving too tedious to
  bother with, which would push toward pulling a member's sparks from
  the roster by character rather than typing them — **this is what
  happened**, and #35 answered it with a browser rather than a roster
  pull, the parenthetical that stood here ("the search is deliberately
  minimal — an 'add one' affordance, not a browser") being exactly what
  that entry reverses;
  blue sparks turning out to be worth showing after all, which would
  need the ranking to survive five rows that never move; anyone reading
  "est." as a formality, which would mean the hedge needs to be louder
  than one word after all.
- **Amendment (2026-08-03, issue #48): the unit runner lands, on the
  condition that reversed it.** The ruling above was right about the
  cost and wrong about its own stability: "we can't test the new one
  because the old one isn't tested" gets weaker every time a pure module
  ships and never gets stronger, and #30 had already had to invoke it
  once. Since it was written, `filters.ts` gained the legacy pool rule
  and `reconcileFilters` (#31), and `sparks.ts` (#33) landed with no UI
  at all until #35 gave it one.

  What actually changed is not the argument for a runner — it is the
  **condition**: the first PR **ports the existing modules**, it does not
  merely wire up a runner. A runner covering only new code while the
  older arithmetic stays browser-only is worse than none, because it
  looks like coverage; that was #30's real worry and it is preserved as
  the gate rather than overruled. Six modules went in together —
  `aptitude`, `procs`, `filters`, `domain`, `blueprint` and `sparks` —
  and the debt is cleared in the same commit that creates the ability to
  incur it.

  **vitest 4** (the major paired with vite 8), `environment: "node"`,
  `include: ["src/**/*.test.{ts,tsx}"]`, and its own `vitest.config.ts`
  so the React and PWA plugins are not loaded to run arithmetic. **No
  jsdom, no Testing Library, no component rendering** — the two loaders
  that touch `localStorage` stub it in ten lines, which is cheaper than
  a DOM implementation for the whole run. `.tsx` is in the glob anyway:
  a component test written despite the rule then **fails** on `document
  is not defined`, where leaving it out would have collected the file
  with nothing and reported a green run over tests that never executed.
  Tests are **co-located** as `src/*.test.ts`, because `tsconfig.json`'s
  `include` already covers `src` — co-location gets them typechecked by
  `tsc -b` for free, where a top-level `tests/` directory would need the
  list widened to get the same thing. The one thing that list *was*
  widened for is the two config files themselves: `vite.config.ts` has
  never been typechecked and `vitest.config.ts` decides which tests run,
  where a typo (`enviroment:`) silently falls back to a default and
  reports green over a different file set than the config claims.
  `npm run test` is its own
  script and **never** reaches `e2e/` — two runners behind one command is
  how the slow one gets skipped. It runs as a step on the existing
  `frontend` CI job, after `build`, so a fixture that has drifted from
  the API types is reported as the type error it is.

  **The e2e suite is untouched and stays required**, at the same
  priority: it covers the autosave write queue, the persistence
  narrative, the no-JS-errors sweep and the rendered UI, none of which a
  unit test reaches. But the reimplemented proc formula named in the
  paragraph above is now redundant — `procPct` in
  `e2e/verify-deep-tree.mjs` is a second copy of the model that
  `procs.test.ts` verifies directly, and those checks can go back to
  asserting rendered output the way the affinity checks do. **Filed, not
  done here**: shrinking the suite in the PR that introduces the runner
  would mix the two arguments.

  **What the port found**, since a port of 1,979 lines that turns up
  nothing is itself a result: **two latent defects, neither of them
  reachable from today's callers** — and both in the "degrade rather
  than crash" guards rather than in the arithmetic. `gradeClass("")`
  passed its palette check, every string containing the empty string,
  and then threw dereferencing the character it had just established
  was absent; no call site can hand it `""` today. `readOpenId` coerced
  before checking, so a stored `null`, `""` or `[]` came back as
  blueprint id 0 — harmless only because its one caller looks that id up
  in a list it already holds and falls back to "most recent" on a miss.
  Both are fixed here, and the honest accounting is that the port bought
  two corrected guards, not two fixed crashes. The models themselves —
  the bracket table and its cap, the proc rates, the union across
  carriers, the pull bounds, the branch-emptying rule, the
  source-derived locking, the document parser — were correct everywhere
  the tests could reach them. That is the more useful finding, and the
  one to weigh when sizing the next port: this arithmetic was already
  right, and what the suite buys is that it stays right.

  **What would change my mind about the runner:** a year of green with
  no regression caught, which would say the e2e suite had been
  sufficient after all; a pure module landing untested after this, which
  would mean the condition above never actually took; or a real case for
  component tests, which needs jsdom and an entry of its own rather than
  an extension of this one.

## 31. Three corrections to the designer and its filters

Issues #33, #32 and #31, shipped together: one filter bug and two edits
the designer could not express. Grouped because each is a paragraph, not
a milestone, and splitting them across three entries would file three
titles over one afternoon's work.

- **Requirements:** (a) **Legacy Sparks** widened a spark search to the
  veteran plus all six lineage slots, grandparents included. (b) The
  slot picker reset its filters to the defaults on every open, and
  filling 31 nodes against one criterion means rebuilding them by hand
  each time. (c) Once a catalog node had a character, the only way off
  her was Clear, which nulls the slot — so the pink and every non-pink
  spark typed into it went with her, and "spark set, character still
  open" was reachable by other routes but not returnable to.

- **Choice (a): the legacy pool is the veteran and her two PARENTS.**
  This is a correctness fix, not a preference. Breeding from her shifts
  every slot up a generation: she becomes a parent, her parents become
  the grandparents, and her own grandparents leave the game's 6-slot
  tree entirely — no slot, no inspiration roll, no affinity term. A
  match sourced from one is a spark that can never be inherited from
  her, so the filter was shortlisting on unreachable sparks. The rest of
  the codebase already draws the line here (`app/affinity.py` scores
  `t/p1/p2/g11/g12/g21/g22` and nothing deeper), and `relation` is
  already on the wire, so this is a filter on the existing flatMap.
  `legacyFactorsOf` in `filters.ts` is the one owner of the rule.

  **The suggestion vocabulary narrows to match** (`commonSparkNamesOf`,
  and `reconcileFilters`' own harvest, now the same helper). A name only
  a grandparent carries can no longer be matched by anything, and
  reconcile's existing rule is that an unmatchable filter is cleared
  rather than masked. Leaving it in the chooser would offer a row that
  always reports zero veterans. `reconcileFilters` builds its set from
  `commonSparkNamesOf` rather than walking the pool again, so the
  chooser cannot offer a name reconcile would strip.

  **Two costs on the first load after this ships, both accepted.**
  Persisted `legacy: true` filters match fewer veterans — the point of
  the fix. And a saved Common Sparks row naming a grandparent-only
  spark is **deleted, not narrowed**: reconcile drops it, the shell's
  effect persists that immediately, and the chooser no longer offers
  the name to re-add. Accepted because the row was selecting on
  something unreachable, which is the bug; the app is unreleased, so
  the population affected is one roster. A one-time notice would be the
  fix if that stops being true.

- **Choice (b): the picker persists its filters AND its sort, under its
  own keys** (`umalab.picker.filters`, `umalab.picker.sort`), never the
  roster page's. The original comment gave two reasons for resetting,
  and only one survives: the sets must stay independent in both
  directions, so narrowing the picker never touches the roster page you
  go back to. "Start from nothing every open" was the half that cost
  more than it saved. Loaded through the same shape validation as the
  roster's, and the filters are reconciled at mount the way the shell
  reconciles on every roster load — a card or mark filter whose target
  left in a full-replace import would otherwise open the picker on an
  empty list with no visible cause. Two conditions on that, both from
  the review: the reconcile runs **only against a roster that has
  arrived** (`veterans` starts empty and stays empty on a failed fetch,
  and the designer renders either way, so reconciling against nothing
  would strip every filter the moment the picker opened on a slow
  load), and its result is **written back**, since a filter that is
  masked rather than cleared reactivates silently on the import that
  brings its target back.

  Sort was first shipped unpersisted, on the argument that newest-first
  is the right default on every open. Jason's objection stands: the
  filters argument applies unchanged — you are filling 31 nodes in one
  sitting, and re-picking Sparks order per node is the same repetition
  — and a sort you set and see is not a state that can hide anything,
  which is the only thing that made filters worth thinking twice about.
  A default being good is an argument for what an unset key falls back
  to, not for discarding a choice.

- **Choice (c): a No Character chip — the face comes off, the sparks
  stay.** It is the **first chip in the picker's character list**, a
  dashed ✕ in the shape the filter panel's No Favorite chip already
  uses (Jason's call, across two rounds: not a third icon on the
  panel's name row, and not a text button in the picker's header).
  Taking the face off a node is an ANSWER to the question the picker
  asks, so it sits among the other answers and picking it closes the
  picker like any other pick. The name row keeps the two buttons it
  had. `withoutCharacter` is the mirror of
  `withSpark`/`withFactors`, and prunes to null when nothing is left,
  as those two do. It rebuilds the slot through `catalogSlot` rather
  than nulling the ids in place: a character-less slot may only be a
  catalog one — both this client and `app/schemas.py` reject the other
  shape — so the source and the roster-only fields have to go with the
  face.

  **Hand-picked nodes only** (`canUnselect`). What a pull placed is
  recorded history: those sparks are the horse's own, read off her dump,
  so dropping just her face would leave someone else's sparks under
  nobody. Clearing the branch stays the way out of a pull (#28). Named
  slots declare `catalog`; a deep slot records a source only when a pull
  placed it, so absent means hand-picked there. The button is also
  hidden when the node has **nothing to keep** — then it is exactly
  Clear, and two buttons doing one thing on this panel is noise. That
  keeps it off the trainee for free: she carries no sparks at all.
  Picking it closes the picker and returns to the node, exactly as
  picking a character does.

- **Alternatives rejected:** *(a) keeping the vocabulary wide* so a
  saved filter is never cleared out from under you — defensible, but it
  trades a silently-cleared filter for a permanently-dead menu entry,
  and the panel already explains a cleared filter by showing its own
  count. *Renaming the toggle* to name its generations — the tooltip
  now says it ("her two parents"), and "Legacy Sparks" is the term the
  rest of the app and the e2e suite use. *(b) persisting the filters
  but not the sort* — see above. *Sharing `FILTER_STORE`/`SORT_STORE`*
  — the reason the picker got its own state in the first place. *(c) a
  third icon button on the name row* — the first cut; three
  destructive-adjacent icons on a small panel, and it separated "remove
  her" from "replace her" when they are the same decision. *Offering it
  on a pulled node as a synonym for Clear* — two controls with one
  meaning, and it would suggest the sparks might survive.

- **What would change my mind:** (a) a filter that names WHICH slot a
  legacy match came from, or counts occurrences across self + parents —
  the toggle stays binary here and that is a bigger feature (noted on
  #33); (b) the picker's filters proving stickier than wanted, which
  would argue for a Reset in the dock rather than a reset on open (the
  sort has no such failure mode — it hides nothing);
  (c) Remove Character proving hard to find inside the picker, which
  would argue for the panel affordance after all — the objection to it
  was crowding, not discoverability.

## 32. Multi-user: Access identity and owner-scoped rows

Issue #50. The app was single-user by construction; it now has to hold
more than one. #16 named this trigger in advance — *"the platform
gaining a second user (blueprints then need an owner column and
Access-identity scoping)"* — and this is that entry.

- **Requirements:** several people use the app, each seeing only their
  own roster, blueprints and marks. Nobody writes a login screen. The
  existing single roster must survive the change. Local `uvicorn
  --reload`, `pytest` and the Playwright suite have no proxy in front
  of them and must keep working unchanged.

- **Choice: Cloudflare Access is the login, a verified JWT is the
  identity, and every owned row carries an `owner_id`.** Access already
  sits in front of both tiers on the platform plan, so the app writes
  no passwords, sessions or resets — it reads who the request is from.
  The `Cf-Access-Jwt-Assertion` JWT is the security boundary: verified
  against the team's published keys, the configured audience and the
  team issuer, with RS256 pinned rather than read from the token's own
  header. **The bare `Cf-Access-Authenticated-User-Email` header is
  never read** — anything that reaches the origin can set it, and the
  header is only trustworthy if you already trust the network path,
  which is the assumption a tunnel is supposed to remove.

  **The `CF_Authorization` cookie is not read either, and that is a
  security decision rather than an omission.** Access sets it on the
  browser, so reading it as a fallback would work — and would make
  every write endpoint forgeable from any other site, because a cookie
  is an ambient credential. `POST /api/imports` is multipart, which is
  a CORS-simple request needing no preflight, so a hidden
  auto-submitting form on an unrelated page would run a logged-in
  user's **full-replace import** and destroy their roster; the attacker
  never reads the response and does not need to. The header cannot be
  set cross-site, so header-only auth is immune without a CSRF token or
  an Origin allow-list to maintain. The cost is that a request reaching
  the origin without Access in front of it does not authenticate, which
  is the correct outcome anyway.

  **One setting decides the mode.** `ACCESS_AUD` set means every
  request must verify; empty means the app runs as `DEV_USER_EMAIL`.
  There is deliberately no third state and no fallback *within* the
  first: a deployment that has an audience refuses a request it can't
  verify rather than serving somebody's rows. A dev escape hatch that
  stays reachable in production is not a convenience, it is the
  bypass.

  **`users` is keyed by email and rows are created on first sight.**
  That is not open signup — the Access policy is the invite list, and
  everyone reaching that line already passed it. Service tokens are
  refused explicitly: they verify perfectly and carry `common_name`
  instead of `email`, so without the check every machine credential
  would share one blank-addressed user.

  **Both global uniqueness rules widen to per-owner.**
  `veterans.trained_chara_id` is the game's id for a horse in one
  player's save, so two players can legitimately hold the same one;
  under the old constraint the second importer's upload collided with
  the first's rows. `veteran_tags` keeps its constraint *name* while
  gaining the column, because the tag upserts name it in `ON CONFLICT`.

  **Another user's row is a 404, not a 403.** A 403 confirms the id
  exists, which is a row count the caller didn't have.

  **The existing rows are backfilled onto `DEV_USER_EMAIL`** rather
  than dropped: they are one person's, that person is the same one the
  app runs as locally, and a local database therefore keeps working
  with no further step. A deployment whose Access email differs sets
  `DEV_USER_EMAIL` to that address before upgrading. The migration
  adds `owner_id` nullable, backfills, then sets NOT NULL, so the
  column is never briefly non-nullable against rows with no value.

  **The migration reads that setting through `app.config`, not
  `os.environ`.** The first cut read the environment directly, to keep
  a migration from inheriting every future setting's validation — and
  that was wrong in a way that only showed up under review: the
  documented place to set it is `backend/.env`, which pydantic-settings
  loads into `Settings` and never into the process environment, so a
  configured address would have been silently ignored and every
  existing row backed onto the default while the app ran as the other
  one. A roster stranded on an owner nobody can log in as, with no
  error anywhere. `alembic/env.py` already imports `app.config`, so
  the coupling I was avoiding was already there.

  **Three routes stay identity-free** — `/api/catalog`, `/api/factors`
  and `/api/affinity` own no rows and are the same for everybody
  (#17). A structural test asserts every *other* route declares the
  dependency, because a new route that forgets it reads across all
  users and nothing else in the suite would notice.

- **The suite grows a database-backed module, `tests/test_isolation.py`,
  and that is a real exception to how this repo tests.** Everything
  else is pure-module (#26, #30) because the routers pass models
  through and the interesting logic is elsewhere. Here the interesting
  behaviour *is* the database: a missing owner filter and a global
  constraint are both invisible at every other layer, and the failure
  they produce is one user's roster disappearing when another imports.
  It needs Postgres rather than the aiosqlite path the rest could have
  used — the models are JSONB and the tag upserts are `ON CONFLICT` —
  so the backend CI job gains a service container and a second
  database. `PYTEST_REQUIRE_DB=1` turns "no database, skip" into a
  failure there, the same way `E2E_REQUIRE_ROSTER` does for the
  Playwright suite: a security invariant that silently stops running is
  worse than one never written. The module refuses outright to run
  against the app's own database, because it drops every table —
  compared by (host, port, database) rather than by URL string, since
  the same database has many spellings and every one of them would
  slip past an equality check.

  **That schema comes from `create_all`, so the same job also runs
  `alembic upgrade head` and `alembic check`.** The tests assert
  against the models; a deployment runs the migrations; nothing was
  comparing the two, which is the CLAUDE.md invariant ("schema changes
  go through Alembic, not `create_all`") with nothing enforcing it. The
  e2e job already proved the chain *applies* — these prove it produces
  the schema the models describe. Verified clean before gating on it:
  `check` reports no operations on a freshly migrated database, so it
  fails on real drift rather than on autogenerate's cosmetic opinions.

- **Alternatives rejected:** *building auth in FastAPI* — passwords,
  sessions and resets are real attack surface for an invite-only app,
  and Cloudflare already does it (platform DECISIONS #10 settled this;
  this repo is the first to implement the verifier, and per that
  repo's rule of three the shared helper waits for a third app).
  *Trusting the email header* — see above. *Scoping only the designer
  and leaving the roster shared* — leaves the destructive import in
  place, which is the actual blocker rather than a nicety. *Deleting
  the existing rows instead of backfilling* — there is exactly one
  real roster and it is the reason the app exists. *Syncing the four
  view-state stores* (`umalab.sort`, `umalab.filters`, the picker's
  pair, `umalab.designer.open`) — those stay in `localStorage`: a
  filter set on a phone is arguably wrong on a desktop, and "which
  blueprint was open" definitely is. #12 floated a settings table
  subsuming them; still not paying rent.

- **What would change my mind:** public signup, which turns
  first-sight creation into a real registration flow with everything
  that implies; a native client that can't ride a browser SSO flow;
  or a third app on the platform, which is when the JWT verifier
  moves out of this repo into a shared package instead of being
  copied a second time.

## 33. Watched sparks: one list, a hunting bit, and user-named groups

**Superseded by #37, which dropped `watched_sparks` and `hunting` entirely.**
Kept as a stub because the code still cites this entry for the rules that
outlived the table. The full text is in git history (issue #39; amendments for
issues #62, #64).

- **What it was:** one table per owner, `(kind, key, hunting, groups)`, with
  `hunting` separating "keep this handy to type" from "I want this outcome",
  and `groups` holding the user's build names as a filter over that bit. The
  group vocabulary was *derived* from the rows — a group existed exactly as
  long as a spark was in it, so there was no registry to keep in sync. The
  routes were an **upsert-by-identity PUT** on `(kind, key)`: the client could
  always name the row it wanted, because the caller supplied the identity.
  #37's lists cannot do that — a list's identity is a server-assigned id — so
  they take an ordinary POST/PATCH instead.
- **Why it was wrong:** the axis is inverted. What varies per session is which
  build you are working on, and `hunting` stored that **per spark**, so
  switching weeks meant flipping the bit across dozens of rows. Derived
  vocabulary cannot represent an empty list, silently destroys one when its
  last spark leaves, and forks `Front Runner` from `Front runner`. #37 holds
  the full argument. The bit had zero readers when this was found, which is
  the only reason the correction was free.
- **Rules that survived into #37 and are still cited from code:**
  - *No `stars` on a membership row.* The list records WHICH sparks you want,
    not what level you last typed; the level belongs to the slot document.
  - *An omitted field is left as it is* — absent and `null` alike, `[]` is how
    you clear. Arrived at in this entry's issue-#64 amendment, after a
    full-replace PUT let one of three call sites silently clobber a field it
    wasn't changing (issue #62). #37 keeps it: the rule is enforced by the
    request's shape rather than remembered at each call site.
  - *A spark in two builds renders once.* This shape got it free by having one
    row in two groups; #37 pays for it with a dedupe at read time.
  - *Keys are not validated against the factor reference* — it is regenerated
    by hand and can run behind a dump. `kind` IS closed: it decides the proc
    base rate.
- **What changed my mind:** exactly the trigger this entry named — "groups
  proving to be the primary axis rather than a filter."

## 34. The spark tables sort, and the level moves to the add

Issues #29 and #45, built together, on the premise that each removes the
other's main objection: folding a ★ control into a chance-ranked row
means the row climbs out from under the cursor as you raise the level,
and grouping by kind — which #29 wants as the ancestor default on its
own evidence — was supposed to stop that.

**The premise was half right, and measuring it is what produced the
shape below.** Grouping stops the row crossing into another kind; it
does not stop it moving, because chance still orders rows inside a kind
group. So the level left the row entirely and moved onto the search's
match rows, where choosing it is one click and nothing in the table can
reorder anything.

- **Requirements:** (a) on an editable ancestor's tab, every non-pink
  spark rendered **twice** ~30px apart — once as a ranked, kind-coloured
  row with ★ glyphs, once as an insertion-ordered white row with a
  segmented control. Nine rows for five sparks, and the two halves
  disagreed about both identity and order, so matching a row to its
  control was a scan rather than a glance. (b) Both tables sorted by
  chance only, and on an ancestor's table that ranking is degenerate:
  the affinity is a single constant there, so
  `min(base × (1 + affinity/100), 100)` makes the chance a pure function
  of `(kind, ★)`. Measured on a real pulled parent: **eight consecutive
  rows at 19.4%**, the order inside the tie arbitrary. (c) "Procs" named
  the smaller half of a tab that is more than half entry — and on a
  pulled ancestor it named a readout consulted after every decision is
  already made.
- **Choice:** **one row per spark, and the level is chosen when the
  spark is added.** The held list is deleted. The row shows the level as
  ★ glyphs in its own shrink-to-fit column and carries the ✕ that drops
  the spark; the three-button level control lives on the **match rows**
  of the search instead, so `Add a Spark…` adds at 1★, 2★ or 3★ in one
  click. `Add a Spark…` remains the single add affordance — #28 replaces
  the chooser later and inherits this ★ picker with it.

  **This reverses #45's own headline argument, knowingly.** That issue
  wanted the level set where its consequence is displayed, so changing
  1★→3★ moves a number the eye is already on. It was built that way
  first, and the objection #45 itself raised turned out to be worse than
  either issue thought: **grouping does not stop the row moving.**
  Measured with three whites on one ancestor — the ordinary case, since
  chance descends inside each kind group — raising the last to 3★ moved
  it from index 2 to index 0 of its group and left a different spark
  under the pointer. Ranked it was index 4 to 0. The second click, which
  is the natural "I meant 2★" or the ✕ beside it, then hits the wrong
  spark, and the ✕ deletes it and autosaves. The pairing premise — that
  #29's grouping removes #45's objection — holds only for movement
  *across* kinds.

  Choosing the level on the match makes the table incapable of changing
  a chance, which closes the failure at its root rather than bounding
  it. It is also **fewer clicks**: a 3★ was pick-then-correct, and is
  now one click, chosen at the moment you are choosing the spark, which
  is when you know it. #30's 1★ default — "the honest default for one
  you're planning to hunt" — was the best a single-click add could do,
  and is retired rather than overridden. The cost is that changing a
  level means dropping the spark and re-adding it; that is the trade,
  taken on Jason's call, and it is the right one only while entry
  dominates adjustment.

  **The pink row differs by lacking a ✕, not by lacking a control.**
  Its editor is on Details, beside the letters it bumps at career start
  (#26/#30), and that stays. Every row in the column now shows the same
  ★ glyphs, so the pink is simply the row that can't be dropped from
  here.

  **The column headers are the sort control.** A segmented pill under
  the Details/Sparks pill read as a second row of tabs, and cost a row
  of height on the tab #29 already says competes with the map. The two
  orders land on the two columns that carry them — kind is what the
  Spark column's colour says, chance is the Est. Per Run column itself
  — so clicking a header sorts by it, which needs no new label and no
  new row. The active header brightens and takes a caret drawn as a CSS
  `::after`, so the DOM text stays exactly "Spark" and "Est. Per Run";
  `aria-sort` announces the state (`other` for the kind grouping, which
  is a fixed five-way order rather than a direction, and `descending`
  for chance). Real `<button>`s inside the `th`, so the sort is
  reachable by keyboard. A pulled ancestor's table sorts too — hers is
  the table the eight-rows-at-19.4% measurement came off — and gains no
  editing control, which is what #28 makes read-only.

  **Both tables sort, with different defaults**: ancestor
  tables **by kind**, the trainee's roll-up **by chance**. The
  asymmetry is the point. Ancestor chances are a pure function of
  `(kind, ★)` at one affinity, so grouping is the only ordering there
  that carries information — and it is the tab where you EDIT, so a
  stable order is what makes a spark findable after you add it. The
  trainee's chance is a union across carriers at differing affinities,
  where ties are rare, the ranking is real, and #30's cap rationale
  depends on it. Type order **Pink → Green → Race → White → Scenario**
  (Jason's call), the game's own grouping, chance descending inside each
  group — not alphabetical and not the reference's `(kind, name)`, which
  buries whites behind races (the bias #30 caught in the search's cap).
  `TYPE_ORDER` numbers from 1, leaving 0 for **blue above pink**: stat
  sparks are not a kind the document holds today (#30), and when they
  are added that is where they group. Adding `blue` to `SPARK_BASE`
  won't compile until it is placed, which is deliberate.

  **The trainee's fold becomes a height, not a row count** (Jason's
  call, and it replaced two rounds of my own answers). #30 capped at 12
  rows and justified it by the ranking: what's hidden is always the
  least likely. A sort toggle breaks that, and every fix that keeps a
  row cap is a patch on the same crack — cap-then-sort keeps the
  selection honest but leaves the button revealing rows that scatter
  upward into groups the reader has already passed, so its position
  lies about where they will land.

  Folding by **height** dissolves it: `max-height: 24rem` with
  `overflow: hidden`, every row rendered in whatever order the sort put
  them. Nothing is selected, so there is no selection to keep honest,
  and `Show All 17` means exactly "stop clipping" under either sort. The
  24rem holds #30's measured target — 0.6× of a 900px viewport, so
  switching to Details doesn't reflow the page — while letting the
  visible row count float with how many names wrapped, which is what the
  constraint was ever about.

  The last visible row is **cut through and faded**, via a
  `linear-gradient` mask over the final 2.5rem, rather than snapped to a
  row edge: a block ending cleanly reads as a finished list, which is
  the exact misreading the fold has to prevent. It is a clip, never a
  scroll region — #30 ruled that out and the reasoning stands.

  **`overflow: clip`, not `hidden`, and the known cost of that.** `hidden`
  makes a scroll container, and find-in-page will scroll a match into
  view inside one: measured at 187px, which pushed the header and the
  top rows out of a box offering no way to scroll back, leaving the panel
  decapitated until something re-rendered it. `clip` cannot scroll, so
  that can't happen. The price is the other half of the same fact —
  **a find-in-page match below the fold can be reported and not
  reached**, because the rows are in the DOM (which is what makes the
  fold a presentation choice rather than a selection) and nothing can
  bring them into view but the button. Every fold that keeps its rows
  has one failure or the other; this is the less destructive one, since
  it withholds a row rather than hiding the table's own header. The
  button carries `aria-expanded` so the state is announced. What would
  remove it is `hidden="until-found"`, which auto-reveals on match — but
  it hides per element, so it would mean going back to hiding rows
  individually, which is the row cap this entry replaced.

  Whether to fold is **measured, not counted**: a `ResizeObserver` on
  the table compares its height to the clip, so the button appears only
  when something is actually hidden and re-decides when a name rewraps
  or the viewport changes.

  Both sorts **persist beside `tab`** in `FocusPanel`, for the reason
  #30 gives for the tab itself — comparing one view between two
  ancestors is the common move — and they hide nothing, being a sort you
  set and see (#31's argument for the picker's sort). Two states rather
  than one, because one would have to pick a default and lose the other.
  No gating on row count: the headers are there whatever the table
  holds, so there is nothing to show or hide.

  **What the row costs, measured.** The level column is 61px — ★ glyphs
  and a ✕ — so the names keep nearly everything. The chance bar still
  drops from 36% to 28% **on editable tables only**, leaving name 177px
  / level 61px / chance 93px at 390px, and name 122px in the **desktop
  sidebar**, which at 301px is the tighter of the two. Against all 432
  factor names measured in the cell's own font (median 99px, p90 148px,
  max 223px): **96.1% fit one line at 177px, 71.1% at 122px, and none
  needs a third line at either.** The three-button control cost 64px of
  that: while it was in the row, the sidebar had 94px of name, 46.8% on
  one line and 13 names taking three lines.

  21px of the column is a **held-empty ✕ slot on the pink's row**
  (Jason caught it on screen). She carries no ✕, so without the slot her
  ★ run to the cell edge while every other row's stop short of one, and
  a column of stars that doesn't line up reads as a rendering fault
  rather than as one row being read-only — the same reason an empty card
  keeps its letter cells and a scoreless chip keeps its affinity tile.
  It costs the sidebar 144px of name down to 122px, 88.0% one-line down
  to 71.1%, and no name gains a third line. An e2e check compares the
  right edges of every `.proc-stars` in the table, because it is a claim
  about where things are drawn.

  Nothing overflows the panel or the page at either width, and the match
  rows fit too — 237px of name beside 76px of buttons at 390px,
  unclipped. Names are **not** ellipsised: #30 gave them the width for a
  reason, and the ○ suffix that distinguishes a skill's two grades is
  the last thing on the line.

  **The locked path gains no editing, and does gain the sort.** A pulled
  ancestor stays read-only (#28) — no level column, no ✕, no search, the
  same two-column readout with ★ glyphs in the name cell that shipped in
  #30. What changed for her is the header row: it sorts, like every other
  spark table, and hers opens grouped by kind. That is deliberate rather
  than an oversight — the eight-rows-at-19.4% measurement that made
  grouping the ancestor default was taken off a pulled parent, so hers is
  the table it helps most, and a sort adds no way to change her document.

  **The tab is renamed Procs → Sparks.** Label only: the tab id,
  `procs.ts`, the `.proc-*` styles and #30's model keep the word,
  because what the tab estimates is still an inspiration proc. Two tabs
  now say "spark" — Details keeps its PINK SPARK section — and that
  collision is accepted knowingly rather than tidied away.

  **Kind stays carried by colour.** #41 argued the opposite and was
  closed: the palette is the game's own, and under dichromacy simulation
  the closest CIEDE2000 distance across all ten pairs is 7.11 against a
  2.3 JND. Grouping by kind is legible today, with no dependency to wait
  on.
- **Alternatives rejected:** *one sort default for both tables* (#29's
  own instinct — "two tables sorting differently is worse than one
  sorting redundantly") — they answer different questions and only one
  has a cap; a single default either flattens the trainee's real
  ranking or leaves ancestor tables ordering eight identical numbers
  arbitrarily. *A row cap, kept* — three versions were built or drafted
  before the height clip replaced all of them. *Cap by chance, then
  sort* (built, and it passed): honest about WHICH rows are hidden,
  silent about where they reappear. *A second `<tbody>` for the tail*
  under a `Less Likely` caption, so the button's position stays true —
  it works, but it duplicates kind groups either side of the line and
  adds a table idiom to answer a folding problem. *Relabelling the
  button* — `Show 5 Less Likely` (drops the total #30 wanted),
  `Show 5 Below 6.8%` (a threshold that churns on every edit), or a
  sort-dependent label (a control whose text changes when you press a
  different control). Each describes the mismatch; the height clip
  removes it. *A segmented pill for the sort* (built first, replaced on
  Jason's call): two rounded pills stacked read as two rows of tabs, and
  the second bought nothing the column headers weren't already there to
  say. *That pill beside the tabs on one line* — it fits the 390px panel
  at ~310px of content but not the 301px desktop sidebar, and shrinking
  the tab pill off full width would undo #26/#29's "two halves" split.
  *Keeping the held list* and freezing the table's sort while a control has
  focus — that keeps the duplication the whole issue is about, and
  buys a frozen sort that reorders the moment you look away.
  *Three ways to keep a ★ control in the row*, all rejected once the
  movement was measured: **snapshotting the order** (re-sort only on
  sort/node/membership change) fixes both sorts but leaves a header
  reading `Est. Per Run ▾` over rows that aren't in that order, which is
  its own dishonesty; **a level-independent sort key** (kind, then name)
  is stateless and makes grouping provably stable, but does nothing for
  the ranked sort, which stays live and still moves rows; **that key
  plus removing `By Chance` from editable tables** closes it completely
  but narrows the toggle to tables you only read, and makes an editable
  and a locked ancestor table behave differently. Moving the level onto
  the match rows beats all three: no state, no restricted sort, no
  asymmetry, and it hands 64px back to the names. *Spelling
  the level out as a "Stars" header* — three ★ buttons under it say it
  already. *Renaming `procs.ts` and the CSS with the tab* — the module
  models proc chances and would then be named after a UI label.
- **What would change my mind:** ancestor affinities ceasing to be a
  single constant per member (a per-spark modifier would make ranking
  informative there and collapse the asymmetry); the trainee's table
  growing a ★ column, which would give it ties to group around; a
  the desktop sidebar getting narrower, or the name corpus getting
  longer — 94px is already the width at which 13 names take three
  lines, and past that the control belongs on a second line rather than
  in the row. For the fold: anything focusable landing in the trainee's
  table, since clipped rows stay in the DOM and a hidden control is
  worse than a hidden row (the table is a readout today, which is what
  makes the clip safe); or browser find jumping to text inside the clip
  proving to be a real nuisance rather than a theoretical one.

## 35. Spark entry is a popout browser, with favourites on top

Issue #28, the first consumer of the watched-spark store #33 shipped
with no UI. It replaces the inline search, and it reverses #30 in
writing.

- **Requirements:** hand entry was search-only — type into "Add a
  Spark…" on an ancestor's Sparks tab and pick from up to eight ranked
  matches. That control works perfectly if you already know a name and
  not at all if you are browsing: typing `s` returned **8 of 309**
  matches and a line reading "301 more — keep typing to narrow", which
  is the app honestly admitting it cannot answer the question. The
  432-entry reference holds four kinds, several of which share wording
  with skills, and nothing on screen let you see what existed. Entry
  also has to carry the ★ level now (#34), so the chooser is picking two
  things, not one. And whatever it does with favourites must not make
  #27's uncapped watched block fill with filler.

- **Choice: one full-width `Add a Spark` button on the panel, opening a
  popout that lists all 432 with your favourites first.** The popout is
  the filter panel's own `Choose Umas` / `Choose Sparks` idiom —
  `.uma-popout`, `role="dialog"`, backdrop dismissed on `mousedown`,
  Escape to close — rather than a fourth way of showing a list.

  **It REPLACES the inline search rather than sitting beside it.** The
  popout carries a search box of its own, so keeping both would not be
  "browse or type", it would be the same search, the same ★ picker and
  the same `Added` marker rendered in two places, drifting. What
  removing the inline box actually costs is one click to open, paid once
  per node rather than once per spark — the popout stays open across
  adds — and the proc table being behind the overlay while you type.
  That second cost is real and is accepted: #34 already ruled an
  ancestor's table a readout consulted after the decision, and the level
  no longer lives in it, so there is nothing there you steer by while
  adding.

  **This reverses #30's "an add-one affordance, not a browser",
  knowingly**, and #30 now says so at both places it made the claim.
  That objection was to 432 undifferentiated rows under every ancestor
  panel, and it was correct about that. Two things defeat it: the list
  is behind a button, so it costs no panel height at all; and
  favourites mean the handful you actually use is at the top, with the
  long tail only needing to be reachable. #30's own "what would change
  my mind" named this outcome — hand entry proving too tedious — and
  guessed the answer would be a roster pull. It was a browser.

  **Favouriting and adding are different acts, and neither writes the
  other.** Each row carries a ☆ toggle AND three add buttons.
  Auto-favouriting on add would send every filler white typed onto a
  grandparent into #27's uncapped block, which is verbatim the failure
  #33 lists under what would change its mind. It would also move the
  row out from under the pointer that just clicked it, as favourites
  sort to the top — the failure #34 spent an entry closing, arriving by
  another route. And a node edit is local, owned by the autosave, while
  a favourite is a round-trip: coupled, a spark add fails because a
  `PUT` did. So favouriting writes `{hunting: true, groups: []}` and
  touches no blueprint; adding writes `{kind, key, stars}` to the slot
  and touches no watched row, existing or otherwise.

  **The hunting bit is in the chooser**, on its own line, on watched
  rows only. #33 puts filler "one click off at the moment you add it",
  and this is that moment — without it, a favourite created here could
  not be marked filler from anywhere until #27 ships. Its own line
  because the row already carries a star, a kind tag, a name and three
  buttons, and a fifth control on one line takes the width the names
  need at 358px. **Groups are deliberately not here**: nothing writes
  them yet, the vocabulary is derived from the rows (#33), so deferring
  costs nothing and a group editor is a bigger control than this row.

  **Which sparks sit in the Favourites section is snapshotted when the
  popout opens.** The live list still drives every ★ and every Hunting
  pill; only the ordering is frozen. Without it, favouriting a row lifts
  it out of its kind section and the add buttons you were reaching for
  are somewhere else. The popout remounts on every open, so a favourite
  leads the list the next time you look — which is soon.

  **A favourite appears in the Favourites section and nowhere else.**
  Rendering it in its kind section too is the same spark twice on one
  surface, which is the duplication #45 deleted the held list to remove;
  here it would read as "which of these two rows did I already star".
  The snapshot is what decides, so nothing vanishes from under the
  pointer either.

  **The kind tag stays**, against #30 cutting it from the proc tables.
  There, colour carried it and the word said the same thing a third
  time. Here you are picking BETWEEN kinds, and race and scenario sparks
  share wording with skills — the tag is part of the identity, not a
  repetition of it.

  **A failed watched fetch costs an ordering and nothing else.** The
  reference is committed and works offline; the favourites are server
  state behind Access, and a chooser that could not be browsed because a
  list of favourites did not load would be the failure doing the most
  damage. On a rejection the Favourites section is absent, all four
  kinds are still browsable, every add button still works, and the ☆
  toggles are **disabled rather than hidden** — a control that vanishes
  leaves nothing to explain itself. The reason is said inside the
  popout, not as a page toast: the popout covers the toast, and a
  load-time toast about favourites would fire for everyone whose list is
  simply empty. Writes are non-optimistic — `sparks.ts` returns the list
  the server ended up with, so the star only moves once the row exists —
  and a failed write says so in the same place. `watchedFailed` is a
  flag beside the list rather than inferred from an empty one, because a
  user with no favourites and a user whose fetch failed hold the same
  array.

  **Search behaviour, one rule for every section:** the query filters,
  the sections and their order never change, sections with no hits
  disappear, and hits rank by where the query lands in the name then
  alphabetically — a no-op with no query, the reference arriving sorted
  by `(kind, name)`. That is #30's ranking, kept: capping the served
  order directly is what returned eight race sparks and buried every
  white match. Nothing is capped here, so the ranking only decides what
  you read first — and the "N more" line is gone with the cap that
  produced it. The box is **sticky**, so a query stays reachable while
  you scroll past 432 rows; that is the difference between a browser and
  a list you have to leave to re-query.

  **Browse sections in `SPARK_TYPE_ORDER`** — Green, Race, White,
  Scenario — the same order the spark tables group by, now exported from
  `procs.ts` so the order you pick in and the order you read in are one
  constant. Not whites-first despite whites being 256 of the 432: the
  sections are headed and nothing is hidden, so the reader scrolls
  rather than losing rows off a cap, which is the bias #30 caught and it
  does not apply to an uncapped list.

  **A watched spark the reference cannot name is still offered**, as
  `Unknown (key)` — the same degradation the tables use. #33 accepts
  keys `app/data` does not know, because the reference is regenerated by
  hand and can run behind a dump, and its kind is what decides the base
  rate.

  **Locked and pulled nodes offer no entry at all**, unchanged from
  #28's roster-pull rule: the button renders only where the old search
  did.

  **Measured, at both widths.** The trigger is 267px in the 301px
  desktop sidebar with no overflow. The popout is fixed and centred, so
  the sidebar's width does not constrain it: **520px on desktop, 358px
  at a 390px viewport**, neither producing a horizontal page scroll nor
  a row past the popout edge. Names **wrap and are never ellipsised**
  (#34's rule for the table's names, and the `○` distinguishing a
  skill's two grades is the last thing on the line): all 432 fit one
  line at 520px; at 358px **89.1% fit one line, 47 take two, none takes
  three, and none is clipped**. Add buttons measure 31×25px and the ☆
  26×23px, both at the thumb size #34 set. The Hunting pill's line break
  is on a wrapper, not the button — a flex basis of 100% IS the button's
  width, so it stretched across the row and then past it by its own
  indent, which is what the screenshot caught.

- **Alternatives rejected:** *an inline list rather than a popout* —
  this is #30's objection restated, and it still stands: 432 rows under
  every ancestor panel is panel height spent on a list nobody reads,
  favourites or not, and it would push the map off a 390px screen
  entirely. The popout costs zero height when closed. *Keeping the
  inline search beside it* — see above; the popout has a search box, so
  this buys a second copy of one surface rather than a second mode.
  *Favourites as a separate store from the watched list* — #33 settled
  this: one row with a `hunting` bit expresses "quick to type" and
  "breeding for this" without asking the user which list a spark is in,
  and this issue is the consumer that would have had to answer that
  question on every row. *Reusing the roster-mark idiom*
  (`tag_icons.json`, `MARK_IDS`), which #28 asks about directly — it
  does not fit, for the reason #33 already wrote down: marks are a fixed
  vocabulary of server-known ids applied to veterans by
  `trained_chara_id`, changing only when the game adds one; watched
  sparks are an open, user-authored set over a 432-entry reference keyed
  by `(kind, key)`. They share the word "favourite" and nothing else,
  and reusing the mark machinery would mean a migration every time a
  user invents a group name. *Adding a spark also favouriting it* — see
  above; it is the shortest path to #27's block being useless. *A
  `stars` field on the watched row* — #33's rejection, and this entry is
  why it was right: the list records which sparks you care about, and
  the chooser carries the level into the slot document, which is where a
  level means something. *Collapsible kind sections* — five disclosure
  controls to solve a scroll, on a list whose sections are already
  headed and whose search reaches everything.

- **What would change my mind:** the popout's modality proving to cost
  more than the inline search did — if entering a member's sparks turns
  out to mean opening, adding, closing and checking the table on a loop,
  the table wants to be visible and the chooser wants to be a panel
  rather than an overlay. Favourites growing past what one scroll can
  hold, which would make the Favourites section want the grouping #33's
  `groups` field already stores. Or the 432 rows measuring badly on a
  real phone — they render eagerly today, which is fine at this size and
  is the first thing to revisit if the reference grows.

## 36. Greens are card-bound, and the chooser's first review

Two things at once, because they land in one file: the rule that a green
spark belongs to a card, and the ten defects an all-Opus review found
in #35 after it merged.

- **Requirements:** #35 offered all 137 greens on every node. Jason:
  *"each uma has a specific green unique skill, so having the entire
  unique list for an uma does not make sense"* — she can **learn**
  another uma's unique during a run, but she can never carry the
  **spark** for one. Measured three ways, and they agree exactly: the
  reference has 137 uniques over 83 characters (1–3 variants each); 95
  of the 97 released cards have a unique factor **at their own card
  id** (the two exceptions are the `91xxxxx` NPC range); and across a
  real roster — **196 veterans plus 1,176 lineage members, 1,372 rows**
  — every member carries at most one green and it is *always* her own
  `card_id`, with **zero** exceptions. `app/ingest.py` had said so all
  along in its header: *"key is the source card_id"*. So the chooser
  was offering 136 sparks the member cannot have, each with a proc
  estimate waiting behind it.

- **Choice: one rule, three tiers, client-side.** `card` known → her
  card's unique, which is one row or none; `chara` known but not the
  card → that character's 1–3 variants; neither → all 137, **each
  named with the uma it belongs to**. Only `unique` is card-bound —
  pink, race, white and scenario belong to anyone. The middle tier is
  insurance: the picker always sets both ids, but the slot type allows
  one without the other. The derivation is `deriveCharaId`, which
  already mirrors `derive_chara_id` server-side.

  **An uncast node keeps the full list** (Jason's call). #30 rules that
  a slot may carry sparks with no pink and no character — "the parent
  who carries these two whites" is a real plan — and a green is how you
  express "a Special Week parent" before you have cast one. What the
  full list needed was the owner: `Shooting Star` alone does not say
  whose it is, and 137 anonymous greens is not a list you can navigate.

  **The owner label drops `[Original]`.** 62 of the 95 greens with a
  card are the base outfit, so printing it spends width on the word
  that distinguishes nothing; a named outfit is kept, because WHICH
  card decides which of an uma's uniques you get. Median label 23 → 14
  characters. The 42 uniques whose card has not reached Global get no
  label rather than an invented one. On a **cast** node the label is
  suppressed entirely — the panel above already names her, and the list
  is one row.

  **The server rule is deliberately NOT here** — filed as #58. CLAUDE.md
  makes `app/schemas.py` the authority, but `BlueprintOut` is strict and
  one unparseable row 500s the whole blueprint list, so a document
  already holding a mismatched green would take the list down with it.
  That needs a survey of existing rows and probably a write-only rule,
  which is its own change.

### The review's findings

`/code-review` at high, every phase on Opus, run over #35 **after** it
merged — which is the wrong order, and the reason the order changed. 31
agents, 25 verified findings, 10 distinct defects. Four were real bugs
in state I had reasoned about and got wrong:

- **Un-favoriting made the row vanish.** The Favorites section was
  `watched ∩ snapshot` while the kind sections excluded `snapshot`, so
  un-starring dropped the row out of Favorites while the frozen set
  still hid it from its kind — the spark left the popout entirely and
  could not be added at all until it was reopened. **Membership is now
  what is frozen**, not the intersection: the section lists exactly the
  sparks it opened with, the ★ and the Hunting pill stay live off
  `watched`, and un-starring empties a star and moves nothing. That is
  what #35 meant by the snapshot; it just wrote the other one.
- **A snapshot taken mid-fetch froze an empty list**, so a popout opened
  during the four parallel mount fetches showed no Favorites section at
  all and scattered the user's stars through the kind sections — the
  exact state the freeze exists to prevent. The popout is now
  **remounted when the watched list settles**, which re-snapshots
  without an effect or a ref read during render (both of which the
  hooks lint rules refuse, correctly). It costs a query typed inside
  that sub-second window.
- **`watchedFailed` had one writer and no retry**, so a one-second blip
  at page load disabled every ★ for the session. Opening the chooser
  after a failure now re-fetches — that is the moment the list is
  wanted. Not on every open: it is page-scoped data that rarely
  changes.
- **A failed write after the popout closed reported nothing.**
  Dismissing while a `PUT` is in flight is one keystroke, and the notice
  lived only on the surface being unmounted — the star silently
  reverted and #27's block would quietly lack a spark the user watched
  themselves mark. Write failures now go to the **page toast**, which is
  `position: fixed` and drawn over the backdrops, so it is readable with
  the popout open and survives it closing.

Two were latent and became reachable:

- **`setFactors` took the finished array.** The popout stays open across
  adds, so two clicks resolved against one render each rebuilt the list
  from the same stale base and the second replaced the first wholesale —
  a spark the user watched themselves click never reaching the design,
  with the autosave persisting the shorter list. It takes an **updater**
  now, applied against the design at write time. The inline search had
  the same shape and hid it by collapsing after every add.
- **`.spark-group` was already taken** by the roster card's spark
  cluster (`VeteranCard`), so #35's heading rule was restyling every
  card on the roster page. Renamed `.spark-section-head`. The review did
  not catch this one; it turned up while fixing the finding next to it.

Two were presentation, and the second is the more interesting:

- **`:first-of-type` matches on TAG, not class.** The rule meant "the
  first section hugs the search band"; because every kind section was
  wrapped in a `div` and Favorites was not, it tightened every kind
  heading and never Favorites — the exact inverse. Moving it to
  `.spark-section:first-of-type` **did not fix it**, because the search
  band is also a `div` and therefore the first of its type; measured at
  11.2px on all four headings after the "fix". It is now an adjacent
  sibling — `.spark-search-band + .spark-section` — which cannot be
  fooled by either, and every section is the same element so the
  intent is expressible at all. Measured after: 8.8px on the first,
  11.2px on the rest.
- **British "Favourite" against the app's American "Favorite"**
  (`Favorites` in the filter panel, `Batch Favorite` on the roster,
  "Favorite-mark icons" in CLAUDE.md). One app, two spellings, for two
  unrelated concepts. Normalized, including the identifiers.

One was **measured and declined**: that 432 rows re-rendering per
keystroke makes typing lag on a phone. At **4× CPU throttling** the
first keystroke costs 186ms and every one after it 33–84ms, because the
list collapses to a handful immediately (432 rows and 3,565 DOM nodes
unqueried; 15 rows and 125 nodes at five characters). One perceptible
hitch on the first character is not "characters lag behind the keyboard
and the first keystrokes can be dropped". Memoising the filter would
not touch it either — the cost is React unmounting ~420 rows, not the
predicate. Revisit if the reference grows.

Two were in the **e2e suite** and both were real: it selected favorites
by displayed name, which the rest of the suite refuses precisely because
the reference holds distinct factors sharing one (two whites called
"Pressure"); and it recorded the row it created *after* a wait that can
throw, so a timeout would leave a real row in the user's watched list
forever. The star and the Hunting pill now carry `data-spark` like the
add buttons, and the id is recorded **before** the click that writes it.

**Also fixed, and not from the review: the scratch verification scripts
were driving the designer against whatever blueprint was open**, and
cleaning up only rows they created. The e2e suite has created and
deleted its own row from the start; the scratch scripts had no such
rule and were one habit away from destroying real work. They now open a
throwaway blueprint of their own — seeded into the `umalab.designer.open`
preference before first paint, and deleted in `finally` — so the rule the
committed suite follows holds for the local ones too. That tooling is
local and uncommitted; only the rule belongs here.

### The second review, before merging this time

The same review run again over the fixes above, on the branch rather than
on `main`. Nine more distinct defects, and the two that mattered were both
in state the first round had *introduced*:

- **A re-pick kept the previous card's green.** The card rule was enforced
  at OFFER time only, and `applyPick` deliberately carries a slot's sparks
  across a character or outfit change — so casting Special Week, adding her
  green, then swapping the outfit left a green bound to a card nobody in
  the tree holds. Nothing downstream would notice: the Procs tab kept
  estimating it, the trainee's roll-up kept including it, the autosave kept
  persisting it, and the chooser would neither offer it nor let you re-add
  it once dropped. **A re-pick now drops a foreign green and keeps
  everything else** — a green is part of the card's identity in a way a
  white, race or scenario spark is not, and those still carry over because
  re-typing them after every outfit swap would be pure friction. This is
  the case #58 cannot catch from the server side either, since the document
  it would reject is one the client wrote.
- **A settling fetch could overwrite a favorite saved while it was in
  flight** — reported as reachable, and it is not. Tried to reproduce it
  both ways and neither window admits a click: during the four mount
  fetches `Promise.allSettled` settles them TOGETHER, so the factor
  reference arrives with the watched list and the popout has no rows to
  star (measured: 0 rows, 0 stars); during a retry the failure flag is
  still set, which disables every ★ (measured: 432 stars, 0 enabled).
  **The guard went in anyway**, with the comment saying plainly that it
  cannot fire today: both windows are closed by accident rather than by
  design — splitting the mount fetches for a faster first paint, or keeping
  the stars live through a retry, opens either one — and #27 adds a second
  reader of the same list. A write counter, eight lines, and the invariant
  holds on its own. Documenting an unreachable failure as though it were
  live would have been the worse outcome; so would dropping the guard and
  leaving the correctness to two unrelated implementation details.

The retry path from the first round was also wrong in a way worth naming,
because it is the same mistake twice. `watchedLoaded` was a boolean, and a
retry can only happen once loading is over — so the key that was supposed
to re-snapshot the Favorites section **could never change on the one path
it was added for**. It is a **generation counter** now: bumped by every
fetch that lands, never by a write, since a write bumping it would remount
the popout under the pointer that just clicked and undo the frozen
membership the section depends on. Likewise the "first heading hugs the
band" rule, defeated a third time — by the failure note sliding between the
band and the first section — is now `:first-child` inside a wrapper that
holds the sections and nothing else, which is the first form of it that
isn't a claim about position in the popout.

The rest were smaller and are listed in the PR: a failed Hunting toggle
reported as a failed favorite (the shared writer now takes the caller's
message), the e2e favorite target able to land on a green the filter hides
on the cast node it runs against, this document naming a local scratch file,
and two shapes the plumbing had grown — six props drilled three levels to
reach the chooser, now one `WatchedStore` (#27 reads the same one), and a
third full-catalog index for a label the existing two already compose.

- **Alternatives rejected:** *hiding the Green section until a character
  is cast* — the strongest reading of the rule, and it would make
  choosing a green mean choosing a character, which the picker already
  does; rejected because it contradicts #30 for one kind only and takes
  the green away from the sparks-only plan that #30 explicitly allows.
  *Leaving the full list on cast nodes and only adding the owner label*
  — fixes the naming and leaves the wrong-spark-on-the-wrong-node case
  reachable, which is the half that produces a false proc estimate.
  *Landing the server validation with this* — see #58; it can make a
  saved document unopenable. *The owner on its own line* — measured
  worse, not better: 24 of 137 rows took three lines at 358px against 20
  inline, because the block adds a line to every labelled row rather
  than only to the ones that overflow. Inline with `[Original]` dropped
  is **9 of 137**, and that is where it stands — #34's "no name takes a
  third line" was a rule for a fixed table row in the 301px sidebar
  where the ★ column has to align, not for a scrolling browse list
  carrying a two-part label.

- **What would change my mind:** blue sparks arriving (#36 in the issue
  tracker) — they are stat sparks, not card-bound, so they would join
  the "belongs to anyone" side and the rule would not move. A card
  gaining a second unique factor at a key that is not its own id, which
  would break the identity this rests on and turn the filter into a
  lookup table. Or the uncast list proving to be how people actually
  pick greens, which would argue for sorting it by uma rather than by
  spark name.

## 37. Spark lists replace watched sparks: one table, and #33's premise

Entry #33 shipped a watched-spark list whose primary axis was a `hunting`
bit, with user-named `groups` as a filter over it. The axis is the other
way round. Asked whether the bit was needed, Jason: *"My original idea
is that users can create multiple lists of skills that they want because
sometimes they might want to search for Front Runner skills, or Medium
skills, both, or other skills. What they're hunting at a particular time
is not always the same."*

This supersedes #33 rather than amending it a third time. The mechanics
in that entry were repeatedly right about their own routes; what changed
is the thing underneath them, so its amendments stand as a record of a
shape that was being refined in the wrong direction.

- **Requirements:** the three consumers are unchanged — the chooser's
  Favorites section (#28, the only one shipped), #27's watched block, and
  hunted-skill scoring. What changed is the reading of *which sparks does
  this user care about*. It is not one set with a bit on each row. It is
  **several named sets, of which some subset is interesting right now**,
  and that subset changes week to week and is frequently more than one:
  Front Runner this week, Medium next, sometimes both at once.

  A `hunting` column cannot express that. It stores **per spark** the
  thing that actually varies **per session** — so switching from a Front
  Runner week to a Medium week would mean flipping the bit across dozens
  of rows and flipping them all back later. The bit had zero readers when
  this was found, which is the only reason the correction was free.

  Lists therefore have to be first-class objects: created before they
  contain anything, renamed, deleted. #33's derived vocabulary — *"a
  group exists exactly as long as a spark is in it and there is no
  registry to keep in sync"* — is exactly wrong for an object the user
  manages by hand. It cannot represent an empty list, silently destroys
  one when its last spark leaves, and forks `Front Runner` from `Front
  runner` with no way to notice.

- **Choice: one table, `spark_lists`, holding `(name, position, sparks)`
  per owner.** `sparks` is a JSONB array of `{kind, key}` — the same
  identity every other spark surface uses, never a name (#30). `name` is
  unique per owner. `watched_sparks` is dropped entirely, and `hunting`
  with it.

  **Favorites is the union of the lists, deduped.** There is no
  watched-but-ungrouped state, which is the one thing the old shape had
  that this does not. It was there to hold filler — the white you type on
  every grandparent, worth having handy and worth nothing to highlight.
  That case is served by *making a list for it*, which the user was going
  to do anyway under the new axis, and paying for it with a whole second
  table plus the integrity between them was not worth the one click it
  saves at the moment you star something.

  **Membership lives on the list, not on the spark.** The alternatives
  are laid out below; what decides it is that a list is now the object
  with a lifecycle, so deleting one should be deleting a row and nothing
  else. Both shapes that put membership on the spark leave dangling ids
  behind on a delete, to be swept or filtered forever.

  **Order within a list is the array's order**, free, and #33's ruling
  that the list records *which* sparks and not *what level* survives
  untouched — the ★ level belongs to the slot document, where it means
  something.

  **The active selection is device-local and multi-select** —
  `localStorage`, beside the four view-state stores of #32. Jason:
  *"Active selection should be device only for now."* It is a view, not
  a fact about the user's roster, and the phone being on a different
  build from the desktop is a feature rather than drift. **Nothing
  selected shows everything**, because every user starts with no lists
  and an empty Favorites section on first use reads as broken — the same
  argument #33 used to default `hunting` to true, which is the one piece
  of that entry's reasoning that outlived its mechanism.

  **The star opens a multi-select picker** listing every list with the
  spark's current membership checked. Jason's call, over "add to the
  active list", on the grounds that *"there could be multiple active
  lists"* — with several active the phrase has no unambiguous referent,
  so the shortcut would apply only in the rare single-active case and be
  inconsistent the rest of the time. Because the picker shows current
  membership it is also the **membership editor**: adding, moving and
  removing are one control, and the star reads as "in at least one list".
  It is where `New List` lives, which gives the zero-list first run a
  path that needs no separate settings surface — and it is the only list
  UI: creation only, with rename and delete going to #70's page.

  `New List` is **two round trips**, a `POST` then a `PATCH`, because
  creating and filling are two routes. Worth it over a "create with
  members" body: the create is rare, and one shape for membership means
  the picker's pill and its new-list field cannot drift. Measured at 45ms
  end to end locally, 26ms of it network — invisible. Over the tunnel to a
  Pi it doubles a round trip that is no longer free, which is **#69**,
  filed to be revisited *after* deploying rather than argued from local
  numbers that cannot settle it. The same issue holds the case for
  optimistic writes, which this deliberately does not do: a pill lights
  once the row says so.

  **The migration drops `watched_sparks` without carrying its rows.**
  Jason's call: the app is unreleased, everything in it is test data he can
  recreate, and there is no deployment to protect. He said so early and it
  was argued past on the grounds that a backfill was already written —
  which was true and beside the point, since the table turned out to be
  empty anyway.

  What the backfill cost, before it was deleted: a chunking pass to keep
  each migrated list under the spark cap, a bug in that pass which landed
  the first chunk exactly AT the cap so it could never accept another
  spark, and an oversized-key cast that could abort the downgrade partway.
  Three defects in service of data nobody wanted. If this ever ships and a
  later migration has to move real rows, write the backfill then, against
  a cap that cannot bind.

  **Last-write-wins is accepted, on the list row.** A membership change
  rewrites the whole array, so two devices editing the same list within
  the same moment lose one edit — #66's failure mode, relocated from the
  spark to the list and onto a row that is touched more often. Stated
  plainly because #33 twice claimed a race was closed when it was
  narrowed: this one is neither. It is *tolerated*, because the app has
  one user on two devices and the damage is a spark you re-add. Closing
  it needs add/remove routes over a membership table, which is the shape
  rejected below and the shape to reach for if this ever bites.

- **Alternatives rejected:** *keeping `hunting` and deciding its default
  at #27* — the position this entry started from, and wrong: the bit's
  default was never the problem, its subject was. *A registry table plus
  `groups: int[]` on the spark row* — fixes empty lists, rename and
  typos, but deleting a list leaves dangling ids in every spark that held
  it, and membership is still a whole-array replace, so it buys a table
  and closes nothing. *A registry plus a membership join table* — the
  only shape that closes the race and keeps integrity in both directions,
  and the one to adopt if concurrency ever stops being hypothetical;
  rejected now as two tables and a route group bought for a failure mode
  a single user does not have. *Keeping `watched_sparks` beside the
  lists* — see the union above. *The star adding to the active list, or
  doing so only when exactly one is active* — Jason's reasoning, recorded
  above. *A server-side active selection* — it is view state; #32's line
  holds.

- **Corrected by the review, 2026-08-04 (all-Opus, xhigh, 15 findings).**
  Four of them were this entry describing something the code did not do.

  **"Created before they contain anything, renamed, deleted" is one third
  shipped.** Creation exists, in the picker. `renameList` and `deleteList`
  are written, tested and wired to nothing. That is not a slip in the
  reasoning — a list *is* the object with a lifecycle, and the argument
  above stands — but the sentence described an app that does not exist. The
  surface for the other two is **#70**, a management page: viewing your
  lists, renaming, deleting, and bulk-adding sparks, which the per-spark
  picker is the wrong shape for. Jason: *"Rename/delete UI should be on a
  page where the user can view the lists of skills they have made and add
  skills in bulk there."* Until it lands, a mistyped name is permanent.

  **The active selection has no reader either.** `activeSparks`,
  `toggleActive` and the `localStorage` store are built and unit-tested;
  nothing renders a control, so the selection is always empty and every
  consumer sees every list. Filed as **#67**. It is not dead code — #27 is
  the first thing that makes an active selection *mean* anything, and this
  entry's rules had to be decided before #27 could be designed against
  them — but "is device-local and multi-select" above describes the model,
  not the app.

  **Names are folded now, which is what this entry already claimed.** The
  argument for first-class lists cites #33 forking `Front Runner` from
  `Front runner` "with no way to notice" — and the first cut shipped a
  byte-exact `UniqueConstraint`, so it forked them just the same, while
  `ListPicker`'s own comment conceded "two lists whose names differ only in
  case". It is a unique expression index on `(owner_id, lower(name))`,
  stored as typed and compared folded. Jason had no preference and asked
  which was better for the user; the deciding argument is that this is a
  phone-first PWA and mobile keyboards autocapitalise, so the duplicate
  arrives by itself rather than as a mistake anyone notices — and with no
  rename UI it is currently unfixable in the app.

  **Membership is unbounded, and the spark cap is gone.** It was 200,
  described in its own comment as "far above real use". It was not: there
  are 256 whites alone, so one "whites I care about" list could pass it,
  and the old `watched_sparks` had no cap at all so nothing bounded what a
  user already had. Jason: *"the number of skills in the future can grow.
  Does it really matter if we put a cap if our cap is higher than what
  could possibly go in it?"* — and the answer is that it does not, because
  the chooser adds from the factor reference, so the reachable maximum IS
  the reference size, and that grows with the game. Any constant either
  binds too early or ages into binding too early; raising 200 to 500 would
  only have postponed the same bug.

  What bounds it instead: `_dedupe` collapses to distinct `(kind, key)`
  pairs, so what is stored cannot exceed the distinct pairs the caller sent.
  An earlier draft of this paragraph went on to say body size bounds that in
  turn — **it does not**; nothing configures a request-body limit, and a
  review caught the claim. Membership is genuinely unbounded, which is
  accepted rather than overlooked: a real bound belongs at the transport,
  applying to every route, not as a constant here that ages against a
  reference the game keeps growing. `MAX_LISTS_PER_OWNER` stays — 50
  named builds has no reference deciding a ceiling, so it bounds rows
  rather than sitting in the path of legitimate use.

  This was the root of a whole cluster: the chunking, the chunk landing at
  the cap, and a 422 that the client reported as "try again" forever.
  Removing the cap deleted all three rather than patching each.

  **Two smaller things the entry implied and the code did not do.** The
  create's failure path discarded a list the server had *committed*, so the
  row existed, appeared nowhere, and 409'd forever on retry — the recovery
  this entry describes ("the caller reports it and the next click finishes
  the job") needed the created list to be handed back, which is what
  `PartialWrite` now does. And the ★ lost `aria-pressed` when it became a
  disclosure, leaving membership legible only as a CSS class; the label
  carries it again.

  **The list cap takes an advisory lock** (`pg_advisory_xact_lock` on the
  owner) rather than staying a bare check-then-act. The race was reachable
  only by one owner creating two lists in the same instant at exactly the
  cap, and the damage was 51 rows instead of 50 — but "the cap is not
  really a cap" is a half-truth that costs someone an afternoon, and the
  lock is one statement with no retry logic. Its test asserts the outcome
  and is **not** the guard: measured, it still passes with the lock
  removed, because the test client drives concurrent requests through one
  connection.

- **A second review, and what it says about fixing under pressure.** The
  branch was reviewed again before merging, and **five of its six worst
  findings were defects in the previous round's fixes** — not things the
  first review had missed. Chunking the backfill at exactly the cap. A
  `detailOr` scoped to 409 so every 422 still said "try again". A 404
  reload defeated by the write-count guard next to it, and bumping the
  `epoch` that keys the popout so it remounted mid-interaction and threw
  away the user's search. A draft-retention fix that contradicted the
  partial-write fix, so the obvious retry 409'd. A guard that let the next
  statement crash anyway.

  Each was a shallow read of the symptom reported rather than of what the
  fix touched. Recorded here because the pattern is the lesson: a round of
  fixes is new, unreviewed code written faster than the code it corrects,
  and it deserves the same suspicion. The e2e restructure in that round
  also turned out to destabilise the suite — measured, two aborts in two
  runs against zero in two on the committed baseline — and was replaced by
  a three-line guard that ran clean three times.

- **A third review, and the decision to stop patching.** The second round of
  fixes was reviewed too, and **at least eight of its fifteen findings were
  defects in that round's own fixes** — worse than the round before. The
  clearest was a lenient response model written to stop one unparseable
  entry failing the whole list read: because membership is a whole-array
  PATCH, an entry it dropped on the way out was **deleted from the database
  by the client's next write**. A loud, lossless failure had been turned
  into a silent, destructive one. In the same round, a focus-restore effect
  never worked (it captured `document.body`, the state it was written to
  repair), two fixes contradicted each other again, and this entry asserted
  a request-body bound that nothing configures.

  Every recurring defect sat in the same place: **speculative recovery for
  multi-device conflicts that cannot happen to one user on an unreleased
  app.** `PartialWrite`'s interaction with a corrective reload, the reload's
  remount flag and fetch-generation guard, the lenient read, the focus
  restore. Each needed its own correctness argument, and each argument was
  wrong in a way only the next review found.

  **So the machinery was deleted rather than fixed again.** The corrective
  reload, its flag and its guard are gone; `onReload` does one thing. The
  lenient read is gone and the strict one is documented as the deliberate
  choice, because loud beats silent when data is at stake. The focus restore
  is gone. What survived is what is simple and checkable: the folded name
  index, the removed cap, the two distinguishable 409s, the IME guard, the
  advisory lock, a three-line e2e guard. Everything removed is filed —
  #73, #74, #75, #76 — so none of it reads as an oversight.

  One more attempted fix in the same round is worth recording because it
  proves the rule: blocking Escape while a write was in flight, to make
  `busy` a genuine one-write-at-a-time guard. It silently swallowed the
  keypress, and the e2e caught it hanging within one run. Reverted. The
  correct fix for that whole class is not a guard at all — it is membership
  as its own rows (#66), where a stale copy cannot delete anything.

- **What would change my mind:** genuine concurrent use — a second person
  on the account, or one person editing the same list on two devices
  often enough to notice a lost spark — which turns the join table from
  over-engineering into the right answer. A favourite that belongs in no
  build proving to be a real want after all, which brings back a
  standalone watched set and with it the second table. The active
  selection needing to follow between devices, which makes it a user
  setting rather than a view. Or lists growing attributes of their own
  beyond a name and an order — a colour, a note, a default — which is
  fine on this shape, and only argues for normalising the membership if
  the *membership* is what grows attributes.

## 38. Guards proven able to fail: migration drift, and the lock's ordering

- **Requirements:** issue #76 — two tests asserted less than they read,
  and each guard here had to be shown failing against the fault it
  watches before being trusted.
  The DB suite builds its schema with `create_all`, so
  migration-vs-models drift never reached `pytest` — CI's `alembic check`
  step covers it, but merges don't wait for CI here, so the local run is
  the gate that counts. And the concurrent-creates test passed with
  `pg_advisory_xact_lock` deleted: each of its five gathered requests
  waited on NEW connection establishment from a cold pool, which staggered
  them into running one at a time. Confirmed by warming the pool — the
  lock-less route then lands five 201s, three runs of three.
- **Choice:** `tests/test_migrations.py` runs the real `alembic upgrade
  head` in a subprocess against the test database, then asserts alembic's
  `compare_metadata` comes back empty, with `compare_server_default` on
  (`alembic check` leaves it off). A subprocess because
  `app.config.settings` is a module-level singleton — in-process, env.py
  would read the app's own DATABASE_URL. The concurrency test warms the
  pool before racing, and a second, deterministic guard holds the owner's
  advisory lock from another transaction, waits until the create shows up
  in pg_locks as a waiter on that lock, fills the owner to the cap
  mid-hold, and asserts the blocked create answers the cap 409 — which
  fails both when the lock is deleted and when it slides below the count
  it protects.
- **Alternatives rejected:** building the suite's schema through
  migrations — closes the drift class more thoroughly, deferred as a
  rework this didn't need. Asserting only "the create blocks" — passes
  with the lock moved below the count; the ordering is the invariant.
  Reading "still running after a timeout" as "waiting on the lock" — a
  slow connect or a loaded runner also produces it, so the sighting has
  to be positive. Invoking `alembic check` from the test — it runs
  env.py, whose URL is the singleton's.
- **What would change my mind:** the suite moving onto migrations-built
  schema, which retires test_migrations.py whole. Settings becoming
  injectable, which retires the subprocess. The test engine growing pool
  settings of its own, which reopens the warm-up's coupling to the
  default pool_size that `CONCURRENT_CREATES` documents.

## 39. The green rule server-side: rejected on write only

- **Requirements:** issue #58, the server half of #36's rule — a green
  spark's factor key IS the `card_id`, so `BlueprintSlotIn` accepting
  Silence Suzuka's green on a Special Week node stores a spark that
  member can never carry, with a proc estimate reading off it. CLAUDE.md
  makes `app/schemas.py` the authority for tree rules, but `BlueprintOut`
  is strict and one unparseable row 500s the whole blueprint list — the
  rule must land without making any saved document unopenable.
- **Choice:** the check lives in `BlueprintIn._validate`, not
  `BlueprintSlotIn` — `BlueprintOut` embeds `BlueprintSlotsIn` directly
  and never passes through `BlueprintIn`, so the write path (POST/PUT
  both take `BlueprintIn`) rejects while the read path stays permissive,
  by construction rather than by a mode flag. A slot with no character
  is uncheckable and stays legal (#36's uncast tier), and so is one on a
  7-digit `91xxxxx` card — the NPC/tutorial copies `cards.json` ships
  and dumps can carry, the same range `derive_chara_id` special-cases.
  No unique factor key exists at those ids, so "her own" is
  unsatisfiable there, and a pull path landing one with a green would
  otherwise produce a document that 422s on every autosave with its
  sparks locked client-side. The check is purely structural —
  `key == card_id`, no reference lookup — so it is not the unknown-key
  leniency of #30 in disguise: that accepts keys the reference hasn't
  caught up to; this rejects a key contradicting the slot it sits on.
  Surveyed before landing, raw SQL over every row and owner: 4 saved
  blueprints with zero greens on named slots, and zero 7-digit-card
  members across 1,519 roster rows — so no data migration and nothing
  becomes unwritable.
- **Alternatives rejected:** the check in `BlueprintSlotIn` with a
  validation-context flag — the write-only split becomes invisible
  runtime state instead of model structure, and a future caller that
  forgets the flag breaks reads (the slot model's docstring now carries
  the warning). A data migration stripping mismatched greens — mutates
  user documents to fix rows the survey shows don't exist. Validating
  the key against the factor reference too — reopens exactly the
  reference-gap failure #30 closed. Requiring an NPC card's green to
  match `card_id % 1_000_000` — plausible, but zero observed NPC
  members means the mapping is unverified, and a wrong guess strands a
  pulled branch.
- **What would change my mind:** a pre-rule mismatched row surfacing in
  a real database after all — its next full save 422s, which the client
  surfaces as a failed autosave; that would justify a one-off strip
  migration. A real dump showing an NPC member's green — that pins the
  key mapping the exemption currently declines to guess, and the
  exemption tightens to it. The game shipping a regular card whose
  unique factor key is not its own card id — that breaks the identity
  the rule is built on, not just this check.

## 40. Blue joins the document, hand-enterable like the rest

- **Requirements:** issue #36 — a pulled node's blue sparks recorded
  and shown on its Sparks tab, reversing #30's exclusion; the ranking
  objection behind that exclusion ruled out in the issue itself, since
  #34 grouped the ancestor tables by kind. Additive document growth
  only (#28's invariant): absent must read as none.
- **Choice:** `blue` in `SlotFactorKind` (`app/schemas.py`) and
  `SLOT_FACTOR_KINDS` (`api.ts`), base 70/80/90 in `SPARK_BASE`, and
  slot 0 in `SPARK_TYPE_ORDER` — the position #30 reserved, above the
  pink. Everything else follows from where blue now flows: `factorsOf`
  keeps it on a pull, `/api/factors` serves the reference's five type-0
  rows so stored blues resolve to names instead of `Unknown (1)`, and
  the chooser's browse sections derive from `SLOT_FACTOR_KINDS`, so
  blue is hand-enterable — Jason's call, over the issue's pull-only
  lean: every real parent carries exactly one blue, so a hand-built
  node's roll-up under-reports without it. Three rules ride along.
  **Blue browses in the game's stat order** (Speed/Stamina/Power/Guts/
  Wit — its keys 1–5, the order `BLUE_ORDER` already sorts the roster
  by), the one kind not alphabetized. **One blue per member**: a uma
  carries exactly one stat spark, the slot model rejects a second, and
  the chooser's add replaces the held blue — strict on READ, unlike
  #39's green rule, because the rule lands in the same change that
  admits the kind, so no stored row can predate it. **No ★ on blue or
  green rows**: a list is a hunt and neither kind is hunted — every
  parent carries her blue and her own green regardless — so lists
  narrow to `ListSparkKind` (white/race/scenario), tightening #37's
  `SparkRef`; strict on read too, a survey (2026-08-05, all owners)
  finding zero stored blues or greens. A 1★ blue is over the per-event
  cap at any real affinity, so its row reads ~100% — true, and the cap
  finally visible on screen. The trainee's height clip (#34) needs no
  blue policy: it folds whatever order the sort produced.
- **Alternatives rejected:** pull-only entry (above). Serving blue
  names client-side from a constant instead of `/api/factors` — splits
  the name pipeline #30 built on "one regen keeps both paths in step"
  for five rows that would never drift anyway. A server rule rejecting
  blue on catalog slots, mirroring #39's green rule — the green rule
  rejects a factual impossibility; a typed blue is at worst optimistic,
  and reads must stay permissive regardless. A write-only list rule for
  blues and greens — #39's shape exists for data that might already be
  stored, and the survey shows there is none.
- **What would change my mind:** the trainee's chance-ranked roll-up
  drowning in near-certain blue rows across real designs — that argues
  for a display fold of the blues into one row, not for re-excluding
  the kind. A Global retune of the 70/80/90 bases — constants, so they
  move without touching the shape. A real use for pinning a blue or a
  green in a list — widening `ListSparkKind` back is free; narrowing
  it again would need another survey.
