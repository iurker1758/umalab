# UmaLab

UmaLab is a web app for Uma Musume: Pretty Derby (Global) breeding projects.
It ingests your full veteran roster straight from the game — via UmaExtractor
dumps (a community memory-reader tool) — and makes it browsable: stats,
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
  `key = factor_id // 100`, star `= factor_id % 100`, where the key's range
  says whether it's a blue stat, pink aptitude, green unique, or white skill
  factor (white keys are `skill_id // 10`). All decoding lives in a pure
  `ingest.py`, tested against hand-built fixtures.
- **Verifying reference labels from data alone**: pink-factor names were
  confirmed against a real 99-veteran dump using the in-game rule that pink
  sparks only roll on A-or-better aptitudes — 99/99 consistent.
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
adds characters: `python scripts/build_reference_data.py --api-key-file <path>`
(needs a [uma.moe](https://uma.moe) API key).

## How this was built

Scaffolded and pair-programmed with Claude. The data-model choices, decoding
verification, and roadmap are mine; see DECISIONS.md for the reasoning trail.
