"""Bundled reference data, loaded once at import.

The JSON files in app/data/ are committed and regenerated manually
(scripts/build_reference_data.py; DECISIONS.md #6). Factor names and types
come from the game's own text_data via uma.moe (DECISIONS.md #8).
"""
import json
from pathlib import Path
from typing import TypedDict, cast

DATA_DIR = Path(__file__).resolve().parent / "data"


class Card(TypedDict):
    chara_id: int
    name: str
    outfit: str
    title: str  # bracketed card epithet, e.g. "[Special Dreamer]"; may be ""


class FactorInfo(TypedDict):
    name: str
    type: int


class SkillInfo(TypedDict):
    name: str
    rarity: int | None
    unique: bool


class RankBand(TypedDict):
    max: int
    symbol: str  # the in-game △ / ○ / ◎


class SaddleInfo(TypedDict):
    name: str
    g1_race_ids: list[int]


def _load_cards() -> dict[int, Card]:
    raw = json.loads((DATA_DIR / "cards.json").read_text(encoding="utf-8"))
    # "title" default keeps a pre-title cards.json (or a gameless regen) valid.
    return {
        int(card_id): cast("Card", {"title": "", **card})
        for card_id, card in raw.items()
    }


def _load_factors() -> dict[int, FactorInfo]:
    raw = json.loads((DATA_DIR / "factors.json").read_text(encoding="utf-8"))
    return {int(key): info for key, info in raw.items()}


def _load_skills() -> dict[int, SkillInfo]:
    raw = json.loads((DATA_DIR / "skills.json").read_text(encoding="utf-8"))
    return {int(skill_id): info for skill_id, info in raw.items()}


def _load_tag_icons() -> list[str]:
    raw = json.loads((DATA_DIR / "tag_icons.json").read_text(encoding="utf-8"))
    return list(raw)


def _load_relations() -> tuple[list[RankBand], dict[int, int], dict[int, list[int]]]:
    raw = json.loads((DATA_DIR / "relations.json").read_text(encoding="utf-8"))
    ranks = cast("list[RankBand]", raw["ranks"])
    points = {int(rt): cast(int, pt) for rt, pt in raw["points"].items()}
    members = {int(rt): cast("list[int]", ids) for rt, ids in raw["members"].items()}
    return ranks, points, members


def _load_races() -> tuple[dict[int, SaddleInfo], dict[int, str]]:
    raw = json.loads((DATA_DIR / "races.json").read_text(encoding="utf-8"))
    saddles = {int(sid): cast("SaddleInfo", info) for sid, info in raw["saddles"].items()}
    race_names = {int(rid): cast(str, name) for rid, name in raw["race_names"].items()}
    return saddles, race_names


CARDS: dict[int, Card] = _load_cards()
FACTORS: dict[int, FactorInfo] = _load_factors()
# Skill names are presentation-only: the DB stores skills raw (DECISIONS.md
# #5) and the API decorates them at read time (DECISIONS.md #12).
SKILLS: dict[int, SkillInfo] = _load_skills()
# The fixed set of assignable tag ids (favorite-mark icons; DECISIONS.md #9).
# Ids only — the art itself is extracted locally by an out-of-repo tool
# (DECISIONS.md #10).
TAG_ICONS: list[str] = _load_tag_icons()

# Succession affinity tables from the local client's master.mdb (no fan API
# publishes them; DECISIONS.md #14). Loaded flat here; app/affinity.py builds
# its lookup structure from these.
_relations = _load_relations()
AFFINITY_RANKS: list[RankBand] = _relations[0]
RELATION_POINTS: dict[int, int] = _relations[1]
RELATION_MEMBERS: dict[int, list[int]] = _relations[2]
# Win-saddle -> component G1 races, for the shared-win affinity bonus
# (2026-06-24 Global system; DECISIONS.md #15), plus display names.
_races = _load_races()
SADDLES: dict[int, SaddleInfo] = _races[0]
RACE_NAMES: dict[int, str] = _races[1]

# uma.moe's `type` field -> the kind label stored on decoded factors.
FACTOR_TYPE_KINDS: dict[int, str] = {
    0: "blue",
    1: "pink",
    2: "race",
    3: "white",
    4: "scenario",
    5: "unique",
}
