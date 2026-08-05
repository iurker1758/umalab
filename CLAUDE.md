# UmaLab

Uma Musume (Global) roster web app: upload an UmaExtractor `data.json` dump →
browse your veterans with decoded sparks across the full 6-slot lineage.
Monorepo: `backend/` (FastAPI + async SQLAlchemy + Postgres) and `frontend/`
(Vite + React + TypeScript PWA). Why-docs live in `DECISIONS.md`.

Deployment target: app #2 on the HabitPool platform plan (that repo's
DECISIONS.md #9–10, #12) — frontend on Cloudflare, backend + Postgres on a
Raspberry Pi behind Cloudflare Tunnel, Cloudflare Access in front of both.
Local hosting in the interim — don't add cloud-specific config until that
work starts.

Current milestone: **multi-user** (issue #50, DECISIONS.md #32) — Cloudflare
Access is the login, a verified `Cf-Access-Jwt-Assertion` JWT is the identity,
and every roster/blueprint/mark row carries an `owner_id`. Shipped: the
`users` table, owner scoping across both routers, and the backfill migration.
That closes #50. The design-pass queue (#41 → #45+#29 → #28 → #27) has since
delivered #28 — spark entry is a popout browser with your favorites on top,
replacing the inline search and reversing #30's "an add-one affordance, not a
browser" in writing (DECISIONS.md #35), corrected in #36 — a green spark's
factor key IS a `card_id`, so a cast node is offered only her own green.
The server half of the green rule shipped with #58 (DECISIONS.md #39):
`BlueprintIn` rejects a foreign green on write, reads stay permissive.

**Spark lists (issue #39, DECISIONS.md #37) replaced the watched-spark list
of #33, which had the axis backwards.** A `hunting` bit stored per spark what
actually varies per session — which build you are working on this week, and
it can be more than one at a time. `watched_sparks` and `hunting` are dropped.
What replaced them is one table, `spark_lists`, holding `(name, position,
sparks)` per owner, with `GET`/`POST`/`PATCH`/`DELETE` under
`/api/spark-lists`. Names are unique per owner **ignoring case** (an
expression index; stored as typed). Favorites in the chooser is the **union**
of the lists, and which lists are *active* is a device-local `localStorage`
view, not a column. The chooser's ★ opens a picker of your lists rather than
toggling one flag — that is the only list UI so far, and it can only
**create**. Rename, delete and bulk editing are #70's management page;
choosing the active lists is #67. **#27 is the first consumer that makes the
active selection mean anything**, so it and #67 may want to land together.

Previous milestone: deep-tree designer V2, over the 31-node blueprint document
(DECISIONS.md #25/#26). Shipped so far: V1's persisted four-generation
aptitude calculator, and roster pulls — any node but the trainee can be
filled from your roster, which brings that veteran's real pedigree with her
and makes the branch read-only (DECISIONS.md #28), and run affinity on the
trainee's panel, attributed per ancestor (DECISIONS.md #29 — this was V2's
only backend code change), and inspiration proc estimates on a Procs tab in
the focus panel — every spark (pink, white, green, race, scenario) as the
chance the trainee inherits it, per ancestor and combined across carriers on
the trainee's own tab, labelled "est." (DECISIONS.md #30). Non-pink sparks
are part of the blueprint document as of that work — `factors: [{kind, key,
stars}]` on a named slot, decoded from the dump on a roster pull and typed in
against `GET /api/factors` otherwise. Manual entry stays the primary path
throughout. That closes V2's scope.
Still planned after that: hunted-skill spark scoring
(port of the pure `expected_sparks` before/after-reroll math from the
predecessor local tool). Leave room for it; don't build it early.

## Commands

Backend (from `backend/`, venv in `.venv/`):

- Install: `pip install -e ".[dev]"`, then `cp .env.example .env`
- Config: `app/config.py` (pydantic-settings) — env vars override `.env` override defaults
- Run: `uvicorn app.main:app --reload` (migrations must be applied first)
- Migrations: `alembic upgrade head` · new: `alembic revision --autogenerate -m "..."`
- Test: `pytest` · Lint: `ruff check .` · Types: `pyright` (strict; run with the
  venv active so it resolves site-packages)
- `tests/test_isolation.py`, `test_spark_lists.py` and `test_migrations.py`
  need a **second Postgres database** (default: the app's URL with the name
  swapped to `umalab_test`; `TEST_DATABASE_URL` overrides). They drop the
  whole schema, and refuse to run against the app's own `DATABASE_URL`.
  Without one they skip — CI sets `PYTEST_REQUIRE_DB=1` so the skip is a
  failure there (DECISIONS.md #32)
- Reference data: `python scripts/build_reference_data.py` (uma.moe key from
  `UMA_MOE_API_KEY` in `backend/.env` — gitignored, never commit it);
  `--mdb-only` regenerates just the client-sourced files (relations.json,
  races.json, aptitudes.json) from the local game client, no key/network
  needed
- Character icons: `python scripts/fetch_icons.py` (no key) →
  `frontend/public/icons/` — gitignored game art, fetched per clone/update,
  never committed (DECISIONS.md #10)
- Favorite-mark icons (tag badges): committed SVGs in
  `frontend/src/assets/marks/` — mostly Twemoji-derived (CC-BY 4.0, credit
  in README), two hand-drawn; not game art, no fetch step (DECISIONS.md
  #22). Tag ids live in `app/data/tag_icons.json` (committed) and must stay
  in sync with `MARK_IDS`/`MARK_LABELS` in `frontend/src/domain.ts` and the
  `MARK_ART` map in `src/assets/marks/index.ts`

Frontend (from `frontend/`):

- `npm run dev` (proxies `/api` to `:8000`) · `npm run build` (typechecks via
  `tsc -b`) · `npm run lint` (ESLint incl. react-hooks rules)
- Unit tests: `npm run test` (vitest, `environment: node`). **Pure modules
  only** — co-located `src/*.test.ts`, no jsdom and no component rendering
  (DECISIONS.md #30's amendment). It never reaches `e2e/`; the two runners
  stay two commands. `src/testing.ts` holds the fixture builders
- End-to-end: `npx playwright install chromium` once per clone (`npm ci` does
  not download browsers), then `npm run e2e` (Playwright, `frontend/e2e/`) —
  needs the backend and `npm run dev` already running. Baseline-relative and
  self-restoring: it derives its cast from `/api/catalog` and in `finally`
  deletes the rows it created — matched by name prefix or tracked at creation,
  never "everything new", so a blueprint you save from another tab mid-run is
  reported and left alone rather than deleted. Set
  `E2E_ARTIFACT_DIR` to capture screenshots at the moment of failure plus an
  `e2e-results.json` summary; CI does this and uploads them (DECISIONS.md #27).
  The roster-pull section derives its cast from `/api/veterans` and skips
  itself when there's nothing usable there — the suite never imports, because
  imports are full-replace and would wipe your roster. CI seeds
  `backend/tests/fixtures/roster.json` first and sets `E2E_REQUIRE_ROSTER=1`
  so the skip becomes a failure there (DECISIONS.md #28). To cover it
  locally, import that fixture yourself into a throwaway database

Docs: `npx markdownlint-cli2` from the repo root lints all Markdown (rules in
`.markdownlint.jsonc`; CI runs it as the `docs` job).

## Invariants — do not break

- `app/ingest.py` stays pure — no I/O, no ORM imports. All dump parsing and
  factor decoding lives there.
- Imports are full-replace snapshots in one transaction (DECISIONS.md #3);
  never upsert veterans across imports.
- Decoded factor entries always retain the raw `factor_id`.
- Reference data in `app/data/` is committed and regenerated manually via the
  script — the app never fetches from uma.moe at runtime.
- Schema changes go through Alembic migrations, not `create_all`.
- The blueprint `slots` document only ever grows by adding optional fields to
  the existing flat shapes. It's a JSONB column with no migration path, and
  `BlueprintOut` validates strictly — one row it can't parse 500s the whole
  blueprint list (backlog item, see DECISIONS.md #28 for the flat-vs-nested
  reasoning). Adding a field is free; restructuring one is not.
- The designer mirrors the game's tree rules client-side for grey-outs, but
  `app/schemas.py` stays the authority — every rule lives in both, and the
  server's 422 is what actually protects the document.

## Conventions

- Commits and PR titles follow Conventional Commits: `type(scope): summary` with
  types `feat|fix|docs|test|refactor|chore|ci` and optional scope `backend|frontend`.
  Squash-merge only — the PR title becomes the commit on `main`. See CONTRIBUTING.md.
- Branches: `<type>/<short-slug>`, e.g. `feat/roster-import`.
- UI **labels** are Title Case — buttons, headings, tab names, column headers,
  placeholders that name a thing ("Show All 34", "Run Affinity", "Est. Per
  Run", "Add a Spark…"). **Sentences stay sentence case**: empty states,
  warnings, hints, tooltips. Don't write prose explaining a number — the
  header, tag or ordering should carry it, and the reasoning belongs in
  `DECISIONS.md`.
- An **ellipsis means one of two things only**: work in flight ("Saving…",
  "Scoring…", "Importing…") or a value that hasn't resolved yet (the map's
  bare "…" for a name the catalog owes us). Buttons that open a dialog do
  NOT take one — "Choose Character", not "Choose Character…" — so the mark
  carries one meaning instead of four. Input placeholders keep theirs
  ("Add a Spark…"). Always the `…` character, never three periods.
- Every non-obvious tech/design choice gets a `DECISIONS.md` entry:
  Requirements → Choice → Alternatives rejected → What would change my mind.
  **Those four bullets and nothing else — no `###` subsections, and about 40
  lines.** Entries #1–25 average 30; the file's bulk is a dozen later ones
  averaging 200, which is where per-review-round narration and quoted
  conversation went. Record the decision and the trigger that would reverse
  it, not how it was arrived at. An entry a later one supersedes gets cut to
  a stub naming its replacement and whatever rules the code still cites (see
  #33) — never deleted, since code comments reference entries by number.
