# Decisions

Format for every entry: **Requirements → Choice → Alternatives rejected → What would change my mind.**
Keep adding entries as the build evolves. This file is the interview.

Bare `#N` in this file means entry N below; issues are always written
"issue #N". Entries are append-only and numbered forever — code cites
them by number — so a superseded entry becomes a stub naming its
replacement, never a deletion.

Topical index — entries in build order, so one surface's story spans
several:

- **Platform & repo:** 1 (HabitPool scaffold), 24 (private while it
  carries game-derived data)
- **Import pipeline:** 2 (extractor dump), 3 (full-replace), 4 (decode
  at import), 5 (hybrid schema), 7 (whole-roster API)
- **Reference data & assets:** 6 (bundled, committed), 8 (factor
  names), 10 (fetched game art), 12 (skill names), 14 (affinity data),
  22 (SVG marks), 23 (per-card aptitudes)
- **Roster UI:** 9 (tags), 11 (icon grid), 13 (filters), 20–21 (bulk
  marks), 45 (caption cycle + pink sort)
- **Affinity & proc math:** 15 (the formula), 17 (stateless scoring),
  29 (two decompositions), 30 (the proc model)
- **Designer & blueprint document:** 16 (persisted server-side), 18
  (router), 19 (superseded by 26), 25 (31-node document), 26 (v1 +
  autosave), 28 (roster pulls), 31 (corrections), 34 (table sort),
  45 (caption cycle + pink sort), 46 (phone bottom sheet), 47 (gens
  3–4 collapse into strips)
- **Spark entry & chooser:** 30 (factors join the document), 35
  (popout browser), 36 + 39 (greens are card-bound), 40 (blue), 41
  (Edit Sparks), 42 (pink rows)
- **Spark lists & favourites:** 33 (superseded), 37 (spark_lists), 43
  (the Lists filter), 44 (the Lists page), 48 (membership as rows), 49
  (one-shot create + optimistic toggles)
- **Multi-user & auth:** 32
- **Testing & CI:** 27 (e2e), 30's amendment (vitest), 38 (guard
  proofs)

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
  pink, and (when present) unique spark — e.g. `WIT · MED · UNIQ`
  (amended 2026-08-10 by #45: the swap no longer follows the sort —
  the caption is a manual Score/Sparks cycle persisted per surface,
  and a fifth key, Pink, joins the sorts below).
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
  1★/4★/7★/10★ → +1/+2/+3/+4 letters, cap A, deterministic);
  configuration problems must surface without clicking through 31
  nodes; v2 must layer on without rework.
- **Choice:** replace `/designer` wholesale with the Option-C layout: a
  vertical 16-column pedigree map beside a docked focus panel; ≤860px
  the map collapses to a horizontal strip above the panel. The map
  fills its column rather than sizing to its content — its 735px
  intrinsic width exceeds the 544–688px column below ~1150px, and
  compressing tracks beats hiding a grandparent behind a scrollbar.
  Abbreviating gen-4 labels is not a fix: measured intrinsics are gen-2
  57px/column, gen-4 44, gen-3 39, so removing gen-4 only moves the map
  to 713px. Bracket math is frontend-pure (`aptitude.ts`) — integer
  arithmetic over data the client already holds, so no endpoint and no
  debounce. Display rulings (Jason): the letter cell shows the final
  letter only, boosted = highlighted, no strikethrough; the From column
  reports what the ★ bought, not the bracket's worth — `4★ → +0 (at
  cap)` on a base already at A (#42 amendment) — and nothing is called
  waste, because overstacking is deliberate S-fishing (each matching
  spark is an independent inspiration-proc ticket). The one warning is
  a typed gen-1/2 pink whose aptitude resolves below A = red
  "undroppable" (the game only generates pinks at A) — advisory,
  badged on the map chip, not checkable on anonymous slots. The
  trainee gets no spark editor; v1 editors are pink-only; picks are
  catalog-only and card-aware (#23). A re-pick keeps the slot's typed
  spark — a plan input, not card identity — and a named slot's
  `chara_id`/`card_id` are nullable so a slot can carry its planned
  pink before anyone is cast (it must then carry a spark; identity is
  all-or-nothing). Persistence reverses #19's explicit Save: there is
  no unsaved state. Every design is a server row — opened on load,
  created when missing (empty table, unparseable document, 404 from
  another tab), autosaved by debounced PUT (800 ms) through a write
  queue keyed by row and flushed on every identity change, writes
  serialized so a slow PUT can't restore an older document under a
  "Saved" label. A blank name saves as "Untitled Blueprint" (lowest
  free " - N"); failures are visible ("Not saved", reason on hover)
  and retried on a widening delay — silence is indistinguishable from
  a healthy save, a toast per attempt unusable. localStorage holds
  only the open blueprint's id. The save bar is one picker plus
  status: an editable field that IS the name (renaming is typing; the
  menu lists only the other blueprints), icon-button duplicate/delete,
  and no Save button — a button that does nothing new invites doubt
  about whether the work is safe.
- **Rejected:** server-side letter computation — a round-trip and
  stale-result debouncing for pure local arithmetic; popover editors
  on the map — the panel exists so the chart never needs them;
  strikethrough old→new letters; keeping the dead run-affinity panel
  rendered until v2 restores it properly, trainee-only.
- **Would change my mind:** letter math varying by card in ways
  aptitudes.json doesn't capture (a backend authority); the compressed
  860–1150px tracks proving unreadable in use — the next lever is the
  named chips' letter grid, then raising the half-tree breakpoint;
  users reading "+1 (at cap)" as the window's worth rather than its
  yield, which would argue for "+1 of +2".

## 27. Designer e2e suite in CI, as-is and dev-served

- **Requirements:** the designer checks — the only net for the
  autosave data-loss class of bug (#26) — must run on every PR; the
  suite must stay safe against a real local database; a headless-only
  failure must be diagnosable without reproducing it locally.
- **Choice:** move `verify-deep-tree.mjs` into tracked `frontend/e2e/`
  (`npm run e2e`) with an `e2e` CI job on a `postgres:16` service,
  required from day one — a `continue-on-error` job gets ignored
  within two PRs. Kept a plain `.mjs`, not `@playwright/test`: the
  suite is one stateful narrative (one `try` spans ~500 lines, the
  cast is constraint-solved once against `/api/catalog`, ~18
  sequential sections read state earlier ones built), so isolated
  `test()` blocks would mean inventing fixtures for mid-narrative
  state, and the "no JS errors or failed requests" check must
  distinguish the run's two deliberate network breaks from real ones —
  a distinction that only exists inside one continuous run (explicitly
  flagged windows since #28). Served by `npm run dev`, not `build` +
  `preview`: the production bundle registers the PWA service worker,
  Playwright's `page.route` cannot intercept requests issued through
  one, and the last two checks deliberately abort
  `**/api/blueprints/**` to assert the "Not saved" → auto-recover
  path — preview would quietly stop testing them. In place of traces,
  `E2E_ARTIFACT_DIR`: screenshots at the moment of the failing check
  (capped at five), an `e2e-results.json` with counts and the raw
  error log, plus both server logs — verified end-to-end by injecting
  a forced failure. Readiness is polled (90 s cap, log dumped on
  timeout), never slept; `--strictPort` so a busy 5173 fails loudly
  instead of drifting to 5174. The self-restoring `finally` deletes by
  ownership, never list-diff — "delete everything absent from the
  startup snapshot" also matches a blueprint saved from another tab
  mid-run, which is data loss rather than restoration; anything else
  that appeared is reported and left alone, and the loop is wrapped so
  a throw in `finally` can't replace the real failure.
- **Rejected:** converting to `@playwright/test` — a ~500-line
  restructure of the only regression net before it ever ran in CI;
  wrapping the `.mjs` in one `test()` for `webServer` — the runner
  instruments its own browser, not a shelled-out child's, so it buys
  orchestration but not the traces that were the point; committing a
  personal roster dump to unlock the roster suites — those need a
  synthetic fixture, deferred as phase 2; a fixed `sleep`.
- **Would change my mind:** CI-only failures the screenshot and JSON
  don't explain — the next lever is `@playwright/test` for real
  traces, and the narrative decomposes then; flake in CI despite
  stable local runs (drop to `continue-on-error` while diagnosing,
  don't delete the job); the service worker becoming worth exercising
  end-to-end, which means a separate preview-served job.

## 28. Roster pulls are additive, and overwrite only after asking

- **Requirements:** designer v2 restores pulling real veterans out of
  your roster, which rewrites a whole branch from one pick. It must
  not displace manual entry (the primary path, and the only one that
  works before an import); it must not silently destroy work it lands
  on; and the roster path must be covered in CI from the moment it
  exists.
- **Choice:** the picker gains a source, it does not change one —
  catalog is the default and the tab strip appears only when there is
  something to pull. The designer takes the shell's roster, never its
  own fetch (a private fetch doubled the largest response and froze at
  mount, so a pull after an import could snapshot a just-deleted
  veteran). A pull replaces a branch: it empties the target's whole
  subtree, then fills two generations from the dump (positions 10/20
  the parents, 11/12/21/22 theirs). Filling only the slots with data
  would be a correctness bug — leftover gen-4 sparks would feed the
  new grandparents' brackets from a pedigree that no longer exists.
  Every node but the trainee takes a pull; deeper targets simply reach
  less. Gen-3/4 slots keep the member's `card_id` at every depth the
  dump reaches; the document shape stayed flat — `{aptitude?, stars?,
  card_id?, source?}` — so every earlier row is already this shape and
  parses unchanged: no migration, no shim. The tree rules (no
  repeating the character directly above; siblings differ) run over
  all 31 indices on the server, the picker greying to match; a
  grandparent repeating the trainee stays legal. A pulled branch is
  read-only — her recorded pedigree, so editing it would assert
  something false about a horse you own; her identity stays
  replaceable, which is the way out, and the lock derives from the
  slot's explicit `source` (positional inference survives only as a
  fallback for rows written before the field). Clearing or replacing
  her takes her branch with it, unprompted — nothing hand-authored can
  be down there. The overwrite confirm is conditional and native
  (`window.confirm`, one dialog per pull naming only hand-authored
  work — a dialog per node trains blind dismissal); declining leaves
  the picker open on the list that found her. Three letter modes, one
  per source, following `source` and never letter presence: catalog
  projects (`6★ → +2`); roster reports `as trained` — projecting her
  double-counts inheritance her career already consumed, and capped at
  A a mare who finished S; her letters snapshot onto the slot, all ten
  or none, enforced both sides; lineage states `card base` — the dump
  gives no aptitudes and the window is permanently missing two thirds
  of its slots, so the old projection was a floor dressed as a
  forecast. The undroppable warning is catalog-only: a dump pink
  demonstrably dropped. e2e phase 2 ships here, CI-seeded only: a
  committed synthetic fixture (`backend/tests/fixtures/roster.json`)
  imported by a CI step — never by the suite, since imports are
  full-replace (#3) and would wipe a real roster; the suite derives
  its cast from `/api/veterans` and skips when nothing fits,
  `E2E_REQUIRE_ROSTER=1` making that skip a CI failure;
  `tests/test_fixtures.py` defends the fixture's shape.
- **Rejected:** filling only the reached nodes (the first cut — the
  wrong-number bug above); defaulting to roster when one exists (a
  mode that changes under you is worse than a tab); prompting per node
  or on every pull; an in-app modal (a second confirm idiom);
  inferring deep origin from `card_id` presence (broke when those
  slots became hand-pickable); nesting the pink under the identity
  (reads cleaner, breaks every saved blueprint); seeding from inside
  the suite (would wipe a real roster — no coverage is worth that);
  committing a real dump (#24, and personal data); projected lineage
  letters marked `≥` (a true lower bound on a quantity nothing reads);
  hiding them entirely (discards the known card base and breaks the
  map's uniform geometry).
- **Would change my mind:** the one-dialog summary proving unreadable
  once pulls routinely hit several hand-authored nodes (an in-app
  modal listing them earns its keep); a lineage member legitimately
  carrying two pinks (making `pinkOf`'s "strongest wins" a real
  ruling); the fixture's eight veterans proving too thin for the
  remaining roster suites (extend it, don't import a real dump);
  `card base` reading too pessimistic on a pulled grandparent — the
  next lever is flooring at A the row she demonstrably dropped a pink
  in, derived from a rule we already trust.

## 29. Affinity attributed per ancestor: two decompositions, one each

- **Requirements:** V2 restores the run-affinity readout, and the proc
  estimates (#30) roll a chance per ancestor against that ancestor's
  affinity; `p1_affinity`/`p2_affinity` was the wrong grain — a
  grandparent's proc rolled against a number four links wide.
- **Choice:** one `node_affinity(node)` helper over two tree
  constants; the four `g*_affinity` fields are additive on
  `AffinityOut`. There are two decompositions, each answering a
  different question — do not conflate them. **Individual affinity**
  (`*_affinity`, the API, the proc-roll quantity): every link the
  ancestor appears in — a parent gets her pair link, both triples AND
  the p1-p2 link (relation points and win bonus alike, deliberately
  double-counted; #15 records the measurement that settled it); a
  grandparent gets the one triple and win link it sits in. The numbers
  nest, and the six sum to the total plus the p1-p2 link.
  **Owned-link** (each term to its deepest participant, summing
  exactly): built, shipped on the map tiles, and withdrawn the same
  day — `t-p1`/`t-p2` can never carry a win bonus, so every win point
  landed on a grandparent. On a real ◎ blueprint with 210 of 332
  points in wins, the tiles read parents +18/+24 against grandparents
  +48–70 while the parents carried 175 and 216 individually — the
  better the lineage, the worse it ranked, because "deepest
  participant owns the link" is a convention, not a truth. Map tiles
  now show individual affinity, unsigned and bandless (a `+` invites
  summing the one quantity that doesn't; △/○/◎ grades whole pairings),
  inside the chip's head row, stopping at the grandparents — gens 3–4
  appear in no link, a correctness floor rather than a space ruling.
  An unfilled slot is `null`, a voided one 0 — "nobody there" and
  "there and worth nothing" are different rows. The full panel returns
  to the trainee only (#26): the total with its band symbol and the
  seven-link composition table under labelled columns (`Rel.`/`Wins`
  abbreviated — spelled out they overflow a docked panel), nothing
  else. Affinity leads the Details tab, above the letters (Jason).
  Replace/Clear are `.bar-icon` icon buttons on the name row sharing
  the save bar's styles — a forked copy showed two different reds for
  "destroys something". Clear draws a trash can, not ✕: the ✕ is the
  app's close mark, and an un-undoable branch delete wearing "dismiss"
  is a trap. `aria-label` names the node ("Clear Grandparent 1-2"),
  `title` stays generic — equal strings become the accessible
  description and announce the node twice. Scoring stays the stateless
  `POST /api/affinity` (#17), debounced 250 ms, aborted on the next
  edit, failures inline. Sources (RESOURCES.md): the client's
  `master.mdb` confirms the bracket table and bands verbatim and holds
  no proc-rate table — the conversion is server-side, so "est." is the
  honest ceiling; Polaris's 1000-inheritance compatibility-0 study
  publishes the composition rule, confirms every base rate and the
  inbreed exclusion, and shows only the 2nd and 3rd of the three
  inheritance events vary with compatibility, so `1 − (1−p)²`; uma.moe
  implements both decompositions; Crazyfellow corroborates whole-side
  and gold inspiration as cosmetic.
- **Rejected:** one `node_affinity` map replacing the parent fields —
  tidier on the wire, but it churns the shape #15 and the tests
  describe for no reader that benefits; attributing p1-p2 to both
  parents so the six shares sum to the total — a nicer identity, an
  unverified claim about the game; showing the shares in the panel
  (two forms built, both restated the link table above them); scoring
  client-side — #26 already rejected forking the one in-game-verified
  implementation.
- **Would change my mind:** the nesting proving misleading in use —
  the fallback is loss framing ("lose 175" is exactly individual
  affinity, since emptying a parent kills her grandparents' triples
  too); a post-2026-06-24 replication that touches attribution; the
  proc model needing a trainee share (it has none — she is in every
  link and a slot in none), which would mean the model is about links,
  not nodes.

## 30. Inspiration procs: a Sparks tab, and whites in the document

- **Requirements:** V2's last piece. A spark inherits twice: the
  bracket at career start (deterministic, cap A), and an inspiration
  during the run — probabilistic, scaling with the member's affinity
  (#29), and for a pink the only route past A to S. Framed from the
  trainee's side (Jason): an ancestor's number is the chance the
  trainee ends up with that spark because of her.
- **Choice:** `procs.ts`, pure: `min(base × (1 + affinity/100), 100)`
  per event, `1 − (1−p)²` per run, over the individual affinity of
  #29, never the map tile. Non-pink sparks join the document:
  `BlueprintSlotIn` grows optional `factors: [{kind, key, stars}]` —
  the additive-only growth #28 allows. Kinds white/unique/race/
  scenario; decoded from the dump on pulls, typed against a new
  `GET /api/factors` (432 entries) otherwise. One general list, not a
  field per kind — four arrays put the same three validations in four
  places. `kind` is stored, not derived — it decides the base rate,
  and the key ranges are an ingest heuristic, not a guarantee. Key,
  not name — names are localized render strings. Uniqueness per
  (kind, key). Unknown keys are accepted: `app/data` is regenerated by
  hand and can run behind a dump, and one unparseable row 500s the
  whole blueprint list. Blue is deliberately not a kind — at 70/80/90
  it would pin every ranked table (reversed by #40 once #34's kind
  grouping removed that premise). A Sparks tab on every named panel
  (labelled "Procs" until #34; the tab id, `procs.ts` and `.proc-*`
  keep the word): an ancestor's lists her own sparks ranked by chance
  — the pink earns its place; the trainee's lists each distinct spark
  once at `1 − ∏(1−p)` across carriers, no From column (built, cut:
  the breakdown is one click away and it cost a third of the width)
  and no ★ — the union mixes levels, so "★★★ 40.6%" invites reading
  the union as the 3★ carrier's own 32.8% (ancestor tables keep ★,
  unambiguous, editor below). The trainee table's 12-row cap —
  measured uncapped at 34 rows, an 1120px panel against a 900px
  viewport — was honest only because ranked; #34's height clip
  superseded it once sorting arrived. Kind is carried by colour, not a
  word; the tag survives in hand entry, where you choose BETWEEN
  kinds. (The inline search itself is superseded by #35's popout
  browser, which reverses this entry's "an add-one affordance, not a
  browser" deliberately and in writing.) Search matches rank by where
  the query lands in the name — capping the served `(kind, name)`
  order returned eight race sparks and buried every white match. Deep
  gen-3/4 slots get no tab bar; the tab choice persists across nodes.
  The tab is never gated on a score — the first cut gated it, hiding
  the only editor behind the thing not yet decided and erasing typed
  sparks on a backend blip; display and entry need different
  conditions, unscored chances render "—", and the below-A warning
  renders outside the tab switch. A named slot may carry non-pink
  sparks with no pink and no character — under the old husk rule,
  clearing the pink silently destroyed the spark list; the trainee
  still refuses both. Rates, all measured: pink 1/3/5, white 3/6/9,
  green 5/10/15, race 1/2/3, scenario 3/6/9, blue 70/80/90 recorded
  for whoever adds it. Every number is per run and the header says so
  ("Est. per run") — the per-event intermediate differs by a factor of
  ~2 and never reaches the screen. Bars fill in the spark's colour,
  scaled 0–100 absolutely — a relative scale draws a full bar for a 3%
  spark whenever nothing beats it, and "unlikely" is what this table
  exists to say.
- **Alternatives rejected:** a rate table by kind × ★ — answers a
  hypothetical; Jason chose the real sparks, which is what makes the
  combined view possible; scrolling the long table in a fixed box —
  trapped touch scrolling, and it hides how much is below without
  saying; a row per (member, spark) on the trainee; modelling gold
  inspiration — cosmetic, an indicator that a 3★ proc'd (#29); a unit
  runner (vitest) — REVERSED by amendment 2026-08-03 (#48), on the
  condition that reversed it: the first PR ports the existing modules
  (six went in: `aptitude`, `procs`, `filters`, `domain`, `blueprint`,
  `sparks`), because a runner covering only new code looks like
  coverage — the original worry, preserved as the gate. vitest 4,
  `environment: "node"`, co-located `src/*.test.ts` (typechecked by
  `tsc -b` for free), no jsdom, no component rendering; `.tsx` stays
  in the glob so a stray component test fails on `document is not
  defined` rather than collecting nothing and reporting green;
  `npm run test` never reaches `e2e/`. The port found two latent
  defects, both unreachable guards, and no arithmetic bugs — the
  models were already right, and the suite buys that they stay right.
- **What would change my mind:** a post-2026-06-24 replication — these
  ARE constants, unlike #29's structural rule, so a retune invalidates
  the numbers without touching the shape; "est." read as a formality,
  meaning the hedge needs to be louder than one word. For the runner:
  a year of green with no regression caught; a pure module landing
  untested after this; a real case for component tests, which needs
  jsdom and its own entry.

## 31. Three corrections to the designer and its filters

- **Requirements:** issues #33, #32 and #31, shipped together. (a)
  Legacy Sparks widened a spark search to the veteran plus all six
  lineage slots, grandparents included. (b) The slot picker reset its
  filters on every open — filling 31 nodes against one criterion meant
  rebuilding them each time. (c) The only way off a cast character was
  Clear, which nulls the slot — the pink and every typed spark went
  with her.
- **Choice:** (a) the legacy pool is the veteran and her two PARENTS —
  a correctness fix: breeding shifts every slot up a generation, so
  her own grandparents leave the game's 6-slot tree entirely, and a
  match sourced from one is a spark that can never be inherited.
  `legacyFactorsOf` in `filters.ts` owns the rule; the suggestion
  vocabulary narrows to match (`commonSparkNamesOf`, shared with
  `reconcileFilters`, so the chooser cannot offer a name reconcile
  would strip). Two accepted first-load costs: persisted
  `legacy: true` filters match fewer veterans, and a saved Common
  Sparks row naming a grandparent-only spark is deleted, not narrowed
  — it selected on something unreachable, and the app is unreleased.
  (b) the picker persists filters AND sort under its own keys
  (`umalab.picker.filters`/`.sort`), never the roster page's — the
  sets stay independent in both directions. The mount reconcile runs
  only against a roster that has arrived (reconciling against an empty
  fetch would strip every filter on a slow load) and writes its result
  back (a masked filter reactivates silently on the import that brings
  its target back). Sort shipped unpersisted first; Jason's objection
  stands — a good default argues for what an unset key falls back to,
  not for discarding a choice, and a sort you set and see hides
  nothing. (c) a No Character chip — the face comes off, the sparks
  stay — first in the picker's character list, in the dashed-✕ shape
  No Favorite already uses (Jason, two rounds: not a third icon on the
  panel's name row, not a text button in the picker header). Taking
  the face off is an answer to the question the picker asks, so it
  sits among the answers and closes the picker like any pick.
  `withoutCharacter` mirrors `withSpark`/`withFactors`, prunes to null,
  and rebuilds through `catalogSlot` — a character-less slot may only
  be a catalog one, on both sides. Hand-picked nodes only
  (`canUnselect`): a pull's sparks are the horse's own, so dropping
  just her face would leave someone else's sparks under nobody —
  clearing the branch stays the way out of a pull (#28). Hidden too
  when there is nothing to keep (then it is exactly Clear), which
  keeps it off the trainee for free.
- **Alternatives rejected:** keeping the vocabulary wide so a saved
  filter is never cleared — trades a silently-cleared filter for a
  permanently dead menu entry; renaming the toggle (the tooltip says
  "her two parents"; "Legacy Sparks" is the app-wide term); sharing
  `FILTER_STORE`/`SORT_STORE` — the reason the picker got its own
  state at all; a third icon on the name row — three
  destructive-adjacent icons, and it split "remove her" from "replace
  her"; offering the chip on a pulled node as a Clear synonym — two
  controls with one meaning, suggesting the sparks might survive.
- **What would change my mind:** (a) a filter naming WHICH slot a
  legacy match came from, or counting occurrences — a bigger feature,
  noted on #33; (b) the picker's filters proving stickier than wanted
  — a Reset in the dock rather than a reset on open; (c) No Character
  proving hard to find in the picker — the objection to the panel
  affordance was crowding, not discoverability.

## 32. Multi-user: Access identity and owner-scoped rows

- **Requirements:** issue #50 — the trigger #16 named in advance.
  Several people use the app, each seeing only their own roster,
  blueprints and marks; nobody writes a login screen; the existing
  single roster survives; local `uvicorn --reload`, `pytest` and the
  Playwright suite keep working unchanged.
- **Choice:** Cloudflare Access is the login, a verified JWT the
  identity, `owner_id` on every owned row. The
  `Cf-Access-Jwt-Assertion` JWT is verified against the team's keys,
  the configured audience and issuer, RS256 pinned. The bare
  `Cf-Access-Authenticated-User-Email` header is never read — anything
  reaching the origin can set it. The `CF_Authorization` cookie is not
  read either, a security decision: a cookie is ambient, and
  `POST /api/imports` is multipart — CORS-simple, no preflight — so a
  hidden cross-site form could run a logged-in user's full-replace
  import; header-only auth is immune with no CSRF token or Origin
  list to maintain. One setting decides the mode: `ACCESS_AUD` set
  means every request verifies or is refused; empty means run as
  `DEV_USER_EMAIL`; no third state — a dev escape hatch reachable in
  production is the bypass. `users` is keyed by email, rows created on
  first sight (not open signup — the Access policy is the invite
  list); service tokens are refused explicitly (they verify, carry
  `common_name`, and would share one blank-addressed user). Both
  global uniqueness rules widen per-owner: `veterans.trained_chara_id`
  is per-save, so two players legitimately hold the same one;
  `veteran_tags` keeps its constraint name, which the tag upserts cite
  in `ON CONFLICT`. Another user's row is a 404, not a 403 — a 403
  confirms the id exists. Existing rows backfill onto `DEV_USER_EMAIL`
  (added nullable, backfilled, then NOT NULL); a deployment whose
  Access email differs sets it before upgrading. The migration reads
  that setting through `app.config`, not `os.environ` — the documented
  place to set it is `backend/.env`, which pydantic-settings loads
  into `Settings` and never into the process environment, so the env
  read silently stranded the roster on an owner nobody can log in as.
  `/api/catalog`, `/api/factors` and `/api/affinity` stay
  identity-free (#17); a structural test asserts every other route
  declares the dependency, because a route that forgets it reads
  across all users and nothing else would notice.
  `tests/test_isolation.py` is a real exception to pure-module testing
  (#26, #30): the interesting behaviour IS the database — a missing
  owner filter is invisible at every other layer — and it needs
  Postgres (JSONB, `ON CONFLICT`). It refuses the app's own database,
  compared by (host, port, database) rather than URL string (the same
  database has many spellings), and `PYTEST_REQUIRE_DB=1` turns the
  no-database skip into a CI failure — a security invariant that
  silently stops running is worse than one never written. The same job
  runs `alembic upgrade head` + `alembic check`: the tests assert the
  models, a deployment runs the migrations, and nothing else compares
  the two.
- **Alternatives rejected:** building auth in FastAPI — passwords,
  sessions and resets are real attack surface for an invite-only app,
  and Cloudflare already does it (platform DECISIONS #10; the shared
  verifier helper waits for a third app); trusting the email header;
  scoping only the designer — leaves the destructive import, the
  actual blocker; deleting existing rows instead of backfilling —
  there is exactly one real roster and it is why the app exists;
  syncing the four view-state stores — a phone's filters are arguably
  wrong on a desktop; they stay in `localStorage`.
- **What would change my mind:** public signup, which turns
  first-sight creation into a real registration flow; a native client
  that can't ride a browser SSO flow; a third app on the platform,
  when the JWT verifier moves into a shared package.

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

- **Requirements:** issues #29 + #45, built together. (#41 later moved
  the level column and its ✕ into the popout; what survives here is
  the sort machinery and the invariant that nothing in the table can
  move a row.) (a) On an editable ancestor's tab every non-pink spark
  rendered twice ~30px apart — a ranked row plus a held-list control
  row disagreeing about identity and order. (b) Chance-only sort is
  degenerate on an ancestor: affinity is one constant there, so chance
  is a pure function of (kind, ★) — measured, eight consecutive rows
  at 19.4% on a real pulled parent. (c) "Procs" named the smaller half
  of a tab that is more than half entry.
- **Choice:** one row per spark; the level is chosen at the add. The
  held list is deleted; the three-button ★ control moves to the
  search's match rows, so a 3★ is one click. This knowingly reverses
  #45's own headline (set the level where its consequence shows):
  grouping does NOT stop a row moving — measured, raising the last of
  three whites to 3★ moved it index 2 → 0 grouped (4 → 0 ranked) and
  left a different spark under the pointer, where the next click is a
  ✕ that deletes and autosaves. Choosing on the match makes the table
  incapable of changing a chance — closed at the root, and fewer
  clicks; the accepted cost (Jason's call) was drop-and-re-add to
  change a level, later removed by #41. The pink row lacks the ✕, not
  the ★ glyphs — its editor stays on Details (#26/#30) — and keeps a
  held-empty ✕ slot so the ★ column's right edges align (a column that
  doesn't line up reads as a rendering fault; an e2e check compares
  the edges). Column headers are the sort control — a segmented pill
  read as a second row of tabs and cost a row of height: real
  `<button>`s inside the `th`, `aria-sort` announced, caret drawn as
  CSS `::after` so the DOM text stays "Spark"/"Est. Per Run". Both
  tables sort with different defaults, and the asymmetry is the point:
  ancestors by kind (the only informative order at one affinity, and
  stable where you edit), the trainee by chance (a union across
  carriers, ties rare). Type order Pink → Green → Race → White →
  Scenario (Jason's call, the game's own grouping — not the
  reference's `(kind, name)`, which buries whites); `TYPE_ORDER`
  numbers from 1, 0 reserved for blue above pink. The trainee's fold
  becomes a height, not a row count: a sort toggle breaks "hidden =
  least likely", and every row-cap variant patches the same crack — so
  `max-height: 24rem` (#30's measured 0.6× viewport), every row
  rendered in the sort's order, the last visible row cut through and
  faded (a clean edge reads as a finished list). `overflow: clip`, not
  `hidden`: `hidden` makes a scroll container and find-in-page
  scrolled a match 187px into it, decapitating the panel; the accepted
  price is a match below the fold reported but not reachable. Whether
  to fold is measured by a `ResizeObserver`, not counted. Both sorts
  persist beside `tab` (#30's reason: comparing one view between two
  ancestors is the common move). A pulled ancestor's table sorts too
  and gains no editing. The tab renames Procs → Sparks, label only —
  the tab id, `procs.ts` and `.proc-*` keep the word. Measured: the
  61px level column leaves 96.1% of all 432 names one line at 390px
  and 71.1% in the 301px sidebar, none needing three lines; with the
  control in the row the sidebar had 94px of name, 46.8% one-line and
  13 names on three lines.
- **Alternatives rejected:** one sort default for both tables — they
  answer different questions and only one has a cap; a row cap kept:
  cap-then-sort (built — honest about which rows hide, silent about
  where they reappear), a second `<tbody>` "Less Likely" tail
  (duplicates kind groups either side of the line), relabelled buttons
  (each label describes the mismatch; the clip removes it); a
  segmented sort pill (built, replaced — two stacked pills read as two
  tab rows); three ways to keep ★ in the row, all rejected once the
  movement was measured: an order snapshot (a header reading
  `Est. Per Run ▾` over rows not in that order), a level-independent
  sort key (does nothing for the ranked sort), that key plus dropping
  By Chance from editable tables (makes editable and locked tables
  behave differently); freezing the sort while a control has focus —
  it reorders the moment you look away.
- **What would change my mind:** per-spark affinity modifiers, which
  make ranking informative on ancestors and collapse the asymmetry;
  anything focusable landing in the trainee's table — clipped rows
  stay in the DOM, and a hidden control is worse than a hidden row;
  find-in-page jumping to text inside the clip proving a real
  nuisance rather than a theoretical one.

## 35. Spark entry is a popout browser, with favourites on top

- **Requirements:** issue #28, the first consumer of the watched-spark
  store. (#41 later made the popout the whole editor, retiring the
  `Added` marker and the add-only framing.) Hand entry was
  search-only: typing `s` returned 8 of 309 matches and "301 more —
  keep typing to narrow" — the app honestly admitting it cannot answer
  a browse. Entry now also carries the ★ level (#34), and favourites
  must not flood #27's uncapped block with filler.
- **Choice:** one full-width `Add a Spark` button opening a popout
  that lists all 432 with favourites first — the filter panel's own
  `.uma-popout` dialog idiom, not a fourth list style. It REPLACES the
  inline search: the popout carries its own search box, so keeping
  both is the same search, ★ picker and Added marker in two places,
  drifting. The costs — one click per node, and the proc table behind
  the overlay — are accepted because #34 already ruled that table a
  readout consulted after the decision. This reverses #30's "an
  add-one affordance, not a browser" knowingly: that objection was to
  432 undifferentiated rows under every panel, and a list behind a
  button headed by your favourites defeats it. Favouriting and adding
  are different acts and neither writes the other: auto-favouriting on
  add sends every filler white into #27's uncapped block, moves the
  row out from under the pointer as favourites re-sort (#34's failure
  by another route), and couples a local autosaved edit to a server
  round-trip. The Hunting pill sits in the chooser on its own line,
  watched rows only (a fifth control inline takes the width names need
  at 358px); groups deferred — nothing writes them yet. Which sparks
  sit in Favourites is snapshotted at open — only the ordering
  freezes; ★ and pill stay live — so starring a row doesn't yank the
  add buttons you were reaching for; a favourite renders in Favourites
  only, never also in its kind section (#45's duplication). The kind
  tag stays, against #30's tables: here you pick BETWEEN kinds, and
  race/scenario sparks share wording with skills. A failed watched
  fetch costs an ordering and nothing else: all four kinds browse,
  every add works, ☆ disabled rather than hidden, the reason said
  inside the popout — a load-time toast would fire for everyone whose
  list is merely empty. `watchedFailed` is a flag beside the list,
  because an empty array can't say which it is; writes are
  non-optimistic — the star moves once the row exists. One search
  rule for every section: the query filters, section order never
  changes, empty sections disappear, hits rank by where the query
  lands in the name (#30's ranking; nothing capped, so the "N more"
  line is gone); the box is sticky. Browse sections run in
  `SPARK_TYPE_ORDER`, exported from `procs.ts`, so picking order and
  reading order are one constant. A watched spark the reference can't
  name is offered as `Unknown (key)`. Locked and pulled nodes offer no
  entry (#28). Measured, both widths: trigger 267px in the 301px
  sidebar; popout 520px desktop / 358px at a 390px viewport, no
  horizontal scroll either way; names wrap and are never ellipsised —
  432/432 one line at 520px; at 358px 89.1% one line, 47 take two,
  none three, none clipped. The Hunting pill's line break is on a
  wrapper, not the button — flex-basis 100% IS the button's width,
  which the screenshot caught stretched past the row.
- **Alternatives rejected:** an inline list — 432 rows under every
  ancestor panel pushes the map off a 390px screen; the popout costs
  zero height closed; keeping the inline search beside it — a second
  copy of one surface, not a second mode; favourites as a separate
  store from the watched list — one row expresses "quick to type" and
  "breeding for this" without asking which list on every row; reusing
  the roster-mark idiom — marks are a fixed vocabulary of
  server-known ids, watched sparks an open user-authored set over a
  432-entry reference; they share the word "favourite" and nothing
  else; adding also favouriting — the shortest path to #27's block
  being useless; a `stars` field on the watched row — the level
  belongs to the slot document, where it means something; collapsible
  kind sections — five disclosure controls to solve a scroll.
- **What would change my mind:** the popout's modality costing more
  than the inline search did — open, add, close, check on a loop means
  the chooser wants to be a panel, not an overlay; favourites growing
  past one scroll, which wants grouping; the 432 eagerly-rendered rows
  measuring badly on a real phone if the reference grows.

## 36. Greens are card-bound, and the chooser's first review

- **Requirements:** #35 offered all 137 greens on every node. Jason:
  an uma can LEARN another's unique during a run but can never carry
  the SPARK for one. Measured three ways, agreeing exactly: the
  reference holds 137 uniques over 83 characters; 95 of the 97
  released cards have a unique factor at their own card id (the two
  exceptions are the `91xxxxx` NPC range); and across a real roster —
  1,372 rows — every green is its carrier's own `card_id`, zero
  exceptions.
- **Choice:** one rule, three tiers, client-side: card known → her
  card's unique, one row or none; chara known but not the card → that
  character's 1–3 variants; neither → all 137, each named with its
  owner. Only `unique` is card-bound — pink, race, white and scenario
  belong to anyone. An uncast node keeps the full list (Jason's call):
  #30 allows a sparks-only slot, and a green is how you say "a Special
  Week parent" before casting one. The owner label drops `[Original]`
  — 62 of the 95 are the base outfit, so it distinguishes nothing
  (median label 23 → 14 characters); it is suppressed entirely on a
  cast node. The server rule is deliberately NOT here — filed as #58:
  `BlueprintOut` is strict, so a stored mismatched green would 500 the
  whole blueprint list; that needs a survey and a write-only rule.
  From the two review rounds run over this work (the first ran after
  merging — the wrong order, and why the order changed), the rules
  that still govern the code: a re-pick DROPS a foreign green and
  keeps everything else — `applyPick` carries a slot's sparks across a
  character or outfit change, so an offer-time-only rule left a green
  bound to a card nobody in the tree holds, silently feeding proc
  estimates; it is also the case #58 cannot catch, since the client
  wrote the document. The Favourites section freezes MEMBERSHIP, not
  the `watched ∩ snapshot` intersection — the intersection made an
  un-starred row vanish from the popout entirely. `setFactors` takes
  an updater, not a finished array — the popout stays open across
  adds, and two clicks against one render replaced each other
  wholesale. The popout's remount key is a generation counter, bumped
  by every fetch that lands and never by a write — a boolean cannot
  change on the retry path it exists for, and a write bump remounts
  under the pointer that just clicked. Spark-write failures go to the
  page toast, which is drawn over the backdrops and survives the
  popout closing. The first-section spacing rule is `:first-child`
  inside a wrapper holding only the sections — three positional
  selectors in a row matched the wrong element (`:first-of-type`
  matches on TAG, and the search band is also a `div`). One finding
  measured and declined: 432 rows re-rendering per keystroke costs
  186 ms on the first character at 4× CPU throttle and 33–84 ms after,
  because the list collapses immediately; memoising wouldn't help —
  the cost is unmounting ~420 rows. One reported-severe finding is
  unreachable (a settling fetch overwriting a mid-flight favourite:
  measured 0 rows/0 stars during the mount fetches, 432 stars/0
  enabled during a retry); the eight-line guard went in anyway with a
  comment saying it cannot fire — both windows are closed by accident
  rather than design, and #27 adds a second reader of the list.
- **Alternatives rejected:** hiding the Green section until a
  character is cast — contradicts #30 for one kind and takes the green
  away from the sparks-only plan it explicitly allows; the full list
  on cast nodes with only the label fixed — leaves the false proc
  estimate reachable; landing the server validation here — see #58, it
  can make a saved document unopenable; the owner on its own line —
  measured worse: 24 of 137 rows took three lines at 358px against 9
  inline with `[Original]` dropped (#34's "no third line" was a rule
  for a fixed table row where the ★ column must align, not a scrolling
  browse list).
- **What would change my mind:** blue sparks arriving — stat sparks
  are not card-bound, so they join the "belongs to anyone" side and
  the rule does not move; a card gaining a second unique at a key that
  is not its own id, which breaks the identity this rests on; the
  uncast list proving to be how people actually pick greens, which
  argues for sorting it by uma rather than by spark name.

## 37. Spark lists replace watched sparks: one table, and #33's premise

- **Requirements:** supersedes #33. Jason, asked whether the `hunting`
  bit was needed: users keep multiple named lists — Front Runner
  skills, Medium skills — and what they hunt "at a particular time is
  not always the same." The bit stored per spark what varies per
  session, so a Front Runner week → Medium week meant flipping it
  across dozens of rows; it had zero readers when found, the only
  reason the correction was free. The three consumers are unchanged
  (the chooser's Favorites, #27's block, hunted-skill scoring), and
  lists must be first-class — created empty, renamed, deleted: #33's
  derived vocabulary cannot represent an empty list, silently destroys
  one when its last spark leaves, and forks `Front Runner` from
  `Front runner` with no way to notice.
- **Choice:** one table, `spark_lists(name, position, sparks)` per
  owner; `sparks` a JSONB array of `{kind, key}` — the identity every
  spark surface uses, never a name (#30). Favorites is the union of
  the lists, deduped; there is no watched-but-ungrouped state — filler
  is just a list you make, and a second table plus the integrity
  between them wasn't worth the one click it saves. Membership lives
  on the list, not the spark: the list is the object with a lifecycle,
  so deleting one deletes a row and nothing else — both spark-side
  shapes leave dangling ids behind. Order is the array's order, and
  the list records WHICH sparks, never the ★ level (the slot document
  owns that — #33's surviving ruling). The active selection is
  device-local `localStorage`, multi-select (Jason: "device only for
  now" — a view, not a fact about the roster); nothing selected shows
  everything, since every user starts with no lists and an empty first
  run reads as broken. The ★ opens a multi-select picker showing
  current membership — Jason's call over "add to the active list",
  which has no unambiguous referent with several active — so it is
  also the membership editor and holds `New List`; creation only, with
  rename/delete/bulk going to #70's management page. `New List` is a
  `POST` then a `PATCH` — one shape for membership, measured 45 ms end
  to end locally; over a tunnel it doubles a non-free round trip,
  which is #69, filed to revisit after deploying along with optimistic
  writes. Names are unique per owner IGNORING case — a unique
  expression index on `(owner_id, lower(name))`, stored as typed: this
  is a phone-first PWA and mobile keyboards autocapitalise, so the
  duplicate arrives by itself (the first cut shipped a byte-exact
  constraint while citing #33's fork as the argument). Membership is
  unbounded: there are 256 whites alone, and the reachable maximum IS
  the reference size, which grows with the game, so any constant ages
  into binding too early — the 200 cap and its chunked backfill
  produced three defects and were deleted whole; nothing configures a
  request-body bound either, accepted rather than overlooked (a real
  bound belongs at the transport). `MAX_LISTS_PER_OWNER` (50) stays —
  no reference decides a ceiling for named builds, so it bounds rows
  without sitting in the path of use. The list cap takes
  `pg_advisory_xact_lock`; its test asserts the outcome and is NOT the
  guard — measured, it passes with the lock removed, because the test
  client drives concurrent requests through one connection. The
  migration drops `watched_sparks` without carrying rows (Jason's
  call; the table was empty anyway). Last-write-wins on the list row
  was tolerated, not closed (issue #66) — one user, two devices, the
  damage a spark you re-add; #48 has since closed it by moving
  membership to rows. Three review rounds each found most of their worst
  defects in the previous round's fixes; the speculative multi-device
  recovery machinery (the corrective reload and its guards, a lenient
  read that turned a loud failure into the client deleting rows on its
  next whole-array write, a focus restore that captured
  `document.body`) was deleted rather than fixed again and filed as
  #73–#76. What survived is simple and checkable: the folded index,
  the removed cap, two distinguishable 409s, `PartialWrite` handing
  back a committed list the failure path had discarded, the advisory
  lock.
- **Alternatives rejected:** keeping `hunting` and deciding its
  default at #27 — the bit's subject was wrong, not its default; a
  registry table plus `groups: int[]` on the spark row — fixes empty
  lists and renames, but deleting a list leaves dangling ids and
  membership is still a whole-array replace, so it buys a table and
  closes nothing; a registry plus a membership join table — the only
  shape that closes the race and keeps integrity both ways, adopted
  when concurrency stops being hypothetical, not for a failure a
  single user does not have; the ★ adding to the active list; a
  server-side active selection — view state, #32's line holds.
- **What would change my mind:** genuine concurrent use — a second
  person on the account, or one person losing sparks across two
  devices — which turns the join table into the right answer (fired:
  #48 adopted it); a
  favourite that belongs in no build proving a real want, which brings
  back a standalone watched set; the active selection needing to
  follow between devices, making it a user setting rather than a view;
  lists growing attributes of their own — fine on this shape, and only
  an argument for normalising if the membership is what grows them.

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
  `SparkRef`; strict on read too, which a data migration makes safe: it
  deletes any entry outside the set at upgrade, so the strict read can
  never meet a row that predates the rule (a survey found zero, but a
  survey is one database at one instant). A 1★ blue is over the
  per-event cap at any real affinity, so its row reads ~100% — true,
  and the cap finally visible on screen. The trainee's height clip
  (#34) needs no blue policy: it folds whatever order the sort
  produced. Two rollout facts, accepted: a pulled branch saved before
  this carries no blue until it is cleared and re-pulled — the same
  rollout #30's factors had, and the document's absent-reads-as-none
  makes it silent; and a client build predating the kind refuses a
  blue-carrying document until its service worker updates — unreachable
  while hosting is local-only, worth remembering at deployment.
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

## 41. Edit Sparks: the popout edits, the table displays

Issue #86, carrying #74. Reverses named pieces of #34 and of #35,
marked in each.

- **Requirements:** editing a member's sparks was split: add + level in
  the popout (#28/#35), remove via a ✕ in the proc table (#34), a
  mis-level fixable only by drop-then-re-add across the two. The one
  remover must reach everything held — a spark the reference can't
  name, a foreign green in an old document (reads stay permissive,
  #39) — and no row may move or vanish under the pointer or focus.
- **Choice:** the button becomes **Edit Sparks**, and the popout is the
  one editor: add, re-level (in place, via `factorsWith`), remove — a
  held row keeps its three stars live with the current level pressed,
  the pressed star a no-op, plus the ✕. Held-ness is row STATE, never
  row position, and which rows EXIST is frozen per open: a spark the
  reference can't name gets a degraded "Unknown (key)" row atop its
  kind section, and a foreign green keeps her row with only the ✕
  live — a re-level would 422 like the add it is. A **Current Sparks
  pill** filters the browse to the member's own rows, snapshotted when
  pressed, disabled where she holds nothing. Every table is the locked
  two-column readout (names 122→171px in the 301px sidebar). #74:
  focus is captured in the click handler, restored to the control
  where it survived, else to the row ITSELF — its first button is the
  1★ add under an auto-repeating Enter. The ✕'s 24px slot is held on
  every row: one that materialized with the add measured a 27px shove
  of the stars under the pointer. 111px of name at 358px — 66.1% of
  all 437 names on one line, none on three.
- **Alternatives rejected:** *a Current Sparks SECTION on top* — frozen
  it was stale (an add surfaced next open), live it tore the row out
  from under the pointer; the filter gets freshness and stillness at
  once. *Toggle-off on the pressed star* — the idlest click would
  delete. *Keeping the table's ✕* — one remove on two surfaces,
  drifting. *Exempting held rows from greenFilter LIVE* — the foreign
  green's row unmounts with its own ✕ click, reopening #74 in the one
  case the exemption exists for. *Focus restore from an effect
  observing `busy`* — runs after the disabled state commits, so it
  captured `<body>`; shipped as a no-op and reverted (#74). Do not
  re-attempt.
- **What would change my mind:** sessions turning out to be mostly
  re-levelling a settled build — the popout's modality then costs more
  than #35 priced, and the editor wants to be a panel beside the
  table. The press-time snapshot confusing anyone ("why is the removed
  row still here") would argue a live filter and a different stillness
  fix. A third surface removing sparks would reopen the one-remover
  rule the green exemption leans on.

## 42. Pink joins the popout, as its own rows

- **Requirements:** issue #87 — once blue landed (#40), the pink was
  the one spark kind the popout didn't offer, so shaping a proc
  profile on the Sparks tab forced a tab switch for exactly one kind.
  A second entry point, not a move — amending #30's "the pink stays
  on Details" to name Details the home editor: it keeps its place
  beside the letters the pink bumps (#26/#30). Client-only — the slot's
  `spark` field and its validation don't change. #86's held-row
  invariants hold in the new section.
- **Choice:** a **Pink section between Blue and Green** — the slot
  `SPARK_TYPE_ORDER` already reserves — with ten rows from the
  client's own aptitude vocabulary (`APTITUDE_LABELS`), a PARALLEL
  row shape rather than a sixth `Option` kind: the document keys a
  pink by aptitude on the slot's own `spark` field, not by factor
  key, so the rows never pass through refs, orphans or the green
  possibility rules, and the popout writes through the same
  `onSetSpark` setter Details uses — a second writer of one field,
  never a second store, so the Details select follows every write.
  **Replace across the whole section**, #40's blue rule held one
  shape further: one member, one pink, ten rows it can sit on —
  clicking any star moves it, and row existence is trivially frozen
  (all ten aptitudes, always). A star that would displace the held
  spark of a one-per-member section says so — "Replace Mile with
  Turf at 2★", pink and blue both — since the displaced row's change
  happens off-focus, where "Add" reads as a second spark. The below-A
  guardrail echoes on a bar pinned to the popout's bottom edge — the
  popout covers the focus panel's own alert, so the second writer
  carries the warning at the moment of the write. Pinned, not in the
  Pink section: appearing there shoved every row under the pointer
  (#41's rule, vertical) and a query could hide it; and without
  `role="alert"`, so the panel's copy stays the one live region.
  **The held row keeps the ✕**: every held row keeps one anatomy, and
  the popout can clear the one spark it could otherwise only move;
  Details' select staying a second clearer of the field is accepted.
  **No ★ ever**: pinks aren't listable — the server refuses the
  kind, and a hunted build is named by its skills, not its aptitude.
  The pink joins the Current Sparks pill's count and press-time
  snapshot with the rest of what the member holds.
- **Alternatives rejected:** *pink as an `Option` through
  `/api/factors`* — the reference serves no pink rows and the
  document doesn't key one by factor key, so forcing it through
  would mean inventing keys only the client understands and
  translating at both ends of one component. *No ✕ on the held pink*
  — the one held row with a blank ✕ slot beside a blue's ✕ reads as
  broken, and the only in-popout clear would be gone, reinstating
  the tab switch #87 exists to remove. *Moving the pink editor onto
  the Sparks tab* — the Details pairing is the causal display (#30),
  letters beside the pink that bumps them; this is an addition.
- **What would change my mind:** the game gaining multi-pink members
  — the parallel shape collapses into `factors`, and replace
  semantics and the single-`spark` field fall with it. Pinks
  becoming huntable (say the skill-spark scoring milestone reaching
  aptitudes) would argue the ★ and list membership back.

## 43. The active lists are a filter, on every spark surface

- **Requirements:** issues #67 + #27. #37's device-local selection
  needs a control and a consumer: something must set which lists are
  in play, and the proc tables must be readable against what you are
  hunting — including a spark no ancestor carries, which ranking can
  never surface. Empty selection means everything (#37); rename and
  delete stay on #70's page; no server persistence (#37). No hue for
  the highlight (the kind colours are the game's own, #41); nothing
  focusable inside the clipped table (#34); and the popout is the
  only add path, so no selection may make a spark unaddable.
- **Choice:** one selection, one **Lists disclosure** — a counting
  button ("Lists · 2") opening a scrolling menu of `aria-pressed`
  pills, since lists cap at 50 and the control sits on every Sparks
  panel and the popout's sticky band. Pressed sources **union**:
  whatever is selected, all of it shows; Current Sparks alone stays
  an exact held snapshot, the query narrowing within it. **The
  filter only speaks the listable kinds** — blue, pink and green
  narrow only under a solo Current Sparks, since a list cannot name
  them and a verdictless pass must survive a second press. Under
  lists, the **query bypasses** their terms and held rows (at open
  or now) are exempt, so nothing is unfindable, unreachable or torn
  from under a pointer. An **empty union imposes no filter**, and
  the unfiltered tint stays the union of ALL lists — never a pressed
  control over an untouched table. Every proc table takes two states
  through one derivation (`filterProcRows`): unselected, own rows
  with listed sparks tinted (lightness and weight only); selected,
  the listable rows swap for the chosen union, "—" where uncarried,
  members keeping ★ levels, **never clipped** (bounded by the lists,
  and the fold's honesty rule inverts over rows sorted "—"-last).
  Popout presses snapshot membership; the panels' are live — those
  tables have no pointer targets. Filter-on is the `.seg.active`
  blue, never the membership gold.
- **Alternatives rejected:** *a stacked Watched block above the
  ranked table* — a second table idiom spending #30's reflow budget,
  when the filtered view absorbs the "—" rows the block existed for.
  *Pinning watched rows above the fold* — the cap is honest only
  while what's hidden is the least likely. *A hue-carrying tint* —
  reads as a seventh kind. *A flat always-visible pill row* — fine
  at four lists, unusable at forty, on every panel. *AND composition
  of the pills* — a press that removes rows another pressed pill
  promised reads as broken; the pills are sources, not dimensions.
  *Fallback-to-all inside `chosenLists`* — deselecting the last pill
  would re-filter to everything as if selected.
- **What would change my mind:** the selection needing to roam
  devices — that reopens #37's rejected server column, not this
  shape. The trainee's table gaining a focusable control, which
  kills the clip assumption the live pills and the tint lean on.
  Wanting "what will I get" and "what am I hunting" at once — that
  is the stacked block coming back.

## 44. The lists get a page: create, rename, delete, sort, edit sparks

- **Requirements:** issue #70 — #37 deferred rename, delete and bulk
  membership here, and until Delete exists the 50-list cap is a
  deadlock: at cap, `POST` 409s with no in-app way to free a slot.
  Design review set the rest: no manual reorder (sort orders instead —
  name, newest, last edited), creation joins the page rather than
  staying picker-only, and the membership popout must not filter by
  OTHER lists. Last-write-wins on the list row stayed accepted at the
  time (issue #66; closed since by #48); the ★ picker stays the
  per-spark control.
- **Choice:** a third route, `/lists`, page-local state — pages
  refetch on mount, so a store lifted to the shell would be the staler
  copy, and nothing user-held dies with this page. Rename is the
  blueprint idiom (the field IS the name, commit on blur, a refused
  draft kept for correction); create is the picker's `New List` field
  at page scale. The rows sort by a device-local selector, a view like
  the active selection: `position` is STRIPPED from the table and API
  (nothing ever set one — every row still held its create-time append
  value, so the column was `id` order wearing a second name) and
  `updated_at` added for Last Edited, DB-generated so every writer
  agrees on it. Editing membership is a NEW list-scoped popout
  ("Edit Sparks", matching the chooser's naming) sharing the popout
  CSS and ranking comparator — rows toggle with the same per-toggle,
  non-optimistic writes as every list surface, so Escape can close at
  any moment with nothing staged. Members at open sit pinned in an
  **In This List** section on top and nowhere else — the chooser's
  Favorites shape (#35/#36), frozen per open, so the membership is
  reviewable without hunting the kind sections and un-toggling keeps
  the row in place for the mis-tap. No list filter inside it: it
  edits one list, and what other lists hold is #43's control on the
  proc surfaces, not this one's. The page's membership chips are
  display-only: one write surface per list, and rows that cannot move
  under a tap. `detailOr`, `refocus` and the query comparator moved
  to shared modules for the second consumer.
- **Alternatives rejected:** up/down reorder buttons — built and cut
  at review; a hand-curated order is upkeep the sorts make free, and
  it cost a column plus renumbering writes; drag-and-drop — same,
  plus pointer/a11y cost at 390px; a `created_at` column — `id`
  already carries creation order; extracting the chooser popout's
  browse layer — bound to the slot document (stars, greens, a pink)
  and the invariants of four review rounds; batch-membership-on-close
  — the unconditional Escape would discard staged work or demand a
  confirm, against the app-wide non-optimistic rule; lifting the
  store into `App.tsx` — relocating the Designer's write-race guard
  and epoch machinery (issue #89's surface) for staleness that
  refetch-on-mount already bounds; an etag/version on the row —
  issue #66's territory, not this page's.
- **What would change my mind:** a real want for a hand-arranged
  order — that reopens reorder UI, and `position` comes back by
  migration; the sort needing to follow between devices (a user
  setting, #32's line); real cross-device collisions (issue #66 named
  the join table; #48 adopted it); per-toggle writes turning chatty
  over the tunnel
  (issue #69's revisit, which would bring optimistic staging); a
  third page needing the lists, which is when the store lifts.

## 45. The card caption cycles by hand, and pink joins the sorts

- **Requirements:** issues #44 and #40 — the line under a card's art
  (the score, or the own-spark strip) was welded to the sort: the
  strip showed only under the Sparks sort, so reading sparks meant
  giving up the order you wanted, and in the designer's picker the
  pink — the value a roster pull is really after, and the input to
  every career-start bracket — lived in title/aria only. `rank_score`
  enters no affinity term and no inheritance bracket, yet was the
  only sortable number; the pink was not sortable at all.
- **Choice:** the caption becomes its own control: a `CaptionMode`
  (`score | sparks`) stepped by a cycle pill in each dock, fully
  manual — picking the Sparks sort no longer switches it — and
  persisted per surface (`umalab.caption`, `umalab.picker.caption`),
  both defaulting to Score. A future mode (matching sparks against
  the active lists; matching races once schedules exist) is one
  tuple stop, one label, one render branch. `pink_spark` joins
  `SORTS` as the blue rank's analogue over `pinkOf` — aptitude in
  the game's group order (Track → Distance → Style), star within
  it, no-pink before 1★ Turf — which moved `pinkOf` from
  blueprint.ts into domain.ts (blueprint already imports domain, so
  the rank could not import back). Issue #40 resolves with no new
  surface: the picker's pink is one cycle away, and the catalog
  chips stay tooltip-only.
- **Alternatives rejected:** the caption following the sort — the
  behavior this replaces (amends #11); auto-switching to Sparks
  when the Sparks or Pink sort is picked — the same hidden coupling
  back, one convenience at a time; defaulting the picker to Sparks —
  considered for issue #40's sake, but both surfaces opening on
  Score keeps them predictable, and the mode is sticky after one
  tap; name captions under the catalog chips (issue #40's other
  half) — the tooltip and the search box already answer it, and
  #11's icon-only rule holds; a segmented control in the dock —
  two pills' width for one pill's job at two modes.
- **What would change my mind:** a third or fourth mode making the
  blind cycle order annoying — the pill becomes a menu or segmented
  control; tooltip-only catalog chips failing on touch, where hover
  never fires — captions return via an opt-in chip prop; the mode
  needing to follow between devices — the DB settings table #11
  already reserves.

## 46. The phone focus panel is a bottom sheet

- **Requirements:** issue #43 — at ≤860px the stacked layout made the
  designer's core loop (tap a node, read its panel, tap the next) a
  ~700px scroll round-trip per node, measured at 390×844 with the map
  at 707px in an 844px viewport and the panel starting 194px below a
  fully-scrolled map's fold; the shipped `scrollIntoView` pan fixed
  only the downward half. The map must stay tappable while the panel
  is up — swapping nodes is the loop, not an interruption — and the
  Edit Sparks popout renders inside the panel and must keep working.
- **Choice:** the existing `.focus-dock` becomes a fixed, non-modal
  bottom sheet inside the 860px media query: opened by map taps only
  (the toggle and picker set selection without yanking a sheet up),
  dismissed by a mousedown anywhere off it — map chips and the side
  toggle exempt (selection controls swap the content), the picker
  layer and its filter wrapper exempt (they float above) —
  display-toggled so FocusPanel's tab state survives, z-index 7
  (over the sticky toggle, under the popout layer), a fixed 70vh
  height so the top edge never jumps on a tab switch, and matching
  bottom clearance on the open combo so the tree's last rows scroll
  above it. The pan and its `scroll-margin-top` are removed. Chrome
  reclaim rides along at ≤640px: `.import-info` hidden (fine print,
  no other surface), `.bp-picker` flex-basis 0 so the autosave
  status stays on the save bar's row.
- **Alternatives rejected:** *a modal sheet with backdrop* — kills
  tap-the-next-node, the loop the sheet exists for. *A dismiss bar
  on the sheet* — shipped first and cut in review: full-width but it
  read as a small icon, not an affordance, and spent a row of the
  sheet on what tap-off gives for free, in the idiom the popout
  backdrops already taught. *A content-driven height* — also cut in
  review: the sheet's top edge jumped on every Details↔Sparks
  switch. *An onClose prop through FocusPanel* — threads a phone
  concern through four render branches. *A generic sheet component*
  — #97's ruling: extraction waits for a third surface. *An Escape
  handler* — the chooser's window-level Escape closes
  unconditionally, so one press would close chooser AND sheet, and
  the guard needs a DOM sniff; keyboard users still reach the whole
  map by scroll, the clearance guarantees it. *A slide-up transform*
  — a transformed dock becomes the containing block of the fixed
  popout rendered inside it, breaking its centering.
- **What would change my mind:** keyboard users on narrow desktop
  windows needing a dismissal — Escape behind the `.uma-popout`
  DOM-presence guard is the cheap retrofit; short panels leaving
  most of a 70vh sheet empty often enough to grate — a second,
  shorter detent, not a content-driven height; a third fixed
  surface wanting this shape — that's #97's extraction trigger.

## 47. Generations 3–4 collapse into per-grandparent strips

- **Requirements:** issue #46 — gens 3–4 are 24 of the 31 nodes and
  ~40% of the map's area, each showing at most a portrait and one
  pink; an empty blueprint rendered 24 identical dashed placeholders
  as its visually heaviest feature, and in the 860–1150px band the
  gen-4 cells compressed to 33–44px and truncated to "Aptit…". The
  bracket math reads only the summed matching ★ over a node's window
  (#25: the deep slots are "spark bundles by design", existing to
  feed the letters two rows up). Expansion is view state — the
  `slots` document only grows by optional fields — and the e2e
  navigates by `"<node> — "` aria-label prefixes.
- **Choice:** per grandparent, her six deep cells render only while
  her branch is expanded; collapsed, a `g2-strip` button footing her
  card carries `windowStars` summed per aptitude (stars-desc, ties
  in game order, top three + "+N") — lossless for the number the
  slots exist to feed, stated next to the letters it explains. The
  strip is a sibling of the chip (a `<button>` can't nest one),
  labelled "Sparks Below …" so no chip locator can match it, and in
  the sheet's tap-off exempt list. Collapsed cells leave the DOM —
  placement is explicit `grid-row`/`grid-column` (auto-flow would
  pull an expanded branch into a collapsed sibling's columns) — and
  the grandparent's wire descender moves to the open strip; closed,
  nothing draws downward. Default expanded only where a
  hand-authored deep spark sits (`handAuthored`; pulls are recorded
  history the strip sums), recomputed per blueprint open, held as
  page state like the selection. A selected deep node derives its
  branch open (the `shownSide` pattern), so no path shows the panel
  a chip the map dropped; collapsing the selected branch moves
  selection to the grandparent. Measured: intrinsic width 735 → 713
  collapsed — the grandparent row was always the second constraint —
  but the compression band's victims are gone rather than squeezed,
  and at 900px the full letter grid renders untruncated. Mid-session
  edits never auto-expand or auto-collapse; a pull or Clear changes
  the strip's sum, not the view. Tree Half stays — whether the
  collapsed tree obsoletes it at 390px is a follow-up measurement.
- **Alternatives rejected:** *issue #26's orientation toggle* —
  closed in favour of this; height already binds at 390px, and a
  second orientation is a second layout to maintain. *Persisting
  expansion* (document or localStorage) — the document invariant
  forbids the first; the second needs per-blueprint keying for a
  state cheap to re-derive. *Listing individual slots in the strip*
  — the brackets read the sum; slot positions are noise at strip
  size. *`display: none` collapse* — hidden cells still satisfy
  attribute locators while showing nothing, and absence already
  means "not shown" (the half tree). *Auto-expanding pulled
  branches* — a full pull would open both sides and give back most
  of the width.
- **What would change my mind:** matched-vs-unmatched highlighting
  (the issue's stated next step) needing per-slot rendering — the
  strip regrows detail then, not before; users re-expanding the
  same branches every session — persistence keyed by blueprint id;
  opening all four one strip at a time grating in practice — an
  expand-all affordance composes with per-branch state and gets
  ADDED, never swapped in for it (global-only can't express the
  mixed default or open just the selected branch); the collapsed
  full tree measuring readable at 390px — Tree Half's removal
  lands as its own change.

## 48. Membership as rows: spark_list_members and per-spark verbs

- **Requirements:** issue #66 — membership as a whole-array PATCH
  computed from the caller's copy made every pair of concurrent edits
  to one list last-write-wins, both writers told 200. Its absorbed
  repros hardened the bill: Escape closes the chooser without checking
  `busy`, so one device races itself (was #74); a deleted list's pill
  dead-ends, because both corrective-reload fixes remounted the popout
  mid-interaction and were reverted (was #73); one unparseable JSONB
  entry 500s the owner's every list, and leniency would make the loss
  silent since the next whole-array write deletes whatever was dropped
  (was #75). Multi-user shipped (#32), so #37's "genuine concurrent
  use" trigger has fired, and the fix had to satisfy all four repros.
- **Choice:** membership rows in `spark_list_members` — `list_id` FK
  CASCADE, `kind`, `key`, unique per triple, serial id as display
  order (a re-add lands ON CONFLICT DO NOTHING and keeps its place;
  removed-then-re-added moves to the end, what the old client-side
  filter-and-append did). Adds and removes are their own idempotent
  verbs, PUT/DELETE `/api/spark-lists/{id}/sparks/{kind}/{key}`,
  answering the list's current state so toggles converge devices; the
  PATCH is rename-only and a stale client's `sparks` array 422s
  loudly. Both verbs bump `updated_at` by hand (the ORM `onupdate`
  never fires for member writes) and only when a row changed. The
  CHECK on `kind` mirrors `ListSparkKind`, which is what lets
  `SparkListOut` stay strict: a row it cannot parse is now
  unrepresentable. The GET's wire shape is unchanged — bare
  `{kind, key}` in member order — so every reader and the e2e's
  payload comparisons are untouched. Client side, `toggleMembership`
  picks the verb from its copy (a stale copy at worst flips one spark
  the wrong way, and the response corrects the display), and a 404
  throws `ListGone` carrying the lists with the dead one dropped,
  which both write helpers adopt in place — no reload, no `epoch`
  bump, no remount. The migration backfills the arrays
  order-preserving (INSERT..SELECT WITH ORDINALITY, ORDER BY) and the
  downgrade rebuilds them; both halves are pinned by a seeded
  migration test, since the schema-parity test only ever runs the
  chain empty.
- **Alternatives rejected:** a version/etag column with a 409 the
  client retries — detects conflicts instead of removing them, leaves
  the strict read all-or-nothing (#75 stays open), and puts
  retry/merge machinery on the client, where #37's review rounds kept
  finding defects; UI guards for the Escape race — the reverted
  busy-gate fix swallowed the keypress and hung the e2e, and commuting
  writes make the interleaving harmless instead; a lenient read —
  destructive under whole-array writes, unnecessary once bad rows are
  unrepresentable.
- **What would change my mind:** membership growing per-member
  attributes (stars, notes) — the rows are ready and the wire shape
  grows optional fields; bulk edits wanting one request (issue #69's
  round-trip audit) — a batch verb over the same rows, never the
  array PATCH back; a real want for hand-ordered members — serial-id
  order stops sufficing and a position column returns by migration.

## 49. One-shot create, and the flip is the record

- **Requirements:** issue #69's two deliberate costs, revisited ahead
  of the tunnel deployment where a round trip stops being free: the
  picker's `New List` was a POST plus a member PUT (a failure between
  them is what `PartialWrite` existed to carry), and every membership
  toggle awaited the server before the chip moved — 40–50 ms locally,
  a plausible 100–400 ms over the tunnel. This reverses the app-wide
  non-optimistic rule #37 set and #48 upheld, in writing, for
  membership toggles only.
- **Choice:** `SparkListCreate` grows `sparks: list[SparkRef]`
  (deduped first-seen, the idempotent-PUT answer), inserted in body
  order in the create's own transaction — a refused name or the cap
  leaves nothing behind, which retires `PartialWrite` outright.
  Toggles flip locally first: `withMembership` states an absolute end
  state against the caller's CURRENT lists (`onChange` accepts
  React's functional form), the request runs behind it, and a final
  failure re-states the last server-acknowledged membership (the
  flip's opposite when the chain is one write; a chain of failures
  breaks that equivalence, since superseded failures revert nothing)
  — never a snapshot, so concurrent pills cannot clobber each other. A settled response folds ONLY
  `updated_at` (later stamp wins): each response is the whole list as
  of that write, and folding it could resurrect an older membership
  when responses land out of order. Requests for the same
  (list, kind, key) chain behind each other so the last click's verb
  lands last; different pills stay parallel — and a failure a newer
  same-pill write supersedes resolves `null` instead of rejecting,
  because the newer verb owns the outcome and a toast for it is
  false. Create/rename/delete
  stay awaited under `busy` — a created chip needs the server's id —
  but resolve to FOLDS over current state, never arrays: pills stay
  clickable during the round trip, and an array built before it
  overwrote any flip that landed mid-flight (rename folds name and
  stamp only, by the same rule).
  Membership pills no longer disable, so #74's focus dance no longer
  applies to them (the e2e asserts focus stays put instead).
- **Alternatives rejected:** folding full toggle responses — the
  cross-device convergence it bought was accidental and it re-fights
  every in-flight flip (reload/`epoch` remains the wholesale refresh);
  a global write queue — serializes unrelated pills over a slow link
  for no correctness gain; an optimistic create under a temp id — the
  chip would need re-keying when the real id lands, and a failed
  create after the chip appeared is the hard case issue #69 itself
  names; an inline retry affordance on failure — new UI for a case
  the revert-plus-toast already explains.
- **What would change my mind:** same-pill chaining turning visibly
  laggy over the tunnel (rapid re-toggles queue a full round trip
  each) — #48's batch verb over the same rows; membership edits
  arriving from another surface mid-session (sync, import) — the
  flip-is-the-record rule then needs a reconciling fetch on a signal,
  not response folds. Both list surfaces share the toggle wiring
  (`toggleListSpark`), so a fix to the revert or `ListGone` path
  lands on both.
