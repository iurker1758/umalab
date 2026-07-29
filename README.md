# UmaLab

UmaLab is a web app for Uma Musume: Pretty Derby (Global) breeding projects.
It ingests your full veteran roster straight from the game — via
[UmaExtractor](https://github.com/xancia/UmaExtractor) dumps — and makes it
browsable: stats,
aptitudes, and every inheritance factor (spark) across the full
parent/grandparent lineage, decoded to human-readable names.

> **Screenshot / GIF goes here** — this is the first thing anyone sees. Keep it current.

## How it works

- Run UmaExtractor on the game's Veteran List screen; it dumps your trained
  characters to a `data.json`.
- Upload that file in UmaLab. Each import replaces the roster with the new
  snapshot — the file is the source of truth.
- Browse and sort the roster: stats, rank score, aptitude letters, and each
  veteran's own sparks plus the white sparks carried by all six lineage slots
  (2 parents + 4 grandparents).

Planned next: hunted-skill spark scoring (expected sparks before/after reroll,
ported from the predecessor tkinter app) and an English inheritance-blueprint
designer in the spirit of design.u-ma.org.

## Stack

FastAPI + async SQLAlchemy + PostgreSQL · React + TypeScript + Vite PWA ·
pytest on the ingest decoding (the code that actually deserves tests).

See [DECISIONS.md](DECISIONS.md) for why each of these — every choice is written
up as requirements → choice → rejected alternatives.

## Interesting problems

- **Factor-id decoding**: the game encodes a spark as one integer —
  `key = factor_id // 100`, star `= factor_id % 100` — and the key resolves
  through a bundled copy of the game's own factor table (via uma.moe) into a
  name and kind: blue stat, pink aptitude, race, white skill, scenario, or
  unique. All decoding lives in a pure `ingest.py`, tested against
  hand-built fixtures.
- **Verifying reference labels from data alone**: before adopting the
  official table, pink-factor names were confirmed against a real
  99-veteran dump using the in-game rule that pink sparks only roll on
  A-or-better aptitudes — 99/99 consistent (and later matched the table,
  bar one label).
- **Snapshot imports**: an extractor dump is the whole roster, so imports are
  full-replace in one transaction — an upsert would quietly resurrect veterans
  you deleted in-game.

## Quickstart

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # then edit DATABASE_URL if yours differs
alembic upgrade head
uvicorn app.main:app --reload

# frontend (second terminal)
cd frontend
npm install
npm run dev   # proxies /api to the backend
```

Run the tests: `cd backend && pytest`

Reference data (`backend/app/data/`) is committed; regenerate it when the game
adds characters: `python scripts/build_reference_data.py` (needs a
[uma.moe](https://uma.moe) API key in `backend/.env` as `UMA_MOE_API_KEY`).

Game art is **not** committed (DECISIONS.md entry 10); fetch it once per
clone or game update:

- Character icons: `python scripts/fetch_icons.py` (no key needed).
- Favorite-mark icons (tag badges): `uv run scripts/extract_fav_icons.py` —
  extracts them from your own installed Uma Musume (Global) client, the only
  place they exist. Without them the UI falls back to numbered badges.

## Credits

UmaLab is an unofficial fan tool. Uma Musume: Pretty Derby and all its
characters and game data are the property of Cygames, Inc.

- [uma.moe](https://uma.moe) ([github.com/uma-moe](https://github.com/uma-moe)) —
  the bundled reference data (character roster, the factor name/type table)
  is generated from their resources API, and their open-source stack
  documented the factor-id encoding this app decodes.
- [xancia/UmaExtractor](https://github.com/xancia/UmaExtractor) (a fork of
  [rockisch/umadump](https://github.com/rockisch/umadump)) — the veteran-dump
  tool whose `data.json` format UmaLab imports.
- [Vali-98/umamusu-utils](https://github.com/Vali-98/umamusu-utils) (MIT) —
  the meta-DB key derivation and asset-bundle decryption scheme that
  `scripts/extract_fav_icons.py` adapts to read the favorite-mark icons from
  a local game client.
- [ウマ娘設計図 (design.u-ma.org)](https://design.u-ma.org/) — the inspiration
  for the planned inheritance-blueprint designer.

## How this was built

Scaffolded and pair-programmed with Claude. The data-model choices, decoding
verification, and roadmap are mine; see DECISIONS.md for the reasoning trail.
