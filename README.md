# UmaLab

UmaLab is a web app for Uma Musume: Pretty Derby (Global) breeding projects.
It ingests your full veteran roster straight from the game — via
[UmaExtractor](https://github.com/xancia/UmaExtractor) dumps — and makes it
browsable: stats,
aptitudes, and every inheritance factor (spark) across the full
parent/grandparent lineage, decoded to human-readable names.

> **Screenshot / GIF goes here** — the roster grid with icons and mark badges
> is the money shot. Keep it current.

## How it works

- Run UmaExtractor on the game's Veteran List screen; it dumps your trained
  characters to a `data.json`.
- Upload that file in UmaLab. Each import replaces the roster with the new
  snapshot — the file is the source of truth.
- Browse the roster as a grid of the game's own character icons — rank score
  under each card, favorite-mark badge on top. Click a card for the full
  detail: stats, aptitude letters, and each veteran's own sparks plus the
  sparks carried by all six lineage slots (2 parents + 4 grandparents).

There's also an inheritance-blueprint designer (in the spirit of
design.u-ma.org): a four-generation aptitude calculator over a 31-node
pedigree map with a docked detail panel — pick the lineage from the character
catalog, type in the pink sparks you're hunting, and read each member's
computed career-start letters, flagging any planned pink the game couldn't
actually drop. Every design is a saved blueprint that autosaves as you edit
it.

Any node can also be filled from your own roster, which pulls that veteran's
real pedigree in with her — her succession parents and grandparents, their
sparks, and her own trained aptitudes. That branch then reads as history
rather than plan: it's shown but not editable, since it describes a horse you
actually own. Manual entry stays the primary path and works with no roster at
all. Run affinity and inspiration estimates are still to come, then
hunted-skill spark scoring (expected sparks before/after reroll, ported from
the predecessor tkinter app).

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
The affinity tables (`relations.json`, `races.json`) and base aptitudes
(`aptitudes.json`) come from the local game client's own database;
`--mdb-only` refreshes just those, no key needed.

Game art is **not** committed (DECISIONS.md entry 10). Fetch the character
icons once per clone or game update: `python scripts/fetch_icons.py` (no key
needed). Without them the roster falls back to initials.

The favorite-mark icons (tag badges) are not game art — they're original
committed SVGs under `frontend/src/assets/marks/`, mostly recolored Twemoji
derivatives (DECISIONS.md #22). No fetch step, nothing to set up.

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
- [ウマ娘設計図 (design.u-ma.org)](https://design.u-ma.org/) — the inspiration
  for the inheritance-blueprint designer.
- [ayaliz/hakuraku](https://github.com/ayaliz/hakuraku) (MIT) — the
  inheritance-affinity algorithm structure in `app/affinity.py` is adapted
  from its `VeteransHelper.ts` (with constants updated for the 2026 Global
  affinity rework).
- [Twemoji](https://github.com/jdecked/twemoji) (CC-BY 4.0) — most of the
  favorite-mark icons in `frontend/src/assets/marks/` are recolored
  derivatives of its glyphs (DECISIONS.md #22).

## How this was built

Scaffolded and pair-programmed with Claude. The data-model choices, decoding
verification, and roadmap are mine; see DECISIONS.md for the reasoning trail.
