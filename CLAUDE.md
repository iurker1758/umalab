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

Current milestone: deep-tree designer V2. V1 shipped — `/designer` is a
persisted four-generation aptitude calculator over the 31-node blueprint
document v2 (DECISIONS.md #25/#26). V2 restores roster pulls (additive to
manual entry, never replacing it — shipped, DECISIONS.md #28), then run
affinity on the trainee, then inspiration proc estimates.
Still planned: hunted-skill spark scoring
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

## Conventions

- Commits and PR titles follow Conventional Commits: `type(scope): summary` with
  types `feat|fix|docs|test|refactor|chore|ci` and optional scope `backend|frontend`.
  Squash-merge only — the PR title becomes the commit on `main`. See CONTRIBUTING.md.
- Branches: `<type>/<short-slug>`, e.g. `feat/roster-import`.
- Every non-obvious tech/design choice gets a `DECISIONS.md` entry:
  Requirements → Choice → Alternatives rejected → What would change my mind.
