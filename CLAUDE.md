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

Planned next milestones: hunted-skill spark scoring (port of the pure
`expected_sparks` before/after-reroll math from the predecessor local tool)
and an English inheritance-blueprint designer modeled on design.u-ma.org.
Leave room for both; don't build either early.

## Commands

Backend (from `backend/`, venv in `.venv/`):

- Install: `pip install -e ".[dev]"`, then `cp .env.example .env`
- Config: `app/config.py` (pydantic-settings) — env vars override `.env` override defaults
- Run: `uvicorn app.main:app --reload` (migrations must be applied first)
- Migrations: `alembic upgrade head` · new: `alembic revision --autogenerate -m "..."`
- Test: `pytest` · Lint: `ruff check .` · Types: `pyright` (strict; run with the
  venv active so it resolves site-packages)
- Reference data: `python scripts/build_reference_data.py` (uma.moe key from
  `UMA_MOE_API_KEY` in `backend/.env` — gitignored, never commit it)
- Character icons: `python scripts/fetch_icons.py` (no key) →
  `frontend/public/icons/` — gitignored game art, fetched per clone/update,
  never committed (DECISIONS.md #10)
- Favorite-mark icons (tag badges): extracted into `icons/marks/`. Tag ids live in
  `app/data/tag_icons.json` (committed) and must stay in sync with
  `MARK_IDS` in `frontend/src/domain.ts`

Frontend (from `frontend/`):

- `npm run dev` (proxies `/api` to `:8000`) · `npm run build` (typechecks via
  `tsc -b`) · `npm run lint` (ESLint incl. react-hooks rules)

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
